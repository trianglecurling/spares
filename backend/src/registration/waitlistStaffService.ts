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
  WaitlistOfferResponsePreferenceSqlite,
  WaitlistOfferStatusSqlite,
} from '../db/drizzle-schema.js';
import { WAITLIST_OFFER_RESPONSE_PREFERENCE_LABELS } from './waitlistOfferPreference.js';
import { validateWaitlistEligibility } from './registrationEligibility.js';
import { buildRegistrationContextForDraft, triggerDeferredRegistrationPayment } from './registrationMembershipPaymentService.js';
import { sendRegistrationEmailForDashboard, type RegistrationEmailPayload, type RegistrationMessageType } from './registrationEmailService.js';
import {
  leagueAllowsWaitlist,
  replacementLineageFromLeagueId,
  resolvePlacementLeagueForWaitlist,
} from './waitlistEntityService.js';
import {
  getWaitlistQueuePosition,
  insertWaitlistAuditEvent,
  recordAndDeleteWaitlistEntry,
  serializeWaitlistAuditEvent,
  waitlistMemberDisplayName,
} from './waitlistAudit.js';
import { rollWaitlistForward } from './waitlistRolloverService.js';
import { loadLeagueContinuityMap, resolveLeagueInSession } from './waitlistLineage.js';
import {
  compareLeaguesByDayThenFirstDraw,
  loadFirstDrawTimeByLeagueId,
  pickLeagueWithLatestStartDate,
} from '../utils/leagueOrdering.js';
import {
  hydrateTeamRosterPlacementsForEntry,
  normalizeAndValidateTeamRosterPlacements,
  parseTeamRosterPlacements,
  serializeTeamRosterPlacements,
  type WaitlistTeamMemberPlacementInput,
} from './waitlistTeamRoster.js';

import { sendWaitlistEntryJoinedNotifications } from './waitlistJoinedNotificationService.js';
import { assertMembersAvailableForWaitlist } from './waitlistMemberMembership.js';
import { WaitlistStaffValidationError } from './waitlistErrors.js';
import {
  shouldOfferPermanentWaitlistEntry,
  skipLowerPriorityWaitlistEntriesAfterAcceptance,
  type WaitlistEntryCoordinationRow,
} from './waitlistOfferCoordination.js';
export { WaitlistStaffValidationError } from './waitlistErrors.js';

type WaitlistEntryRow = typeof getDrizzleDb extends () => infer T
  ? T extends { schema: infer S }
    ? S extends { waitlistEntries: infer W }
      ? W extends { $inferSelect: infer R }
        ? R
        : any
      : any
    : any
  : any;

function dbValue(value: unknown): never {
  return value as never;
}

function dbNow(): never {
  return dbValue(getDatabaseConfig()?.type === 'postgres' ? new Date() : new Date().toISOString());
}

async function resolveWaitlistEntryRoster(input: {
  league: {
    league_type: string;
    format: string;
    session_id: number | null;
  };
  primaryMemberId: number;
  entryType: WaitlistEntryTypeSqlite;
  replacesLeagueId?: number | null;
  teamRosterText?: string | null;
  teamRosterPlacements?: WaitlistTeamMemberPlacementInput[] | null;
  existingTeamRosterText?: string | null;
  existingTeamRosterPlacements?: string | null;
  enforceMemberPlacementRules: boolean;
}): Promise<{
  entryType: WaitlistEntryTypeSqlite;
  replacesLeagueId: number | null;
  teamRosterText: string | null;
  teamRosterPlacements: string | null;
}> {
  if (input.league.league_type !== 'bring_your_own_team') {
    const entryType = input.entryType;
    if (entryType === 'replace' && !input.replacesLeagueId) {
      throw new WaitlistStaffValidationError({
        replacesLeagueId: 'A replacement league is required for REPLACE entries.',
      });
    }
    return {
      entryType,
      replacesLeagueId: entryType === 'replace' ? input.replacesLeagueId ?? null : null,
      teamRosterText: null,
      teamRosterPlacements: null,
    };
  }

  if (input.league.session_id == null) {
    throw new WaitlistStaffValidationError({ session: 'Placement league session was not found.' });
  }

  const normalized = await normalizeAndValidateTeamRosterPlacements({
    league: input.league,
    primaryMemberId: input.primaryMemberId,
    sessionId: input.league.session_id,
    placements:
      input.teamRosterPlacements ??
      (input.teamRosterText === undefined && input.existingTeamRosterPlacements
        ? parseTeamRosterPlacements(input.existingTeamRosterPlacements)
        : null),
    fallbackEntryType: input.entryType,
    fallbackReplacesLeagueId: input.replacesLeagueId ?? null,
    teamRosterText:
      input.teamRosterText ??
      (input.teamRosterPlacements == null ? input.existingTeamRosterText ?? null : null),
    enforceMemberPlacementRules: input.enforceMemberPlacementRules,
  });

  return {
    entryType: normalized.entryType,
    replacesLeagueId: normalized.replacesLeagueId,
    teamRosterText: normalized.teamRosterText,
    teamRosterPlacements: serializeTeamRosterPlacements(normalized.placements),
  };
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
    metadata?: Record<string, unknown>;
    memberName?: string | null;
    actorMemberName?: string | null;
    summary?: string | null;
    position?: number | null;
    queueTotal?: number | null;
    offerType?: string | null;
  }
) {
  await insertWaitlistAuditEvent(tx, input);
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

async function requireLeagueWaitlist(leagueId: number) {
  const league = await loadLeague(leagueId);
  if (!league.waitlist_id) {
    throw new WaitlistStaffValidationError({ waitlistId: 'This league is not attached to a waitlist.' });
  }
  return { league, waitlistId: league.waitlist_id };
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
  const leagueWaitlistLinks = await db
    .select({ leagueId: schema.leagues.id, waitlistId: schema.leagues.waitlist_id })
    .from(schema.leagues)
    .where(inArray(schema.leagues.id, leagueIds));
  const waitlistIds = [
    ...new Set(leagueWaitlistLinks.map((row) => row.waitlistId).filter((id): id is number => id != null)),
  ];
  if (waitlistIds.length > 0) {
    const waitlistRows = await db
      .select({ waitlistId: schema.waitlistEntries.waitlist_id, total: sql<number>`COUNT(*)` })
      .from(schema.waitlistEntries)
      .where(and(inArray(schema.waitlistEntries.waitlist_id, waitlistIds), eq(schema.waitlistEntries.status, 'active')))
      .groupBy(schema.waitlistEntries.waitlist_id);
    const countByWaitlist = new Map(waitlistRows.map((row) => [row.waitlistId, Number(row.total ?? 0)]));
    for (const link of leagueWaitlistLinks) {
      if (link.waitlistId != null) {
        waitlists.set(link.leagueId, countByWaitlist.get(link.waitlistId) ?? 0);
      }
    }
  }

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
  if (!league.waitlist_id) warnings.push('missing_waitlist');
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
      hasWaitlist: Boolean(league.waitlist_id),
      warnings: await warningCodesForLeague(league),
    });
  }
  return { leagues: rows };
}

