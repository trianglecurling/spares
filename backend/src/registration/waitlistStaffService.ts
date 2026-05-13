import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { canActorImpersonateTarget } from '../services/accountAccess.js';
import type {
  LeagueRosterPlacementTypeSqlite,
  WaitlistAuditActionSqlite,
  WaitlistAuditSourceSqlite,
  WaitlistEntryTypeSqlite,
  WaitlistOfferKindSqlite,
  WaitlistOfferStatusSqlite,
} from '../db/drizzle-schema.js';
import { validateWaitlistEligibility } from './registrationEligibility.js';
import { buildRegistrationContextForDraft, triggerDeferredRegistrationPayment } from './registrationMembershipPaymentService.js';
import { sendRegistrationEmailForDashboard, type RegistrationEmailPayload, type RegistrationMessageType } from './registrationEmailService.js';
import { rollWaitlistForward } from './waitlistRolloverService.js';

export class WaitlistStaffValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Waitlist staff operation failed');
  }
}

type WaitlistEntryRow = typeof getDrizzleDb extends () => infer T
  ? T extends { schema: infer S }
    ? S extends { waitlistEntries: infer W }
      ? W extends { $inferSelect: infer R }
        ? R
        : any
      : any
    : any
  : any;

function dbJson(value: unknown): never {
  return (getDatabaseConfig()?.type === 'postgres' ? value : JSON.stringify(value)) as never;
}

function dbValue(value: unknown): never {
  return value as never;
}

function dbNow(): never {
  return dbValue(getDatabaseConfig()?.type === 'postgres' ? new Date() : new Date().toISOString());
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value);
  return raw.includes('T') ? raw.slice(0, 10) : raw;
}

function memberName(row: { name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null }): string {
  const parts = [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : row.name?.trim() || row.email?.trim() || 'Unknown member';
}

async function safeSendWaitlistCommunication(input: {
  messageType: RegistrationMessageType;
  member: { id: number; email?: string | null; name?: string | null; first_name?: string | null; last_name?: string | null };
  registrationId?: number | null;
  waitlistOfferId?: number | null;
  waitlistEntryId?: number | null;
  payload: RegistrationEmailPayload;
}): Promise<void> {
  if (!input.member.email) return;
  try {
    await sendRegistrationEmailForDashboard({
      messageType: input.messageType,
      recipientEmail: input.member.email,
      recipientName: memberName(input.member),
      recipientMemberId: input.member.id,
      registrationId: input.registrationId ?? null,
      waitlistOfferId: input.waitlistOfferId ?? null,
      waitlistEntryId: input.waitlistEntryId ?? null,
      payload: input.payload,
    });
  } catch (error) {
    console.error('[Registration Email] Failed to send waitlist communication:', error);
  }
}

function requireReason(reason: string | null | undefined): string {
  const trimmed = reason?.trim() ?? '';
  if (!trimmed) {
    throw new WaitlistStaffValidationError({ reason: 'A reason is required.' });
  }
  return trimmed;
}

function offerTypeToPlacementType(entryType: WaitlistEntryTypeSqlite, offerType: WaitlistOfferKindSqlite): LeagueRosterPlacementTypeSqlite {
  if (offerType === 'temporary_sabbatical_fill') return 'temporary_sabbatical_fill';
  return entryType === 'replace' ? 'waitlist_replace' : 'waitlist_add';
}

function nextPositionSortKey(prefix = Date.now()): string {
  return `${prefix.toString().padStart(13, '0')}:${randomBytes(6).toString('hex')}`;
}

export function calculateWaitlistVacancies(input: {
  capacity: number;
  permanentPlacements: number;
  temporaryPlacements: number;
  activeSabbaticals: number;
}): { permanentVacancies: number; temporarySabbaticalFillVacancies: number } {
  return {
    permanentVacancies: Math.max(0, input.capacity - input.permanentPlacements - input.activeSabbaticals),
    temporarySabbaticalFillVacancies: Math.max(0, input.activeSabbaticals - input.temporaryPlacements),
  };
}

export function resolveWaitlistDecline(input: {
  declineCount: number;
  positionSortKey: string;
  nextPositionSortKey: string;
}): { declineCount: number; positionSortKey: string; movedToBottom: boolean } {
  const nextDeclineCount = input.declineCount + 1;
  if (nextDeclineCount < 2) {
    return {
      declineCount: nextDeclineCount,
      positionSortKey: input.positionSortKey,
      movedToBottom: false,
    };
  }
  return {
    declineCount: 0,
    positionSortKey: input.nextPositionSortKey,
    movedToBottom: true,
  };
}

function responseDeadline(offeredAt: Date): Date {
  return new Date(offeredAt.getTime() + 24 * 60 * 60 * 1000);
}

function generateResponseToken(): string {
  return randomBytes(24).toString('base64url');
}

async function createAuditEvent(
  tx: any,
  input: {
    waitlistEntryId?: number | null;
    leagueId?: number | null;
    memberId?: number | null;
    actorMemberId?: number | null;
    source: WaitlistAuditSourceSqlite;
    action: WaitlistAuditActionSqlite;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
    metadata?: unknown;
  }
) {
  const { schema } = getDrizzleDb();
  await tx.insert(schema.waitlistAuditEvents).values({
    waitlist_entry_id: input.waitlistEntryId ?? null,
    league_id: input.leagueId ?? null,
    member_id: input.memberId ?? null,
    actor_member_id: input.actorMemberId ?? null,
    source: input.source,
    action: input.action,
    reason: input.reason ?? null,
    before_json: dbJson(input.before ?? null),
    after_json: dbJson(input.after ?? null),
    metadata_json: dbJson(input.metadata ?? null),
    created_at: dbNow(),
  });
}

async function getLatestRegistrationForMember(memberId: number, sessionId: number | null): Promise<number | null> {
  if (!sessionId) return null;
  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select({ id: schema.curlingRegistrations.id })
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.curler_member_id, memberId),
        eq(schema.curlingRegistrations.session_id, sessionId),
        sql`${schema.curlingRegistrations.status} NOT IN ('cancelled', 'abandoned')`
      )
    )
    .orderBy(desc(schema.curlingRegistrations.updated_at), desc(schema.curlingRegistrations.id))
    .limit(1);
  return registration?.id ?? null;
}