export async function getLeagueWaitlistManager(leagueId: number) {
  const { db, schema } = getDrizzleDb();
  const { league, waitlistId } = await requireLeagueWaitlist(leagueId);
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
      replacesLineageStartLeagueId: schema.waitlistEntries.replaces_lineage_start_league_id,
      originalReplacesLeagueId: schema.waitlistEntries.original_replaces_league_id,
      teamRosterText: schema.waitlistEntries.team_roster_text,
      teamRosterPlacementsJson: schema.waitlistEntries.team_roster_placements,
      sourceRegistrationId: schema.waitlistEntries.source_registration_id,
      positionSortKey: schema.waitlistEntries.position_sort_key,
      joinedAt: schema.waitlistEntries.joined_at,
      declineCount: schema.waitlistEntries.decline_count,
      offerResponsePreference: schema.waitlistEntries.offer_response_preference,
      desiredAddWaitlistLeagueCount: schema.waitlistEntries.desired_add_waitlist_league_count,
      addWaitlistPriorityRank: schema.waitlistEntries.add_waitlist_priority_rank,
      status: schema.waitlistEntries.status,
      rolledOverFromWaitlistEntryId: schema.waitlistEntries.rolled_over_from_waitlist_entry_id,
    })
    .from(schema.waitlistEntries)
    .innerJoin(schema.members, eq(schema.waitlistEntries.member_id, schema.members.id))
    .where(and(eq(schema.waitlistEntries.waitlist_id, waitlistId), eq(schema.waitlistEntries.status, 'active')))
    .orderBy(asc(schema.waitlistEntries.position_sort_key), asc(schema.waitlistEntries.joined_at), asc(schema.waitlistEntries.id));

  const continuity = await loadLeagueContinuityMap();
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
      format: league.format,
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
    waitlistEntries: await Promise.all(
      waitlistRows.map(async (row, index) => {
      const replacesLeagueId =
        row.replacesLineageStartLeagueId != null && league.session_id != null
          ? resolveLeagueInSession(row.replacesLineageStartLeagueId, league.session_id, continuity)
          : row.originalReplacesLeagueId;
      const teamRosterPlacements = await hydrateTeamRosterPlacementsForEntry({
        primaryMemberId: row.memberId,
        entryType: row.entryType,
        replacesLeagueId,
        teamRosterPlacementsJson: row.teamRosterPlacementsJson,
        teamRosterText: row.teamRosterText,
      });
      return {
        ...row,
        replacesLeagueId,
        teamRosterText: row.teamRosterText ?? null,
        teamRosterPlacements,
        memberName: memberName({
          name: row.memberName,
          first_name: row.firstName,
          last_name: row.lastName,
          email: row.memberEmail,
        }),
        position: index + 1,
        offerResponsePreference: (row.offerResponsePreference ?? 'ask') as WaitlistOfferResponsePreferenceSqlite,
        offerResponsePreferenceLabel:
          WAITLIST_OFFER_RESPONSE_PREFERENCE_LABELS[
            (row.offerResponsePreference ?? 'ask') as WaitlistOfferResponsePreferenceSqlite
          ],
        pendingOffer: (offersByEntry.get(row.id) ?? []).find((offer) => offer.status === 'pending') ?? null,
        acceptedOffer:
          (offersByEntry.get(row.id) ?? []).find((offer) => offer.status === 'accepted' || offer.status === 'expired_accepted') ??
          null,
        offers: offersByEntry.get(row.id) ?? [],
      };
    }),
    ),
    auditEvents: auditRows.map((row) => serializeWaitlistAuditEvent(row)),
  };
}

export async function listWaitlistsOverview(input: { sessionId?: number | null } = {}) {
  const { db, schema } = getDrizzleDb();
  const sessionId = input.sessionId ?? null;
  const waitlists = await db
    .select()
    .from(schema.leagueWaitlists)
    .where(eq(schema.leagueWaitlists.status, 'active'));

  const leagues = await db
    .select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      sessionId: schema.leagues.session_id,
      waitlistId: schema.leagues.waitlist_id,
      capacityValue: schema.leagues.capacity_value,
      leagueType: schema.leagues.league_type,
      dayOfWeek: schema.leagues.day_of_week,
      startDate: schema.leagues.start_date,
    })
    .from(schema.leagues)
    .where(sql`${schema.leagues.waitlist_id} IS NOT NULL`);

  const filteredLeagues =
    sessionId != null ? leagues.filter((league) => league.sessionId === sessionId) : leagues;
  const waitlistIdsInScope = new Set(
    filteredLeagues.map((league) => league.waitlistId).filter((id): id is number => id != null)
  );
  const scopedWaitlists =
    sessionId != null ? waitlists.filter((waitlist) => waitlistIdsInScope.has(waitlist.id)) : waitlists;

  const sessionIds = [...new Set(filteredLeagues.map((league) => league.sessionId).filter((id): id is number => id != null))];
  const sessions =
    sessionIds.length > 0
      ? await db
          .select({ id: schema.curlingSessions.id, name: schema.curlingSessions.name })
          .from(schema.curlingSessions)
          .where(inArray(schema.curlingSessions.id, sessionIds))
      : [];
  const sessionNameById = new Map(sessions.map((session) => [session.id, session.name]));

  const entryCounts =
    scopedWaitlists.length > 0
      ? await db
          .select({
            waitlistId: schema.waitlistEntries.waitlist_id,
            total: sql<number>`COUNT(*)`,
          })
          .from(schema.waitlistEntries)
          .where(
            and(
              inArray(
                schema.waitlistEntries.waitlist_id,
                scopedWaitlists.map((waitlist) => waitlist.id)
              ),
              eq(schema.waitlistEntries.status, 'active')
            )
          )
          .groupBy(schema.waitlistEntries.waitlist_id)
      : [];
  const activeEntriesByWaitlist = new Map(entryCounts.map((row) => [row.waitlistId, Number(row.total ?? 0)]));

  const placementLeagueIds = filteredLeagues.map((league) => league.id);
  const { waitlists: waitlistByLeague, offers: offersByLeague } = await countActiveWaitlistsAndPendingOffers(placementLeagueIds);

  const leaguesByWaitlist = new Map<number, typeof filteredLeagues>();
  for (const league of filteredLeagues) {
    if (league.waitlistId == null) continue;
    const list = leaguesByWaitlist.get(league.waitlistId) ?? [];
    list.push(league);
    leaguesByWaitlist.set(league.waitlistId, list);
  }

  const firstDrawByLeagueId = await loadFirstDrawTimeByLeagueId(
    db,
    schema,
    filteredLeagues.map((league) => league.id)
  );

  const sortedWaitlists = [...scopedWaitlists].sort((left, right) => {
    const leftLeague = pickLeagueWithLatestStartDate(leaguesByWaitlist.get(left.id) ?? []);
    const rightLeague = pickLeagueWithLatestStartDate(leaguesByWaitlist.get(right.id) ?? []);
    if (!leftLeague && !rightLeague) return left.name.localeCompare(right.name);
    if (!leftLeague) return 1;
    if (!rightLeague) return -1;

    const leagueOrder = compareLeaguesByDayThenFirstDraw(
      { id: leftLeague.id, name: leftLeague.name, dayOfWeek: leftLeague.dayOfWeek },
      { id: rightLeague.id, name: rightLeague.name, dayOfWeek: rightLeague.dayOfWeek },
      firstDrawByLeagueId
    );
    if (leagueOrder !== 0) return leagueOrder;
    return left.name.localeCompare(right.name);
  });

  return {
    waitlists: sortedWaitlists.map((waitlist) => {
      const attached = leaguesByWaitlist.get(waitlist.id) ?? [];
      const pendingOffers = attached.reduce((sum, league) => sum + (offersByLeague.get(league.id) ?? 0), 0);
      return {
        id: waitlist.id,
        name: waitlist.name,
        status: waitlist.status,
        activeEntryCount: activeEntriesByWaitlist.get(waitlist.id) ?? 0,
        pendingOffers,
        attachedLeagues: attached.map((league) => ({
          id: league.id,
          name: league.name,
          sessionId: league.sessionId,
          sessionName: league.sessionId ? (sessionNameById.get(league.sessionId) ?? null) : null,
          capacity: league.capacityValue ?? 0,
          leagueType: league.leagueType,
          activeWaitlistEntries: waitlistByLeague.get(league.id) ?? 0,
        })),
      };
    }),
  };
}

async function loadWaitlistOrThrow(waitlistId: number) {
  const { db, schema } = getDrizzleDb();
  const [waitlist] = await db
    .select()
    .from(schema.leagueWaitlists)
    .where(eq(schema.leagueWaitlists.id, waitlistId))
    .limit(1);
  if (!waitlist || waitlist.status !== 'active') {
    throw new WaitlistStaffValidationError({ waitlistId: 'Waitlist was not found.' });
  }
  return waitlist;
}

export async function renameWaitlist(input: {
  waitlistId: number;
  name: string;
}): Promise<{ waitlist: { id: number; name: string; status: string } }> {
  const waitlist = await loadWaitlistOrThrow(input.waitlistId);
  const name = input.name.trim();
  if (!name) {
    throw new WaitlistStaffValidationError({ name: 'Waitlist name is required.' });
  }
  if (waitlist.name === name) {
    return { waitlist: { id: waitlist.id, name: waitlist.name, status: waitlist.status } };
  }

  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.leagueWaitlists)
    .set({ name, updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(schema.leagueWaitlists.id, input.waitlistId));

  return { waitlist: { id: waitlist.id, name, status: waitlist.status } };
}