async function loadLeague(leagueId: number) {
  const { db, schema } = getDrizzleDb();
  const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).limit(1);
  if (!league) throw new WaitlistStaffValidationError({ leagueId: 'League was not found.' });
  return league;
}

async function loadEntry(entryId: number) {
  const { db, schema } = getDrizzleDb();
  const [entry] = await db.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, entryId)).limit(1);
  if (!entry) throw new WaitlistStaffValidationError({ waitlistEntryId: 'Waitlist entry was not found.' });
  return entry as WaitlistEntryRow;
}

async function activeRosterCountByLeague(leagueIds: number[]): Promise<Map<number, { permanent: number; temporary: number }>> {
  const counts = new Map<number, { permanent: number; temporary: number }>();
  if (leagueIds.length === 0) return counts;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.leagueRoster.league_id,
      total: sql<number>`COUNT(*)`,
      temporary: sql<number>`SUM(CASE WHEN ${schema.leagueRoster.is_temporary_sabbatical_fill} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(schema.leagueRoster)
    .where(and(inArray(schema.leagueRoster.league_id, leagueIds), eq(schema.leagueRoster.status, 'active')))
    .groupBy(schema.leagueRoster.league_id);
  for (const row of rows) {
    const total = Number(row.total ?? 0);
    const temporary = Number(row.temporary ?? 0);
    counts.set(row.leagueId, { permanent: Math.max(0, total - temporary), temporary });
  }
  return counts;
}

async function activeSabbaticalCountByLeague(leagueIds: number[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (leagueIds.length === 0) return counts;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.curlingLeagueSabbaticals.current_league_id,
      total: sql<number>`COUNT(*)`,
    })
    .from(schema.curlingLeagueSabbaticals)
    .where(and(inArray(schema.curlingLeagueSabbaticals.current_league_id, leagueIds), eq(schema.curlingLeagueSabbaticals.status, 'active')))
    .groupBy(schema.curlingLeagueSabbaticals.current_league_id);
  for (const row of rows) {
    counts.set(row.leagueId, Number(row.total ?? 0));
  }
  return counts;
}

async function countActiveWaitlistsAndPendingOffers(leagueIds: number[]) {
  const waitlists = new Map<number, number>();
  const offers = new Map<number, number>();
  if (leagueIds.length === 0) return { waitlists, offers };
  const { db, schema } = getDrizzleDb();
  const waitlistRows = await db
    .select({ leagueId: schema.waitlistEntries.league_id, total: sql<number>`COUNT(*)` })
    .from(schema.waitlistEntries)
    .where(and(inArray(schema.waitlistEntries.league_id, leagueIds), eq(schema.waitlistEntries.status, 'active')))
    .groupBy(schema.waitlistEntries.league_id);
  for (const row of waitlistRows) waitlists.set(row.leagueId, Number(row.total ?? 0));

  const offerRows = await db
    .select({ leagueId: schema.waitlistOffers.league_id, total: sql<number>`COUNT(*)` })
    .from(schema.waitlistOffers)
    .where(and(inArray(schema.waitlistOffers.league_id, leagueIds), eq(schema.waitlistOffers.status, 'pending')))
    .groupBy(schema.waitlistOffers.league_id);
  for (const row of offerRows) offers.set(row.leagueId, Number(row.total ?? 0));
  return { waitlists, offers };
}

async function warningCodesForLeague(league: any, now = new Date()): Promise<string[]> {
  const warnings: string[] = [];
  if (!league.capacity_value || league.capacity_value <= 0) warnings.push('missing_capacity');
  if (!league.first_day_of_play) warnings.push('missing_first_day_of_play');
  if (!league.last_day_of_play) warnings.push('missing_last_day_of_play');
  if (!league.successor_league_id) warnings.push('missing_successor_league');
  const { db, schema } = getDrizzleDb();
  const overdueOffers = await db
    .select({ id: schema.waitlistOffers.id })
    .from(schema.waitlistOffers)
    .where(
      and(
        eq(schema.waitlistOffers.league_id, league.id),
        eq(schema.waitlistOffers.status, 'pending'),
        lt(schema.waitlistOffers.expires_at, dbValue(getDatabaseConfig()?.type === 'postgres' ? now : now.toISOString()))
      )
    )
    .limit(1);
  if (overdueOffers.length > 0) warnings.push('pending_offer_past_deadline');
  return warnings;
}

export async function getWaitlistDashboard(input: { sessionId?: number | null } = {}) {
  const { db, schema } = getDrizzleDb();
  const sessionId = input.sessionId ?? null;
  const leagues = await db
    .select()
    .from(schema.leagues)
    .where(
      and(
        eq(schema.leagues.league_type, 'standard'),
        sessionId ? eq(schema.leagues.session_id, sessionId) : sql`1=1`
      )
    )
    .orderBy(asc(schema.leagues.name));
  const leagueIds = leagues.map((league) => league.id);
  const rosterCounts = await activeRosterCountByLeague(leagueIds);
  const sabbaticalCounts = await activeSabbaticalCountByLeague(leagueIds);
  const { waitlists, offers } = await countActiveWaitlistsAndPendingOffers(leagueIds);
  const rows = [];
  for (const league of leagues) {
    const roster = rosterCounts.get(league.id) ?? { permanent: 0, temporary: 0 };
    const sabbaticals = sabbaticalCounts.get(league.id) ?? 0;
    const { permanentVacancies, temporarySabbaticalFillVacancies } = calculateWaitlistVacancies({
      capacity: league.capacity_value ?? 0,
      permanentPlacements: roster.permanent,
      temporaryPlacements: roster.temporary,
      activeSabbaticals: sabbaticals,
    });
    rows.push({
      id: league.id,
      name: league.name,
      sessionId: league.session_id,
      capacity: league.capacity_value ?? 0,
      confirmedPlacements: roster.permanent + roster.temporary,
      permanentVacancies,
      temporarySabbaticalFillVacancies,
      activeWaitlistEntries: waitlists.get(league.id) ?? 0,
      pendingOffers: offers.get(league.id) ?? 0,
      rolloverOccurred: Boolean(league.predecessor_league_id),
      warnings: await warningCodesForLeague(league),
    });
  }
  return { leagues: rows };
}

export async function getLeagueWaitlistManager(leagueId: number) {
  const { db, schema } = getDrizzleDb();
  const league = await loadLeague(leagueId);
  const rosterCounts = await activeRosterCountByLeague([leagueId]);
  const sabbaticalCounts = await activeSabbaticalCountByLeague([leagueId]);
  const roster = rosterCounts.get(leagueId) ?? { permanent: 0, temporary: 0 };
  const sabbaticals = sabbaticalCounts.get(leagueId) ?? 0;

  const rosterRows = await db
    .select({
      id: schema.leagueRoster.id,
      memberId: schema.leagueRoster.member_id,
      memberName: schema.members.name,
      memberEmail: schema.members.email,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      registrationId: schema.leagueRoster.source_registration_id,
      status: schema.leagueRoster.status,
      placementType: schema.leagueRoster.placement_type,
      temporary: schema.leagueRoster.is_temporary_sabbatical_fill,
      relatedSabbaticalId: schema.leagueRoster.related_sabbatical_id,
    })
    .from(schema.leagueRoster)
    .innerJoin(schema.members, eq(schema.leagueRoster.member_id, schema.members.id))
    .where(eq(schema.leagueRoster.league_id, leagueId))
    .orderBy(asc(schema.members.name));

  const waitlistRows = await db
    .select({
      id: schema.waitlistEntries.id,
      memberId: schema.waitlistEntries.member_id,
      memberName: schema.members.name,
      memberEmail: schema.members.email,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      entryType: schema.waitlistEntries.entry_type,
      replacesLeagueId: schema.waitlistEntries.replaces_league_id,
      sourceRegistrationId: schema.waitlistEntries.source_registration_id,
      positionSortKey: schema.waitlistEntries.position_sort_key,
      joinedAt: schema.waitlistEntries.joined_at,
      declineCount: schema.waitlistEntries.decline_count,
      status: schema.waitlistEntries.status,
      rolledOverFromWaitlistEntryId: schema.waitlistEntries.rolled_over_from_waitlist_entry_id,
    })
    .from(schema.waitlistEntries)
    .innerJoin(schema.members, eq(schema.waitlistEntries.member_id, schema.members.id))
    .where(eq(schema.waitlistEntries.league_id, leagueId))
    .orderBy(asc(schema.waitlistEntries.position_sort_key), asc(schema.waitlistEntries.joined_at), asc(schema.waitlistEntries.id));

  const waitlistEntryIds = waitlistRows.map((row) => row.id);
  const offers = waitlistEntryIds.length
    ? await db
        .select()
        .from(schema.waitlistOffers)
        .where(inArray(schema.waitlistOffers.waitlist_entry_id, waitlistEntryIds))
        .orderBy(desc(schema.waitlistOffers.offered_at), desc(schema.waitlistOffers.id))
    : [];
  const offersByEntry = new Map<number, any[]>();
  for (const offer of offers) {
    const list = offersByEntry.get(offer.waitlist_entry_id) ?? [];
    list.push(offer);
    offersByEntry.set(offer.waitlist_entry_id, list);
  }

  const auditRows = await db
    .select()
    .from(schema.waitlistAuditEvents)
    .where(eq(schema.waitlistAuditEvents.league_id, leagueId))
    .orderBy(desc(schema.waitlistAuditEvents.created_at), desc(schema.waitlistAuditEvents.id))
    .limit(100);

  const vacancies = calculateWaitlistVacancies({
    capacity: league.capacity_value ?? 0,
    permanentPlacements: roster.permanent,
    temporaryPlacements: roster.temporary,
    activeSabbaticals: sabbaticals,
  });

  return {
    league: {
      id: league.id,
      name: league.name,
      sessionId: league.session_id,
      leagueType: league.league_type,
      capacity: league.capacity_value ?? 0,
      feeMinor: league.registration_fee_override_minor ?? league.registration_fee_minor ?? 0,
      firstDayOfPlay: normalizeDate(league.first_day_of_play),
      lastDayOfPlay: normalizeDate(league.last_day_of_play),
      permanentVacancies: vacancies.permanentVacancies,
      temporarySabbaticalFillVacancies: vacancies.temporarySabbaticalFillVacancies,
      warnings: await warningCodesForLeague(league),
    },
    roster: rosterRows.map((row) => ({
      ...row,
      memberName: memberName({
        name: row.memberName,
        first_name: row.firstName,
        last_name: row.lastName,
        email: row.memberEmail,
      }),
      temporary: row.temporary === 1,
    })),
    waitlistEntries: waitlistRows.map((row, index) => ({
      ...row,
      memberName: memberName({
        name: row.memberName,
        first_name: row.firstName,
        last_name: row.lastName,
        email: row.memberEmail,
      }),
      position: index + 1,
      pendingOffer: (offersByEntry.get(row.id) ?? []).find((offer) => offer.status === 'pending') ?? null,
      acceptedOffer:
        (offersByEntry.get(row.id) ?? []).find((offer) => offer.status === 'accepted' || offer.status === 'expired_accepted') ?? null,
      offers: offersByEntry.get(row.id) ?? [],
    })),
    auditEvents: auditRows,
  };
}

async function validateOfferCandidate(input: {
  entry: WaitlistEntryRow;
  offerType: WaitlistOfferKindSqlite;
  override?: boolean;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  if (input.entry.status !== 'active') {
    throw new WaitlistStaffValidationError({ waitlistEntry: 'Only active waitlist entries can receive offers.' });
  }
  const league = await loadLeague(input.entry.league_id);
  if (league.league_type === 'bring_your_own_team' || league.allows_waitlist !== 1) {
    throw new WaitlistStaffValidationError({ league: 'This league cannot receive waitlist offers.' });
  }
  if (input.offerType === 'temporary_sabbatical_fill' && league.allows_sabbatical !== 1) {
    throw new WaitlistStaffValidationError({ offerType: 'Temporary sabbatical-fill offers are not available for this league.' });
  }
  const [pendingOffer] = await db
    .select()
    .from(schema.waitlistOffers)
    .where(
      and(
        eq(schema.waitlistOffers.waitlist_entry_id, input.entry.id),
        eq(schema.waitlistOffers.league_id, input.entry.league_id),
        eq(schema.waitlistOffers.status, 'pending')
      )
    )
    .limit(1);
  if (pendingOffer) {
    throw new WaitlistStaffValidationError({ offer: 'This waitlist entry already has a pending offer.' });
  }
  const [activePlacement] = await db
    .select({ id: schema.leagueRoster.id })
    .from(schema.leagueRoster)
    .where(
      and(
        eq(schema.leagueRoster.league_id, input.entry.league_id),
        eq(schema.leagueRoster.member_id, input.entry.member_id),
        eq(schema.leagueRoster.status, 'active')
      )
    )
    .limit(1);
  if (activePlacement && !input.override) {
    throw new WaitlistStaffValidationError({ placement: 'This member already has an active placement in the league.' });
  }
  if (!input.override && input.entry.source_registration_id) {
    const context = await buildRegistrationContextForDraft(input.entry.source_registration_id);
    const targetLeague = context.leagues[input.entry.league_id];
    const decision = targetLeague ? validateWaitlistEligibility(context, targetLeague) : null;
    if (!decision?.allowed) {
      throw new WaitlistStaffValidationError({
        eligibility: decision?.blockingErrors[0]?.message ?? 'This member is not eligible for the league.',
      });
    }
  }
}

async function selectOfferEntries(input: {
  leagueId: number;
  entryIds?: number[];
  count?: number;
  offerType: WaitlistOfferKindSqlite;
  override?: boolean;
}): Promise<WaitlistEntryRow[]> {
  const { db, schema } = getDrizzleDb();
  const baseRows = await db
    .select()
    .from(schema.waitlistEntries)
    .where(
      and(
        eq(schema.waitlistEntries.league_id, input.leagueId),
        input.entryIds?.length ? inArray(schema.waitlistEntries.id, input.entryIds) : eq(schema.waitlistEntries.status, 'active')
      )
    )
    .orderBy(asc(schema.waitlistEntries.position_sort_key), asc(schema.waitlistEntries.joined_at), asc(schema.waitlistEntries.id));
  const requestedCount = input.entryIds?.length ?? input.count ?? 1;
  const eligible: WaitlistEntryRow[] = [];
  const errors: Record<string, string> = {};
  for (const entry of baseRows) {
    try {
      await validateOfferCandidate({ entry, offerType: input.offerType, override: input.override });
      eligible.push(entry as WaitlistEntryRow);
      if (eligible.length >= requestedCount) break;
    } catch (error) {
      if (input.entryIds?.includes(entry.id) && error instanceof WaitlistStaffValidationError) {
        Object.assign(errors, error.details);
      }
    }
  }
  if (Object.keys(errors).length > 0) throw new WaitlistStaffValidationError(errors);
  if (eligible.length === 0) throw new WaitlistStaffValidationError({ entries: 'No eligible waitlist entries were found.' });
  return eligible;
}

export async function sendWaitlistOffers(input: {
  leagueId: number;
  offerType: WaitlistOfferKindSqlite;
  actorMemberId: number;
  reason?: string | null;
  entryIds?: number[];
  count?: number;
  override?: boolean;
  staffNotes?: string | null;
}) {
  const reason = requireReason(input.reason ?? 'waitlist-offer-sent');
  const { db, schema } = getDrizzleDb();
  const league = await loadLeague(input.leagueId);
  const entries = await selectOfferEntries(input);
  const offeredAt = new Date();
  const expiresAt = responseDeadline(offeredAt);
  const createdOffers: any[] = [];

  await db.transaction(async (tx) => {
    for (const entry of entries) {
      const token = generateResponseToken();
      const [offer] = await tx
        .insert(schema.waitlistOffers)
        .values({
          waitlist_entry_id: entry.id,
          league_id: entry.league_id,
          member_id: entry.member_id,
          offer_type: input.offerType,
          status: 'pending',
          offered_at: dbValue(getDatabaseConfig()?.type === 'postgres' ? offeredAt : offeredAt.toISOString()),
          expires_at: dbValue(getDatabaseConfig()?.type === 'postgres' ? expiresAt : expiresAt.toISOString()),
          response_token: token,
          offered_by_member_id: input.actorMemberId,
          source_registration_id: entry.source_registration_id ?? null,
          staff_notes: input.staffNotes?.trim() || null,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .returning();
      await createAuditEvent(tx, {
        waitlistEntryId: entry.id,
        leagueId: entry.league_id,
        memberId: entry.member_id,
        actorMemberId: input.actorMemberId,
        source: 'staff_action',
        action: 'offer_sent',
        reason,
        after: offer,
        metadata: { offerType: input.offerType, override: input.override === true },
      });
      createdOffers.push(offer);
    }
  });

  for (const offer of createdOffers) {
    const [member] = await db.select().from(schema.members).where(eq(schema.members.id, offer.member_id)).limit(1);
    if (!member?.email) continue;
    const deadline = asDate(offer.expires_at) ?? expiresAt;
    const deadlineText = deadline.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    await safeSendWaitlistCommunication({
      messageType: offer.offer_type === 'temporary_sabbatical_fill' ? 'waitlist_offer_temporary_sabbatical_fill' : 'waitlist_offer_permanent',
      member,
      registrationId: offer.source_registration_id ?? null,
      waitlistOfferId: offer.id,
      waitlistEntryId: offer.waitlist_entry_id,
      payload: {
      leagueName: league.name,
        isTemporarySabbaticalFill: offer.offer_type === 'temporary_sabbatical_fill',
        deadlineText,
        acceptUrl: `${config.frontendUrl.replace(/\/+$/, '')}/registration/waitlist-offers/${offer.response_token}/accept`,
        declineUrl: `${config.frontendUrl.replace(/\/+$/, '')}/registration/waitlist-offers/${offer.response_token}/decline`,
      },
    });
  }

  return { offers: createdOffers };
}

async function placeAcceptedOffer(
  tx: any,
  input: {
    offer: any;
    entry: WaitlistEntryRow;
    status: WaitlistOfferStatusSqlite;
    source: WaitlistAuditSourceSqlite;
    actorMemberId?: number | null;
    reason: string;
  }
) {
  const { schema } = getDrizzleDb();
  const placementType = offerTypeToPlacementType(input.entry.entry_type, input.offer.offer_type);
  const relatedSabbaticalId =
    input.offer.offer_type === 'temporary_sabbatical_fill'
      ? (
          await tx
            .select({ id: schema.curlingLeagueSabbaticals.id })
            .from(schema.curlingLeagueSabbaticals)
            .where(
              and(
                eq(schema.curlingLeagueSabbaticals.current_league_id, input.entry.league_id),
                eq(schema.curlingLeagueSabbaticals.status, 'active')
              )
            )
            .limit(1)
        )[0]?.id ?? null
      : null;

  const [existingRoster] = await tx
    .select()
    .from(schema.leagueRoster)
    .where(and(eq(schema.leagueRoster.league_id, input.entry.league_id), eq(schema.leagueRoster.member_id, input.entry.member_id)))
    .limit(1);
  const rosterValues = {
    source_registration_id: input.entry.source_registration_id ?? input.offer.source_registration_id ?? null,
    status: 'active',
    placement_type: placementType,
    is_temporary_sabbatical_fill: input.offer.offer_type === 'temporary_sabbatical_fill' ? 1 : 0,
    related_sabbatical_id: relatedSabbaticalId,
    updated_at: sql`CURRENT_TIMESTAMP`,
  };
  const [placement] = existingRoster
    ? await tx.update(schema.leagueRoster).set(rosterValues).where(eq(schema.leagueRoster.id, existingRoster.id)).returning()
    : await tx
        .insert(schema.leagueRoster)
        .values({
          league_id: input.entry.league_id,
          member_id: input.entry.member_id,
          ...rosterValues,
        })
        .returning();

  await createAuditEvent(tx, {
    waitlistEntryId: input.entry.id,
    leagueId: input.entry.league_id,
    memberId: input.entry.member_id,
    actorMemberId: input.actorMemberId ?? null,
    source: 'placement_process',
    action: 'entry_placed',
    reason: input.reason,
    before: existingRoster ?? null,
    after: placement,
    metadata: { offerId: input.offer.id, offerStatus: input.status, placementType },
  });

  if (input.offer.offer_type === 'permanent') {
    await tx
      .update(schema.waitlistEntries)
      .set({ status: 'placed', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.waitlistEntries.id, input.entry.id));
    await createAuditEvent(tx, {
      waitlistEntryId: input.entry.id,
      leagueId: input.entry.league_id,
      memberId: input.entry.member_id,
      actorMemberId: input.actorMemberId ?? null,
      source: 'placement_process',
      action: 'entry_placed',
      reason: input.reason,
      before: { status: input.entry.status },
      after: { status: 'placed' },
      metadata: { offerId: input.offer.id },
    });
  }

  if (input.entry.entry_type === 'replace' && input.entry.replaces_league_id) {
    const [released] = await tx
      .update(schema.leagueRoster)
      .set({ status: 'removed', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          eq(schema.leagueRoster.league_id, input.entry.replaces_league_id),
          eq(schema.leagueRoster.member_id, input.entry.member_id),
          eq(schema.leagueRoster.status, 'active')
        )
      )
      .returning();
    if (released) {
      await createAuditEvent(tx, {
        waitlistEntryId: input.entry.id,
        leagueId: input.entry.replaces_league_id,
        memberId: input.entry.member_id,
        actorMemberId: input.actorMemberId ?? null,
        source: 'placement_process',
        action: 'staff_correction',
        reason: `Released replaced league placement: ${input.reason}`,
        before: released,
        after: { ...released, status: 'removed' },
        metadata: { offerId: input.offer.id, targetLeagueId: input.entry.league_id },
      });
    }
  }

  if (input.entry.source_registration_id) {
    await tx
      .update(schema.registrationSelections)
      .set({
        status: input.offer.offer_type === 'permanent' ? 'placed' : 'accepted',
        is_temporary_sabbatical_fill: input.offer.offer_type === 'temporary_sabbatical_fill' ? 1 : 0,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(schema.registrationSelections.registration_id, input.entry.source_registration_id),
          eq(schema.registrationSelections.league_id, input.entry.league_id),
          sql`${schema.registrationSelections.selection_type} IN ('waitlist_add', 'waitlist_replace')`
        )
      );
    await tx
      .update(schema.curlingRegistrations)
      .set({ status: 'awaiting_payment', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.curlingRegistrations.id, input.entry.source_registration_id));
  }
}

async function respondToOffer(input: {
  offerId?: number;
  token?: string;
  status: 'accepted' | 'declined' | 'expired_accepted';
  source: WaitlistAuditSourceSqlite;
  actorMemberId?: number | null;
  reason?: string | null;
}) {
  const { db, schema } = getDrizzleDb();
  const reason = input.reason?.trim() || (input.status === 'expired_accepted' ? 'waitlist-offer-auto-accepted' : 'waitlist-offer-response');
  const [offer] = await db
    .select()
    .from(schema.waitlistOffers)
    .where(input.offerId ? eq(schema.waitlistOffers.id, input.offerId) : eq(schema.waitlistOffers.response_token, input.token ?? ''))
    .limit(1);
  if (!offer) throw new WaitlistStaffValidationError({ offer: 'Waitlist offer was not found.' });
  if (offer.status !== 'pending') {
    return { offer, changed: false };
  }
  const entry = await loadEntry(offer.waitlist_entry_id);
  const respondedAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(schema.waitlistOffers)
      .set({
        status: input.status,
        responded_at: dbValue(getDatabaseConfig()?.type === 'postgres' ? respondedAt : respondedAt.toISOString()),
        response_source: input.source,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.waitlistOffers.id, offer.id));
    await createAuditEvent(tx, {
      waitlistEntryId: entry.id,
      leagueId: entry.league_id,
      memberId: entry.member_id,
      actorMemberId: input.actorMemberId ?? null,
      source: input.source,
      action: input.status === 'declined' ? 'offer_declined' : input.status === 'accepted' ? 'offer_accepted' : 'offer_expired_accepted',
      reason,
      before: offer,
      after: { ...offer, status: input.status },
      metadata: { offerId: offer.id },
    });

    if (input.status === 'declined') {
      const declineResolution = resolveWaitlistDecline({
        declineCount: Number(entry.decline_count ?? 0),
        positionSortKey: entry.position_sort_key,
        nextPositionSortKey: nextPositionSortKey(),
      });
      const before = {
        declineCount: entry.decline_count,
        positionSortKey: entry.position_sort_key,
        status: entry.status,
      };
      const after = {
        declineCount: declineResolution.declineCount,
        positionSortKey: declineResolution.positionSortKey,
        status: declineResolution.movedToBottom ? 'active' : entry.status,
      };
      await tx
        .update(schema.waitlistEntries)
        .set({
          decline_count: after.declineCount,
          position_sort_key: after.positionSortKey,
          status: 'active',
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.waitlistEntries.id, entry.id));
      await createAuditEvent(tx, {
        waitlistEntryId: entry.id,
        leagueId: entry.league_id,
        memberId: entry.member_id,
        actorMemberId: input.actorMemberId ?? null,
        source: input.source,
        action: declineResolution.movedToBottom ? 'entry_moved_to_bottom' : 'decline_count_changed',
        reason,
        before,
        after,
        metadata: { offerId: offer.id, movedToBottom: declineResolution.movedToBottom },
      });
      return;
    }

    await placeAcceptedOffer(tx, { offer, entry, status: input.status, source: input.source, actorMemberId: input.actorMemberId, reason });
  });

  const [member] = await db.select().from(schema.members).where(eq(schema.members.id, offer.member_id)).limit(1);
  const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, offer.league_id)).limit(1);
  const [updatedEntry] = await db.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, entry.id)).limit(1);
  if (member) {
    await safeSendWaitlistCommunication({
      messageType: input.status === 'declined' ? 'waitlist_offer_declined' : 'waitlist_offer_accepted',
      member,
      registrationId: offer.source_registration_id ?? entry.source_registration_id ?? null,
      waitlistOfferId: offer.id,
      waitlistEntryId: entry.id,
      payload: {
        leagueName: league?.name,
        isTemporarySabbaticalFill: offer.offer_type === 'temporary_sabbatical_fill',
        offerResponseSource: input.status === 'expired_accepted' ? 'automatic' : 'explicit',
        declineCount: updatedEntry?.decline_count ?? entry.decline_count,
      },
    });
  }

  return { offer: { ...offer, status: input.status }, changed: true };
}

export async function acceptWaitlistOffer(input: { offerId: number; actorMemberId?: number | null; reason?: string | null }) {
  return respondToOffer({ ...input, status: 'accepted', source: input.actorMemberId ? 'staff_action' : 'offer_response' });
}

export async function declineWaitlistOffer(input: { offerId: number; actorMemberId?: number | null; reason?: string | null }) {
  return respondToOffer({ ...input, status: 'declined', source: input.actorMemberId ? 'staff_action' : 'offer_response' });
}

export async function declineWaitlistOfferByToken(token: string) {
  return respondToOffer({ token, status: 'declined', source: 'offer_response', reason: 'waitlist-offer-declined-by-member' });
}

export async function acceptWaitlistOfferByTokenForMember(input: { token: string; actorMemberId: number }) {
  const { db, schema } = getDrizzleDb();
  const [offer] = await db
    .select()
    .from(schema.waitlistOffers)
    .where(eq(schema.waitlistOffers.response_token, input.token))
    .limit(1);
  if (!offer) throw new WaitlistStaffValidationError({ offer: 'Waitlist offer was not found.' });
  if (!(await canActorImpersonateTarget(input.actorMemberId, offer.member_id))) {
    throw new WaitlistStaffValidationError({ offer: 'You do not have access to accept this waitlist offer.' });
  }
  return respondToOffer({
    token: input.token,
    status: 'accepted',
    source: 'offer_response',
    actorMemberId: input.actorMemberId,
    reason: 'waitlist-offer-accepted-by-member',
  });
}

export async function autoAcceptExpiredWaitlistOffers(limit = 50): Promise<{ processed: number }> {
  const { db, schema } = getDrizzleDb();
  const now = new Date();
  const offers = await db
    .select({ id: schema.waitlistOffers.id })
    .from(schema.waitlistOffers)
    .where(
      and(
        eq(schema.waitlistOffers.status, 'pending'),
        lt(schema.waitlistOffers.expires_at, dbValue(getDatabaseConfig()?.type === 'postgres' ? now : now.toISOString()))
      )
    )
    .orderBy(asc(schema.waitlistOffers.expires_at), asc(schema.waitlistOffers.id))
    .limit(limit);
  let processed = 0;
  for (const offer of offers) {
    const result = await respondToOffer({
      offerId: offer.id,
      status: 'expired_accepted',
      source: 'offer_expiration',
      reason: 'waitlist-offer-auto-accepted',
    });
    if (result.changed) processed += 1;
  }
  return { processed };
}

export async function cancelWaitlistOffer(input: { offerId: number; actorMemberId: number; reason: string }) {
  const { db, schema } = getDrizzleDb();
  const reason = requireReason(input.reason);
  const [offer] = await db.select().from(schema.waitlistOffers).where(eq(schema.waitlistOffers.id, input.offerId)).limit(1);
  if (!offer) throw new WaitlistStaffValidationError({ offer: 'Waitlist offer was not found.' });
  if (offer.status !== 'pending') throw new WaitlistStaffValidationError({ offer: 'Only pending offers can be cancelled.' });
  await db.transaction(async (tx) => {
    await tx
      .update(schema.waitlistOffers)
      .set({ status: 'cancelled', cancellation_reason: reason, responded_at: dbNow(), response_source: 'staff_action', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.waitlistOffers.id, offer.id));
    await createAuditEvent(tx, {
      waitlistEntryId: offer.waitlist_entry_id,
      leagueId: offer.league_id,
      memberId: offer.member_id,
      actorMemberId: input.actorMemberId,
      source: 'staff_action',
      action: 'offer_cancelled',
      reason,
      before: offer,
      after: { ...offer, status: 'cancelled', cancellationReason: reason },
      metadata: { offerId: offer.id },
    });
  });
  return { offerId: offer.id, status: 'cancelled' };
}

export async function addWaitlistEntry(input: {
  leagueId: number;
  memberId: number;
  entryType: WaitlistEntryTypeSqlite;
  replacesLeagueId?: number | null;
  actorMemberId: number;
  reason: string;
}) {
  const { db, schema } = getDrizzleDb();
  const reason = requireReason(input.reason);
  const league = await loadLeague(input.leagueId);
  if (league.league_type === 'bring_your_own_team') throw new WaitlistStaffValidationError({ league: 'BYOT leagues do not use waitlists.' });
  if (input.entryType === 'replace' && !input.replacesLeagueId) {
    throw new WaitlistStaffValidationError({ replacesLeagueId: 'A replacement league is required for REPLACE entries.' });
  }
  const registrationId = await getLatestRegistrationForMember(input.memberId, league.session_id);
  const [entry] = await db
    .insert(schema.waitlistEntries)
    .values({
      league_id: input.leagueId,
      member_id: input.memberId,
      source_registration_id: registrationId,
      entry_type: input.entryType,
      replaces_league_id: input.entryType === 'replace' ? input.replacesLeagueId ?? null : null,
      position_sort_key: nextPositionSortKey(),
      joined_at: dbNow(),
      decline_count: 0,
      status: 'active',
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .returning();
  await createAuditEvent(db, {
    waitlistEntryId: entry.id,
    leagueId: entry.league_id,
    memberId: entry.member_id,
    actorMemberId: input.actorMemberId,
    source: 'staff_action',
    action: 'entry_created',
    reason,
    after: entry,
  });
  return { entry };
}

export async function removeWaitlistEntry(input: { entryId: number; actorMemberId: number; reason: string }) {
  const { db, schema } = getDrizzleDb();
  const reason = requireReason(input.reason);
  const entry = await loadEntry(input.entryId);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.waitlistEntries)
      .set({ status: 'removed', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.waitlistEntries.id, input.entryId));
    await createAuditEvent(tx, {
      waitlistEntryId: entry.id,
      leagueId: entry.league_id,
      memberId: entry.member_id,
      actorMemberId: input.actorMemberId,
      source: 'staff_action',
      action: 'entry_removed',
      reason,
      before: entry,
      after: { ...entry, status: 'removed' },
    });
  });
  const [member] = await db.select().from(schema.members).where(eq(schema.members.id, entry.member_id)).limit(1);
  const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, entry.league_id)).limit(1);
  if (member) {
    await safeSendWaitlistCommunication({
      messageType: 'waitlist_changed_by_staff',
      member,
      registrationId: entry.source_registration_id ?? null,
      waitlistEntryId: entry.id,
      payload: {
        leagueName: league?.name,
        changedSummary: 'Staff removed your waitlist entry.',
      },
    });
  }
  return { entryId: input.entryId, status: 'removed' };
}

export async function moveWaitlistEntryToBottom(input: { entryId: number; actorMemberId: number; reason: string }) {
  const { db, schema } = getDrizzleDb();
  const reason = requireReason(input.reason);
  const entry = await loadEntry(input.entryId);
  const after = { position_sort_key: nextPositionSortKey(), decline_count: 0, status: 'active' as const };
  await db.transaction(async (tx) => {
    await tx.update(schema.waitlistEntries).set({ ...after, updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(schema.waitlistEntries.id, entry.id));
    await createAuditEvent(tx, {
      waitlistEntryId: entry.id,
      leagueId: entry.league_id,
      memberId: entry.member_id,
      actorMemberId: input.actorMemberId,
      source: 'staff_action',
      action: 'entry_moved_to_bottom',
      reason,
      before: entry,
      after,
    });
  });
  const [member] = await db.select().from(schema.members).where(eq(schema.members.id, entry.member_id)).limit(1);
  const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, entry.league_id)).limit(1);
  if (member) {
    await safeSendWaitlistCommunication({
      messageType: 'waitlist_changed_by_staff',
      member,
      registrationId: entry.source_registration_id ?? null,
      waitlistEntryId: entry.id,
      payload: {
        leagueName: league?.name,
        changedSummary: 'Staff moved your waitlist entry to the bottom of the waitlist.',
      },
    });
  }
  return { entryId: entry.id, status: 'active' };
}

export async function updateWaitlistEntry(input: {
  entryId: number;
  actorMemberId: number;
  reason: string;
  entryType?: WaitlistEntryTypeSqlite;
  replacesLeagueId?: number | null;
}) {
  const { db, schema } = getDrizzleDb();
  const reason = requireReason(input.reason);
  const entry = await loadEntry(input.entryId);
  const entryType = input.entryType ?? entry.entry_type;
  if (entryType === 'replace' && !input.replacesLeagueId && !entry.replaces_league_id) {
    throw new WaitlistStaffValidationError({ replacesLeagueId: 'A replacement league is required for REPLACE entries.' });
  }
  const values = {
    entry_type: entryType,
    replaces_league_id: entryType === 'replace' ? input.replacesLeagueId ?? entry.replaces_league_id : null,
    updated_at: sql`CURRENT_TIMESTAMP`,
  };
  const action: WaitlistAuditActionSqlite =
    entry.entry_type !== entryType
      ? entryType === 'replace'
        ? 'entry_converted_add_to_replace'
        : 'entry_converted_replace_to_add'
      : 'replacement_league_changed';
  const [updated] = await db.update(schema.waitlistEntries).set(values).where(eq(schema.waitlistEntries.id, entry.id)).returning();
  await createAuditEvent(db, {
    waitlistEntryId: entry.id,
    leagueId: entry.league_id,
    memberId: entry.member_id,
    actorMemberId: input.actorMemberId,
    source: 'staff_action',
    action,
    reason,
    before: entry,
    after: updated,
  });
  const [member] = await db.select().from(schema.members).where(eq(schema.members.id, entry.member_id)).limit(1);
  const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, entry.league_id)).limit(1);
  if (member) {
    await safeSendWaitlistCommunication({
      messageType: 'waitlist_changed_by_staff',
      member,
      registrationId: entry.source_registration_id ?? null,
      waitlistEntryId: entry.id,
      payload: {
        leagueName: league?.name,
        changedSummary: entry.entry_type !== updated.entry_type ? 'Staff changed your waitlist type.' : 'Staff updated your waitlist entry.',
      },
    });
  }
  return { entry: updated };
}

export async function rollWaitlistForwardForStaff(input: {
  fromLeagueId: number;
  toLeagueId?: number;
  actorMemberId: number;
  reason: string;
}) {
  const reason = requireReason(input.reason);
  return rollWaitlistForward({
    fromLeagueId: input.fromLeagueId,
    toLeagueId: input.toLeagueId,
    actorMemberId: input.actorMemberId,
    reason,
  });
}

export async function triggerWaitlistDeferredPayment(input: { offerId: number; actorMemberId: number; reason: string }) {
  const { db, schema } = getDrizzleDb();
  const reason = requireReason(input.reason);
  const [offer] = await db.select().from(schema.waitlistOffers).where(eq(schema.waitlistOffers.id, input.offerId)).limit(1);
  if (!offer?.source_registration_id) {
    throw new WaitlistStaffValidationError({ registration: 'This offer is not linked to a registration.' });
  }
  if (offer.status !== 'accepted' && offer.status !== 'expired_accepted') {
    throw new WaitlistStaffValidationError({ offer: 'Payment can be triggered only after the offer has been accepted or auto-accepted.' });
  }
  const result = await triggerDeferredRegistrationPayment({
    registrationId: offer.source_registration_id,
    actorMemberId: input.actorMemberId,
  });
  await createAuditEvent(db, {
    waitlistEntryId: offer.waitlist_entry_id,
    leagueId: offer.league_id,
    memberId: offer.member_id,
    actorMemberId: input.actorMemberId,
    source: 'staff_action',
    action: 'staff_correction',
    reason,
    after: result,
    metadata: { offerId: offer.id, paymentTrigger: true },
  });
  return result;
}