export async function getWaitlistManagerById(input: {
  waitlistId: number;
  placementLeagueId?: number | null;
}) {
  const { db, schema } = getDrizzleDb();
  const waitlist = await loadWaitlistOrThrow(input.waitlistId);
  const attachedLeagues = await db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.waitlist_id, input.waitlistId))
    .orderBy(asc(schema.leagues.name));
  if (attachedLeagues.length === 0) {
    throw new WaitlistStaffValidationError({ waitlistId: 'No league is attached to this waitlist.' });
  }

  const placementLeague =
    input.placementLeagueId != null
      ? attachedLeagues.find((league) => league.id === input.placementLeagueId)
      : attachedLeagues[attachedLeagues.length - 1];
  if (!placementLeague) {
    throw new WaitlistStaffValidationError({ placementLeagueId: 'Placement league is not attached to this waitlist.' });
  }

  const manager = await getLeagueWaitlistManager(placementLeague.id);
  const sessionIds = [...new Set(attachedLeagues.map((league) => league.session_id).filter((id): id is number => id != null))];
  const sessions =
    sessionIds.length > 0
      ? await db
          .select({ id: schema.curlingSessions.id, name: schema.curlingSessions.name })
          .from(schema.curlingSessions)
          .where(inArray(schema.curlingSessions.id, sessionIds))
      : [];
  const sessionNameById = new Map(sessions.map((session) => [session.id, session.name]));

  return {
    waitlist: {
      id: waitlist.id,
      name: waitlist.name,
      status: waitlist.status,
    },
    placementLeagueId: placementLeague.id,
    attachedLeagues: attachedLeagues.map((league) => ({
      id: league.id,
      name: league.name,
      sessionId: league.session_id,
      sessionName: league.session_id ? (sessionNameById.get(league.session_id) ?? null) : null,
      leagueType: league.league_type,
      capacity: league.capacity_value ?? 0,
    })),
    league: manager.league,
    roster: manager.roster,
    waitlistEntries: manager.waitlistEntries,
    auditEvents: manager.auditEvents,
  };
}

export async function reorderWaitlistEntries(input: {
  waitlistId: number;
  entryIds: number[];
  actorMemberId: number;
  reason: string;
}) {
  const { db, schema } = getDrizzleDb();
  const reason = requireReason(input.reason);
  await loadWaitlistOrThrow(input.waitlistId);
  if (input.entryIds.length === 0) {
    throw new WaitlistStaffValidationError({ entryIds: 'At least one waitlist entry is required.' });
  }

  const entries = await db
    .select()
    .from(schema.waitlistEntries)
    .where(
      and(
        eq(schema.waitlistEntries.waitlist_id, input.waitlistId),
        eq(schema.waitlistEntries.status, 'active'),
        inArray(schema.waitlistEntries.id, input.entryIds)
      )
    );
  if (entries.length !== input.entryIds.length) {
    throw new WaitlistStaffValidationError({ entryIds: 'One or more waitlist entries were not found for this waitlist.' });
  }

  const placement = await resolvePlacementLeagueForWaitlist(input.waitlistId);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));

  await db.transaction(async (tx) => {
    for (let index = 0; index < input.entryIds.length; index += 1) {
      const entryId = input.entryIds[index]!;
      const entry = entryById.get(entryId);
      if (!entry) continue;
      const positionSortKey = `${String(index + 1).padStart(6, '0')}:${entryId}`;
      if (entry.position_sort_key === positionSortKey) continue;
      await tx
        .update(schema.waitlistEntries)
        .set({ position_sort_key: positionSortKey, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(eq(schema.waitlistEntries.id, entryId));
      await createAuditEvent(tx, {
        waitlistEntryId: entryId,
        leagueId: placement?.leagueId ?? null,
        memberId: entry.member_id,
        actorMemberId: input.actorMemberId,
        source: 'staff_action',
        action: 'entry_reordered',
        reason,
        before: { positionSortKey: entry.position_sort_key },
        after: { positionSortKey },
        metadata: { waitlistId: input.waitlistId, position: index + 1 },
        position: index + 1,
        queueTotal: input.entryIds.length,
      });
    }
  });

  return { waitlistId: input.waitlistId, entryIds: input.entryIds };
}

export async function addWaitlistEntryForWaitlist(input: {
  waitlistId: number;
  placementLeagueId: number;
  memberId: number;
  entryType: WaitlistEntryTypeSqlite;
  replacesLeagueId?: number | null;
  teamRosterText?: string | null;
  teamRosterPlacements?: WaitlistTeamMemberPlacementInput[] | null;
  actorMemberId: number;
  reason: string;
}) {
  const league = await loadLeague(input.placementLeagueId);
  if (league.waitlist_id !== input.waitlistId) {
    throw new WaitlistStaffValidationError({
      placementLeagueId: 'The placement league is not attached to this waitlist.',
    });
  }
  return addWaitlistEntry({
    leagueId: input.placementLeagueId,
    memberId: input.memberId,
    entryType: input.entryType,
    replacesLeagueId: input.replacesLeagueId,
    teamRosterText: input.teamRosterText,
    teamRosterPlacements: input.teamRosterPlacements,
    actorMemberId: input.actorMemberId,
    reason: input.reason,
  });
}

async function validateOfferCandidate(input: {
  entry: WaitlistEntryRow;
  placementLeagueId: number;
  offerType: WaitlistOfferKindSqlite;
  override?: boolean;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  if (input.entry.status !== 'active') {
    throw new WaitlistStaffValidationError({ waitlistEntry: 'Only active waitlist entries can receive offers.' });
  }
  const league = await loadLeague(input.placementLeagueId);
  if (!leagueAllowsWaitlist(league)) {
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
        eq(schema.waitlistOffers.league_id, input.placementLeagueId),
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
        eq(schema.leagueRoster.league_id, input.placementLeagueId),
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
    const targetLeague = context.leagues[input.placementLeagueId];
    const decision = targetLeague ? validateWaitlistEligibility(context, targetLeague) : null;
    if (!decision?.allowed) {
      throw new WaitlistStaffValidationError({
        eligibility: decision?.blockingErrors[0]?.message ?? 'This member is not eligible for the league.',
      });
    }
  }
}

function toCoordinationEntry(entry: WaitlistEntryRow): WaitlistEntryCoordinationRow {
  return {
    id: entry.id,
    member_id: entry.member_id,
    waitlist_id: entry.waitlist_id,
    source_registration_id: entry.source_registration_id ?? null,
    entry_type: entry.entry_type,
    desired_add_waitlist_league_count: entry.desired_add_waitlist_league_count ?? null,
    add_waitlist_priority_rank: entry.add_waitlist_priority_rank ?? null,
    status: entry.status,
  };
}

async function selectOfferEntries(input: {
  leagueId: number;
  sessionId: number | null;
  entryIds?: number[];
  count?: number;
  offerType: WaitlistOfferKindSqlite;
  override?: boolean;
  alreadySelectedEntryIds?: Set<number>;
}): Promise<WaitlistEntryRow[]> {
  const { db, schema } = getDrizzleDb();
  const { waitlistId } = await requireLeagueWaitlist(input.leagueId);
  const baseRows = await db
    .select()
    .from(schema.waitlistEntries)
    .where(
      and(
        eq(schema.waitlistEntries.waitlist_id, waitlistId),
        input.entryIds?.length ? inArray(schema.waitlistEntries.id, input.entryIds) : eq(schema.waitlistEntries.status, 'active')
      )
    )
    .orderBy(asc(schema.waitlistEntries.position_sort_key), asc(schema.waitlistEntries.joined_at), asc(schema.waitlistEntries.id));
  const requestedCount = input.entryIds?.length ?? input.count ?? 1;
  const eligible: WaitlistEntryRow[] = [];
  const errors: Record<string, string> = {};
  const alreadySelectedEntryIds = input.alreadySelectedEntryIds ?? new Set<number>();
  for (const entry of baseRows) {
    try {
      await validateOfferCandidate({
        entry,
        placementLeagueId: input.leagueId,
        offerType: input.offerType,
        override: input.override,
      });
      if (input.sessionId != null) {
        const coordination = await shouldOfferPermanentWaitlistEntry({
          entry: toCoordinationEntry(entry as WaitlistEntryRow),
          sessionId: input.sessionId,
          offerType: input.offerType,
          alreadySelectedEntryIds,
        });
        if (!coordination.allowed) {
          if (input.entryIds?.includes(entry.id)) {
            errors.entry = coordination.reason ?? 'This waitlist entry cannot be offered right now.';
          }
          continue;
        }
      }
      eligible.push(entry as WaitlistEntryRow);
      alreadySelectedEntryIds.add(entry.id);
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
  alreadySelectedEntryIds?: Set<number>;
}) {
  const reason = requireReason(input.reason ?? 'waitlist-offer-sent');
  const { db, schema } = getDrizzleDb();
  const league = await loadLeague(input.leagueId);
  const entries = await selectOfferEntries({
    ...input,
    sessionId: league.session_id ?? null,
    alreadySelectedEntryIds: input.alreadySelectedEntryIds,
  });
  const offeredAt = new Date();
  const expiresAt = responseDeadline(offeredAt);
  const createdOffers: Array<{ offer: any; preference: WaitlistOfferResponsePreferenceSqlite; entry: WaitlistEntryRow }> = [];

  await db.transaction(async (tx) => {
    for (const entry of entries) {
      const token = generateResponseToken();
      const preference = (entry.offer_response_preference ?? 'ask') as WaitlistOfferResponsePreferenceSqlite;
      const [offer] = await tx
        .insert(schema.waitlistOffers)
        .values({
          waitlist_entry_id: entry.id,
          league_id: input.leagueId,
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
        leagueId: input.leagueId,
        memberId: entry.member_id,
        actorMemberId: input.actorMemberId,
        source: 'staff_action',
        action: 'offer_sent',
        reason,
        after: offer,
        metadata: { offerType: input.offerType, override: input.override === true, offerResponsePreference: preference },
        offerType: input.offerType,
      });
      createdOffers.push({ offer, preference, entry: entry as WaitlistEntryRow });
      input.alreadySelectedEntryIds?.add(entry.id);
    }
  });

  for (const { offer, preference, entry } of createdOffers) {
    if (preference === 'auto_accept') {
      await respondToOffer({
        offerId: offer.id,
        status: 'accepted',
        source: 'placement_process',
        actorMemberId: input.actorMemberId,
        reason: 'waitlist-offer-auto-accepted-from-registration-preference',
      });
      input.alreadySelectedEntryIds?.add(entry.id);
      continue;
    }
    if (preference === 'auto_decline') {
      await respondToOffer({
        offerId: offer.id,
        status: 'declined',
        source: 'placement_process',
        actorMemberId: input.actorMemberId,
        reason: 'waitlist-offer-auto-declined-from-registration-preference',
      });
      continue;
    }
    input.alreadySelectedEntryIds?.add(entry.id);
  }

  for (const { offer, preference } of createdOffers) {
    if (preference !== 'ask') continue;
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
        acceptUrl: `${config.frontendUrl.replace(/\/+$/, '')}/login?redirect=${encodeURIComponent(`/registration/waitlist-offers/${offer.id}/accept`)}`,
        declineUrl: `${config.frontendUrl.replace(/\/+$/, '')}/login?redirect=${encodeURIComponent(`/registration/waitlist-offers/${offer.id}/decline`)}`,
      },
    });
  }

  return { offers: createdOffers.map((item) => item.offer) };
}

export async function processBatchVacancyOffers(input: {
  sessionId: number;
  leagueIds?: number[];
  offerType: WaitlistOfferKindSqlite;
  actorMemberId: number;
  reason: string;
  override?: boolean;
}) {
  const dashboard = await getWaitlistDashboard({ sessionId: input.sessionId });
  const vacancyField =
    input.offerType === 'temporary_sabbatical_fill' ? 'temporarySabbaticalFillVacancies' : 'permanentVacancies';
  const candidateLeagues = dashboard.leagues
    .filter((league) => league.hasWaitlist && (league[vacancyField] as number) > 0)
    .filter((league) => (input.leagueIds?.length ? input.leagueIds.includes(league.id) : true));
  const sortedLeagueIds = candidateLeagues.map((league) => league.id);
  const alreadySelectedEntryIds = new Set<number>();
  const results: Array<{ leagueId: number; offers: any[] }> = [];

  for (const league of candidateLeagues) {
    const count = league[vacancyField] as number;
    if (count <= 0) continue;
    try {
      const result = await sendWaitlistOffers({
        leagueId: league.id,
        offerType: input.offerType,
        count,
        reason: input.reason,
        override: input.override,
        actorMemberId: input.actorMemberId,
        alreadySelectedEntryIds,
      });
      results.push({ leagueId: league.id, offers: result.offers });
    } catch (error) {
      if (error instanceof WaitlistStaffValidationError && error.details.entries) {
        continue;
      }
      throw error;
    }
  }

  return {
    sessionId: input.sessionId,
    processedLeagueIds: sortedLeagueIds,
    results,
    offersCreated: results.reduce((total, result) => total + result.offers.length, 0),
  };
}

async function placeAcceptedOffer(
  tx: any,
  input: {
    offer: any;
    entry: WaitlistEntryRow;
    placementLeagueId: number;
    status: WaitlistOfferStatusSqlite;
    source: WaitlistAuditSourceSqlite;
    actorMemberId?: number | null;
    reason: string;
  }
) {
  const { schema } = getDrizzleDb();
  const placementLeagueId = input.placementLeagueId;
  const placementType = offerTypeToPlacementType(input.entry.entry_type, input.offer.offer_type);
  const relatedSabbaticalId =
    input.offer.offer_type === 'temporary_sabbatical_fill'
      ? (
          await tx
            .select({ id: schema.curlingLeagueSabbaticals.id })
            .from(schema.curlingLeagueSabbaticals)
            .where(
              and(
                eq(schema.curlingLeagueSabbaticals.current_league_id, placementLeagueId),
                eq(schema.curlingLeagueSabbaticals.status, 'active')
              )
            )
            .limit(1)
        )[0]?.id ?? null
      : null;

  const [existingRoster] = await tx
    .select()
    .from(schema.leagueRoster)
    .where(and(eq(schema.leagueRoster.league_id, placementLeagueId), eq(schema.leagueRoster.member_id, input.entry.member_id)))
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
          league_id: placementLeagueId,
          member_id: input.entry.member_id,
          ...rosterValues,
        })
        .returning();

  await createAuditEvent(tx, {
    waitlistEntryId: input.entry.id,
    leagueId: placementLeagueId,
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
      leagueId: placementLeagueId,
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

  if (input.entry.entry_type === 'replace' && input.entry.replaces_lineage_start_league_id) {
    const placementLeague = await loadLeague(placementLeagueId);
    const { resolveLeagueInSessionFromDb } = await import('./waitlistLineage.js');
    const replacesLeagueId =
      placementLeague.session_id != null
        ? await resolveLeagueInSessionFromDb(input.entry.replaces_lineage_start_league_id, placementLeague.session_id)
        : null;
    if (replacesLeagueId) {
    const [released] = await tx
      .update(schema.leagueRoster)
      .set({ status: 'removed', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          eq(schema.leagueRoster.league_id, replacesLeagueId),
          eq(schema.leagueRoster.member_id, input.entry.member_id),
          eq(schema.leagueRoster.status, 'active')
        )
      )
      .returning();
    if (released) {
      await createAuditEvent(tx, {
        waitlistEntryId: input.entry.id,
        leagueId: replacesLeagueId,
        memberId: input.entry.member_id,
        actorMemberId: input.actorMemberId ?? null,
        source: 'placement_process',
        action: 'staff_correction',
        reason: `Released replaced league placement: ${input.reason}`,
        before: released,
        after: { ...released, status: 'removed' },
        metadata: { offerId: input.offer.id, targetLeagueId: placementLeagueId },
      });
    }
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
          eq(schema.registrationSelections.league_id, placementLeagueId),
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
      leagueId: offer.league_id,
      memberId: entry.member_id,
      actorMemberId: input.actorMemberId ?? null,
      source: input.source,
      action: input.status === 'declined' ? 'offer_declined' : input.status === 'accepted' ? 'offer_accepted' : 'offer_expired_accepted',
      reason,
      before: offer,
      after: { ...offer, status: input.status },
      metadata: { offerId: offer.id },
      offerType: offer.offer_type,
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
        leagueId: offer.league_id,
        memberId: entry.member_id,
        actorMemberId: input.actorMemberId ?? null,
        source: input.source,
        action: declineResolution.movedToBottom ? 'entry_moved_to_bottom' : 'decline_count_changed',
        reason,
        before,
        after,
        metadata: { offerId: offer.id, movedToBottom: declineResolution.movedToBottom },
        offerType: offer.offer_type,
      });
      return;
    }

    await placeAcceptedOffer(tx, {
      offer,
      entry,
      placementLeagueId: offer.league_id,
      status: input.status,
      source: input.source,
      actorMemberId: input.actorMemberId,
      reason,
    });

    if (input.status === 'accepted' || input.status === 'expired_accepted') {
      const [placementLeague] = await tx
        .select({ sessionId: schema.leagues.session_id })
        .from(schema.leagues)
        .where(eq(schema.leagues.id, offer.league_id))
        .limit(1);
      if (placementLeague?.sessionId != null && offer.offer_type === 'permanent') {
        await skipLowerPriorityWaitlistEntriesAfterAcceptance({
          tx,
          acceptedEntry: toCoordinationEntry(entry),
          sessionId: placementLeague.sessionId,
          actorMemberId: input.actorMemberId ?? null,
          reason: 'Higher-priority waitlist spot accepted for this member.',
          createAuditEvent,
        });
      }
    }
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

export async function declineWaitlistOfferForMember(input: { offerId: number; actorMemberId: number }) {
  const { db, schema } = getDrizzleDb();
  const [offer] = await db
    .select()
    .from(schema.waitlistOffers)
    .where(eq(schema.waitlistOffers.id, input.offerId))
    .limit(1);
  if (!offer) throw new WaitlistStaffValidationError({ offer: 'Waitlist offer was not found.' });
  if (!(await canActorImpersonateTarget(input.actorMemberId, offer.member_id))) {
    throw new WaitlistStaffValidationError({ offer: 'You do not have access to decline this waitlist offer.' });
  }
  return respondToOffer({
    offerId: input.offerId,
    status: 'declined',
    source: 'offer_response',
    actorMemberId: input.actorMemberId,
    reason: 'waitlist-offer-declined-by-member',
  });
}

export async function acceptWaitlistOfferForMember(input: { offerId: number; actorMemberId: number }) {
  const { db, schema } = getDrizzleDb();
  const [offer] = await db
    .select()
    .from(schema.waitlistOffers)
    .where(eq(schema.waitlistOffers.id, input.offerId))
    .limit(1);
  if (!offer) throw new WaitlistStaffValidationError({ offer: 'Waitlist offer was not found.' });
  if (!(await canActorImpersonateTarget(input.actorMemberId, offer.member_id))) {
    throw new WaitlistStaffValidationError({ offer: 'You do not have access to accept this waitlist offer.' });
  }
  return respondToOffer({
    offerId: input.offerId,
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
  if (offer.status !== 'pending') throw new WaitlistStaffValidationError({ offer: 'Only pending offers can be canceled.' });
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
  teamRosterText?: string | null;
  teamRosterPlacements?: WaitlistTeamMemberPlacementInput[] | null;
  actorMemberId: number;
  reason: string;
  auditSource?: WaitlistAuditSourceSqlite;
}) {
  const { db, schema } = getDrizzleDb();
  const reason = requireReason(input.reason);
  const { league, waitlistId } = await requireLeagueWaitlist(input.leagueId);
  const roster = await resolveWaitlistEntryRoster({
    league,
    primaryMemberId: input.memberId,
    entryType: input.entryType,
    replacesLeagueId: input.replacesLeagueId,
    teamRosterText: input.teamRosterText,
    teamRosterPlacements: input.teamRosterPlacements,
    enforceMemberPlacementRules: input.auditSource === 'member_self',
  });
  const rosterMemberIds =
    roster.teamRosterPlacements != null
      ? parseTeamRosterPlacements(roster.teamRosterPlacements).map((placement) => placement.memberId)
      : [input.memberId];
  await assertMembersAvailableForWaitlist({ waitlistId, memberIds: rosterMemberIds });
  const replacement =
    roster.entryType === 'replace' && roster.replacesLeagueId
      ? await replacementLineageFromLeagueId(roster.replacesLeagueId)
      : null;
  const registrationId = await getLatestRegistrationForMember(input.memberId, league.session_id);
  const [entry] = await db
    .insert(schema.waitlistEntries)
    .values({
      waitlist_id: waitlistId,
      member_id: input.memberId,
      source_registration_id: registrationId,
      entry_type: roster.entryType,
      replaces_lineage_start_league_id: replacement?.lineageStartLeagueId ?? null,
      original_replaces_league_id: replacement?.originalReplacesLeagueId ?? null,
      team_roster_text: roster.teamRosterText,
      team_roster_placements: roster.teamRosterPlacements,
      position_sort_key: nextPositionSortKey(),
      joined_at: dbNow(),
      decline_count: 0,
      status: 'active',
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .returning();
  const queuePosition = await getWaitlistQueuePosition(db, waitlistId, entry.id);
  await createAuditEvent(db, {
    waitlistEntryId: entry.id,
    leagueId: input.leagueId,
    memberId: entry.member_id,
    actorMemberId: input.actorMemberId,
    source: input.auditSource ?? 'staff_action',
    action: 'entry_created',
    reason,
    after: entry,
    position: queuePosition?.position ?? null,
    queueTotal: queuePosition?.total ?? null,
  });
  await sendWaitlistEntryJoinedNotifications({
    waitlistId,
    entryId: entry.id,
    leagueName: league.name,
    addedByMemberId: input.actorMemberId,
    addedBySource: input.auditSource === 'member_self' ? 'member_self' : 'staff_action',
    registrationId: entry.source_registration_id ?? null,
  });
  return { entry };
}

export async function removeWaitlistEntry(input: { entryId: number; actorMemberId: number; reason: string }) {
  const { db, schema } = getDrizzleDb();
  const reason = requireReason(input.reason);
  const entry = await loadEntry(input.entryId);
  if (entry.status !== 'active') {
    throw new WaitlistStaffValidationError({ waitlistEntry: 'Active waitlist entry was not found.' });
  }
  const placement = await resolvePlacementLeagueForWaitlist(entry.waitlist_id);
  const [member] = await db.select().from(schema.members).where(eq(schema.members.id, entry.member_id)).limit(1);
  const [actor] = await db.select().from(schema.members).where(eq(schema.members.id, input.actorMemberId)).limit(1);
  await db.transaction(async (tx) => {
    await recordAndDeleteWaitlistEntry(tx, {
      entry,
      leagueId: placement?.leagueId ?? null,
      actorMemberId: input.actorMemberId,
      source: 'staff_action',
      reason,
      memberName: member ? waitlistMemberDisplayName(member) : null,
      actorMemberName: actor ? waitlistMemberDisplayName(actor) : null,
    });
  });
  if (member) {
    await safeSendWaitlistCommunication({
      messageType: 'waitlist_changed_by_staff',
      member,
      registrationId: entry.source_registration_id ?? null,
      waitlistEntryId: null,
      payload: {
        leagueName: placement?.leagueName,
        changedSummary: 'Staff removed your waitlist entry.',
      },
    });
  }
  return { entryId: input.entryId, deleted: true };
}

export async function moveWaitlistEntryToBottom(input: { entryId: number; actorMemberId: number; reason: string }) {
  const { db, schema } = getDrizzleDb();
  const reason = requireReason(input.reason);
  const entry = await loadEntry(input.entryId);
  const placement = await resolvePlacementLeagueForWaitlist(entry.waitlist_id);
  const after = { position_sort_key: nextPositionSortKey(), decline_count: 0, status: 'active' as const };
  await db.transaction(async (tx) => {
    await tx.update(schema.waitlistEntries).set({ ...after, updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(schema.waitlistEntries.id, entry.id));
    await createAuditEvent(tx, {
      waitlistEntryId: entry.id,
      leagueId: placement?.leagueId ?? null,
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
  if (member) {
    await safeSendWaitlistCommunication({
      messageType: 'waitlist_changed_by_staff',
      member,
      registrationId: entry.source_registration_id ?? null,
      waitlistEntryId: entry.id,
      payload: {
        leagueName: placement?.leagueName,
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
  teamRosterText?: string | null;
  teamRosterPlacements?: WaitlistTeamMemberPlacementInput[] | null;
}) {
  const { db, schema } = getDrizzleDb();
  const reason = requireReason(input.reason);
  const entry = await loadEntry(input.entryId);
  const placement = await resolvePlacementLeagueForWaitlist(entry.waitlist_id);
  const league = placement ? await loadLeague(placement.leagueId) : null;
  if (!league) {
    throw new WaitlistStaffValidationError({ league: 'Placement league was not found.' });
  }
  const continuity = await loadLeagueContinuityMap();
  const resolvedReplacesLeagueId =
    input.replacesLeagueId ??
    (entry.replaces_lineage_start_league_id != null && league.session_id != null
      ? resolveLeagueInSession(entry.replaces_lineage_start_league_id, league.session_id, continuity)
      : entry.original_replaces_league_id);
  const roster = await resolveWaitlistEntryRoster({
    league,
    primaryMemberId: entry.member_id,
    entryType: input.entryType ?? entry.entry_type,
    replacesLeagueId: resolvedReplacesLeagueId,
    teamRosterText: input.teamRosterText,
    teamRosterPlacements: input.teamRosterPlacements,
    existingTeamRosterText: entry.team_roster_text,
    existingTeamRosterPlacements: entry.team_roster_placements,
    enforceMemberPlacementRules: false,
  });
  const rosterMemberIds =
    roster.teamRosterPlacements != null
      ? parseTeamRosterPlacements(roster.teamRosterPlacements).map((placement) => placement.memberId)
      : [entry.member_id];
  await assertMembersAvailableForWaitlist({
    waitlistId: entry.waitlist_id,
    memberIds: rosterMemberIds,
    excludeEntryId: entry.id,
  });
  const replacement =
    roster.entryType === 'replace' && roster.replacesLeagueId
      ? await replacementLineageFromLeagueId(roster.replacesLeagueId)
      : null;
  const values = {
    entry_type: roster.entryType,
    replaces_lineage_start_league_id: replacement?.lineageStartLeagueId ?? null,
    original_replaces_league_id: replacement?.originalReplacesLeagueId ?? null,
    team_roster_text: roster.teamRosterText,
    team_roster_placements: roster.teamRosterPlacements,
    updated_at: sql`CURRENT_TIMESTAMP`,
  };
  const entryType = roster.entryType;
  const action: WaitlistAuditActionSqlite =
    entry.entry_type !== entryType
      ? entryType === 'replace'
        ? 'entry_converted_add_to_replace'
        : 'entry_converted_replace_to_add'
      : entry.replaces_lineage_start_league_id !== values.replaces_lineage_start_league_id
        ? 'replacement_league_changed'
        : 'staff_correction';
  const [updated] = await db.update(schema.waitlistEntries).set(values).where(eq(schema.waitlistEntries.id, entry.id)).returning();
  await createAuditEvent(db, {
    waitlistEntryId: entry.id,
    leagueId: placement?.leagueId ?? null,
    memberId: entry.member_id,
    actorMemberId: input.actorMemberId,
    source: 'staff_action',
    action,
    reason,
    before: entry,
    after: updated,
  });
  const [member] = await db.select().from(schema.members).where(eq(schema.members.id, entry.member_id)).limit(1);
  if (member) {
    await safeSendWaitlistCommunication({
      messageType: 'waitlist_changed_by_staff',
      member,
      registrationId: entry.source_registration_id ?? null,
      waitlistEntryId: entry.id,
      payload: {
        leagueName: placement?.leagueName ?? league?.name,
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
