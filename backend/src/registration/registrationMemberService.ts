import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { canActorImpersonateTarget, listAccountSwitchOptions } from '../services/accountAccess.js';
import type { Member } from '../types.js';
import { isAdmin, isServerAdmin } from '../utils/auth.js';
import { nameTagIncludePronounsFromStored, normalizeNameTagName, parseNameTagReplacementQuantity } from '../utils/nameTag.js';
import { booleanFromSqliteFlag } from '../utils/parentAssociationMemberships.js';
import { canCancelRegistrationDuringPriority, canEditRegistrationDuringPriority } from './registrationPriorityEdit.js';
import {
  canViewOrEditRegistration,
  getDefaultRegistrationWindow,
  getRegistrationById,
} from './registrationShellService.js';
import { evaluateRegistrantPlayInEntry } from './leagueEntryService.js';
import { listRegistrationOutboundMessages, sendRegistrationEmailForDashboard } from './registrationEmailService.js';
import {
  buildRegistrationContextForDraft,
  syncCurlingRegistrationPaymentConfirmationForOrder,
} from './registrationMembershipPaymentService.js';
import { evaluateLeaguePriorities } from './leaguePriorityEvaluation.js';
import type { LeaguePriorityGuaranteeLabel } from './leaguePriorityRules.js';
import { resolvePlacementLeagueForWaitlist } from './waitlistEntityService.js';
import { formatRegistrationTeammatesDisplay } from './registrationEmailService.js';
import { formatWaitlistTeamRosterDisplay, recordAndDeleteWaitlistEntry, waitlistMemberDisplayName } from './waitlistAudit.js';
import {
  isPrimaryWaitlistEntryMember,
  waitlistEntryIncludesMember,
  waitlistTeammateContactMessage,
} from './waitlistMemberMembership.js';
import {
  enrichTeamRosterPlacements,
  hydrateTeamRosterPlacementsForEntry,
  parseTeamRosterPlacements,
  waitlistRosterEntries,
} from './waitlistTeamRoster.js';

export class RegistrationMemberValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Registration member operation failed');
  }
}

function memberName(row: { name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null } | null | undefined): string {
  if (!row) return 'Unknown curler';
  const parts = [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : row.name?.trim() || row.email?.trim() || 'Unknown curler';
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function guardianSummaryFromRegistration(registration: {
  guardian_first_name: string | null;
  guardian_last_name: string | null;
  guardian_email: string | null;
  guardian_phone: string | null;
}) {
  const guardian = {
    firstName: trimOrNull(registration.guardian_first_name),
    lastName: trimOrNull(registration.guardian_last_name),
    email: trimOrNull(registration.guardian_email),
    phone: trimOrNull(registration.guardian_phone),
  };
  if (!guardian.firstName && !guardian.lastName && !guardian.email && !guardian.phone) {
    return null;
  }
  return guardian;
}

function parseOrderMetadata(metadata: unknown): Record<string, unknown> | null {
  const value =
    typeof metadata === 'string'
      ? (() => {
          try {
            return JSON.parse(metadata) as unknown;
          } catch {
            return null;
          }
        })()
      : metadata;
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

async function selectionTeamRosterDisplay(selection: {
  byotTeammateText?: string | null;
  teamRosterPlacementsJson?: string | null;
}): Promise<string | null> {
  const placements = parseTeamRosterPlacements(selection.teamRosterPlacementsJson);
  const enriched = placements.length > 0 ? await enrichTeamRosterPlacements(placements) : [];
  return formatRegistrationTeammatesDisplay({
    memberNames: enriched.map((placement) => placement.memberName),
    pendingNames: waitlistRosterEntries(selection.byotTeammateText),
  });
}

async function waitlistTeamRosterDisplay(entry: {
  memberId: number;
  teamRosterPlacements: string | null;
  teamRosterText: string | null;
}): Promise<string | null> {
  const fromText = formatWaitlistTeamRosterDisplay(entry.teamRosterText);
  if (fromText) return fromText;
  const hydrated = await hydrateTeamRosterPlacementsForEntry({
    primaryMemberId: entry.memberId,
    teamRosterPlacementsJson: entry.teamRosterPlacements,
    teamRosterText: entry.teamRosterText,
  });
  return formatRegistrationTeammatesDisplay({
    memberNames: hydrated.map((placement) => placement.memberName),
  });
}

function hostedCheckoutUrl(metadata: unknown): string | null {
  const value = parseOrderMetadata(metadata);
  if (value && typeof value.hostedCheckoutUrl === 'string') {
    return value.hostedCheckoutUrl;
  }
  return null;
}

function orderMetadataHasPayLater(metadata: unknown): boolean {
  const value = parseOrderMetadata(metadata);
  return value?.payLater === true;
}

/**
 * Pay later used to advance to payment_started / checkout_started because a hosted
 * checkout link was created for email. Correct those to awaiting_payment while the order is still pending.
 */
async function repairPayLaterAwaitingPaymentStatuses(input: {
  registrationId: number;
  registrationStatus: string;
  invoiceId: number | null;
  invoiceStatus: string | null;
  orderStatus: string | null;
  orderMetadata: unknown;
}): Promise<{ registrationStatus: string; paymentStatus: string }> {
  const paymentStatus = input.invoiceStatus ?? (input.registrationStatus === 'confirmed' ? 'paid' : 'not_required');
  if (
    input.orderStatus !== 'pending' ||
    !orderMetadataHasPayLater(input.orderMetadata) ||
    (input.registrationStatus !== 'payment_started' && input.invoiceStatus !== 'checkout_started')
  ) {
    return { registrationStatus: input.registrationStatus, paymentStatus };
  }

  const { db, schema } = getDrizzleDb();
  if (input.registrationStatus === 'payment_started') {
    await db
      .update(schema.curlingRegistrations)
      .set({ status: 'awaiting_payment', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.curlingRegistrations.id, input.registrationId));
  }
  if (input.invoiceId != null && input.invoiceStatus === 'checkout_started') {
    await db
      .update(schema.registrationInvoices)
      .set({ status: 'awaiting_payment', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.registrationInvoices.id, input.invoiceId));
  }
  return {
    registrationStatus: 'awaiting_payment',
    paymentStatus: 'awaiting_payment',
  };
}

/** Remaining amount owed for a registration invoice. Canceled/refunded/paid invoices are never due. */
export function registrationAmountDueMinor(input: {
  invoiceStatus?: string | null;
  invoiceTotalMinor?: number | null;
  registrationStatus?: string | null;
}): number | null {
  const invoiceStatus = input.invoiceStatus ?? null;
  const registrationStatus = input.registrationStatus ?? null;
  if (
    registrationStatus === 'cancelled' ||
    invoiceStatus === 'cancelled' ||
    invoiceStatus === 'refunded' ||
    invoiceStatus === 'paid'
  ) {
    return 0;
  }
  if (input.invoiceTotalMinor == null && invoiceStatus == null) return null;
  return input.invoiceTotalMinor ?? null;
}

export function registrationAmountPaidMinor(input: {
  invoiceStatus?: string | null;
  invoiceTotalMinor?: number | null;
}): number | null {
  if (input.invoiceStatus === 'paid' || input.invoiceStatus === 'refunded') {
    return input.invoiceTotalMinor ?? null;
  }
  return null;
}

async function loadLatestRegistrationPaymentSnapshot(registrationId: number, registrationStatus: string) {
  const { db, schema } = getDrizzleDb();
  let [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.registration_id, registrationId))
    .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
    .limit(1);
  let order = invoice?.payment_order_id
    ? (await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, invoice.payment_order_id)).limit(1))[0]
    : null;
  if (invoice?.payment_order_id) {
    try {
      await syncCurlingRegistrationPaymentConfirmationForOrder(invoice.payment_order_id);
      [invoice] = await db
        .select()
        .from(schema.registrationInvoices)
        .where(eq(schema.registrationInvoices.registration_id, registrationId))
        .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
        .limit(1);
      order = invoice?.payment_order_id
        ? (await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, invoice.payment_order_id)).limit(1))[0]
        : null;
    } catch {
      // Keep member views responsive even if payment sync fails.
    }
  }
  const repaired = await repairPayLaterAwaitingPaymentStatuses({
    registrationId,
    registrationStatus,
    invoiceId: invoice?.id ?? null,
    invoiceStatus: invoice?.status ?? null,
    orderStatus: order?.status ?? null,
    orderMetadata: order?.metadata,
  });
  return {
    registrationStatus: repaired.registrationStatus,
    paymentStatus: repaired.paymentStatus,
    amountDueMinor: registrationAmountDueMinor({
      invoiceStatus: repaired.paymentStatus === 'not_required' ? null : repaired.paymentStatus,
      invoiceTotalMinor: invoice?.total_minor,
      registrationStatus: repaired.registrationStatus,
    }),
    paymentLink: order?.status === 'pending' ? hostedCheckoutUrl(order.metadata) : null,
  };
}

async function actorManagedMemberIds(actor: Member): Promise<number[]> {
  const options = await listAccountSwitchOptions(actor.id);
  return options.map((option) => option.id);
}

async function waitlistPosition(waitlistId: number, entryId: number): Promise<number | null> {
  const { getActiveWaitlistEntryPosition } = await import('./waitlistEntityService.js');
  const { position } = await getActiveWaitlistEntryPosition(waitlistId, entryId);
  return position;
}

const ACTIVE_REGISTRATION_STATUSES = [
  'identity_incomplete',
  'policies_incomplete',
  'demographics_incomplete',
  'shell_complete',
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
  'paid',
  'confirmed',
] as const;

type RegistrationViewSlotSource = {
  id: number;
  isDraft: boolean;
};

export function buildRegistrationViewSlotMap(registrations: RegistrationViewSlotSource[]): Map<number, number> {
  const submitted = registrations
    .filter((registration) => !registration.isDraft)
    .sort((left, right) => left.id - right.id);
  return new Map(submitted.map((registration, index) => [registration.id, index + 1]));
}

function getSubmittedRegistrationIdForViewSlot(registrations: RegistrationViewSlotSource[], viewSlot: number): number | null {
  const submitted = registrations
    .filter((registration) => !registration.isDraft)
    .sort((left, right) => left.id - right.id);
  return submitted[viewSlot - 1]?.id ?? null;
}

export type MemberCurrentRegistrationLookup = {
  curlerMemberId?: number;
  viewSlot?: number;
};

export async function getMemberDashboardRegistrationStatus(actor: Member) {
  const window = await getDefaultRegistrationWindow();
  if (!window) {
    return { visible: false, window: null, registrations: [], showPriorityPrompt: false };
  }

  const ids = await actorManagedMemberIds(actor);
  const { db, schema } = getDrizzleDb();

  const rows = await db
        .select({
          id: schema.curlingRegistrations.id,
          status: schema.curlingRegistrations.status,
          submittedAt: schema.curlingRegistrations.submitted_at,
          updatedAt: schema.curlingRegistrations.updated_at,
          membershipOption: schema.curlingRegistrations.membership_option,
          curlerId: schema.members.id,
          curlerName: schema.members.name,
          curlerFirstName: schema.members.first_name,
          curlerLastName: schema.members.last_name,
          seasonName: schema.curlingSeasons.name,
          sessionName: schema.curlingSessions.name,
        })
        .from(schema.curlingRegistrations)
        .leftJoin(schema.members, eq(schema.curlingRegistrations.curler_member_id, schema.members.id))
        .innerJoin(schema.curlingSeasons, eq(schema.curlingRegistrations.season_id, schema.curlingSeasons.id))
        .innerJoin(schema.curlingSessions, eq(schema.curlingRegistrations.session_id, schema.curlingSessions.id))
        .where(and(
          eq(schema.curlingRegistrations.session_id, window.session.id),
          inArray(schema.curlingRegistrations.status, [...ACTIVE_REGISTRATION_STATUSES]),
          or(
            ids.length > 0 ? inArray(schema.curlingRegistrations.curler_member_id, ids) : sql`0 = 1`,
            eq(schema.curlingRegistrations.submitted_by_member_id, actor.id),
          ),
        ))
        .orderBy(desc(schema.curlingRegistrations.updated_at), desc(schema.curlingRegistrations.id));

  const registrations = [];
  for (const row of rows) {
    const payment = await loadLatestRegistrationPaymentSnapshot(row.id, row.status);
    registrations.push({
      id: row.id,
      curlerId: row.curlerId,
      curlerName: memberName({
        name: row.curlerName,
        first_name: row.curlerFirstName,
        last_name: row.curlerLastName,
      }) || 'Registration in progress',
      seasonName: row.seasonName,
      sessionName: row.sessionName,
      registrationStatus: payment.registrationStatus,
      isDraft: row.submittedAt == null,
      paymentStatus: payment.paymentStatus,
      membershipOption: row.membershipOption,
      amountDueMinor: payment.amountDueMinor,
      paymentLink: payment.paymentLink,
      submittedAt: row.submittedAt,
      updatedAt: row.updatedAt,
    });
  }

  const viewSlotByRegistrationId = buildRegistrationViewSlotMap(registrations);
  const registrationsWithViewSlots = registrations.map((registration) => ({
    ...registration,
    viewSlot: viewSlotByRegistrationId.get(registration.id) ?? null,
  }));

  const [selfRegistration] = await db
    .select({ id: schema.curlingRegistrations.id })
    .from(schema.curlingRegistrations)
    .where(and(
      eq(schema.curlingRegistrations.session_id, window.session.id),
      inArray(schema.curlingRegistrations.status, [...ACTIVE_REGISTRATION_STATUSES]),
      or(
        eq(schema.curlingRegistrations.curler_member_id, actor.id),
        and(
          eq(schema.curlingRegistrations.submitted_by_member_id, actor.id),
          eq(schema.curlingRegistrations.registering_for_self, 1),
        ),
      ),
    ))
    .limit(1);

  const showPriorityPrompt = window.state === 'priority' && !selfRegistration;
  const visible = registrationsWithViewSlots.length > 0 || showPriorityPrompt;

  return {
    visible,
    window: {
      state: window.state,
      season: window.season,
      session: window.session,
    },
    registrations: registrationsWithViewSlots,
    showPriorityPrompt,
  };
}

export async function listMemberRegistrationSummaries(actor: Member, seasonId?: number) {
  const ids = await actorManagedMemberIds(actor);
  if (ids.length === 0) return { registrations: [] };
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.curlingRegistrations.id,
      status: schema.curlingRegistrations.status,
      submittedAt: schema.curlingRegistrations.submitted_at,
      updatedAt: schema.curlingRegistrations.updated_at,
      membershipOption: schema.curlingRegistrations.membership_option,
      curlerId: schema.members.id,
      curlerName: schema.members.name,
      curlerFirstName: schema.members.first_name,
      curlerLastName: schema.members.last_name,
      seasonName: schema.curlingSeasons.name,
      sessionName: schema.curlingSessions.name,
    })
    .from(schema.curlingRegistrations)
    .innerJoin(schema.members, eq(schema.curlingRegistrations.curler_member_id, schema.members.id))
    .innerJoin(schema.curlingSeasons, eq(schema.curlingRegistrations.season_id, schema.curlingSeasons.id))
    .innerJoin(schema.curlingSessions, eq(schema.curlingRegistrations.session_id, schema.curlingSessions.id))
    .where(and(
      inArray(schema.curlingRegistrations.curler_member_id, ids),
      seasonId ? eq(schema.curlingRegistrations.season_id, seasonId) : sql`${schema.curlingRegistrations.submitted_at} IS NOT NULL`
    ))
    .orderBy(desc(schema.curlingRegistrations.updated_at), desc(schema.curlingRegistrations.id));

  const registrations = [];
  for (const row of rows) {
    const payment = await loadLatestRegistrationPaymentSnapshot(row.id, row.status);
    registrations.push({
      id: row.id,
      curlerId: row.curlerId,
      curlerName: memberName({
        name: row.curlerName,
        first_name: row.curlerFirstName,
        last_name: row.curlerLastName,
      }),
      seasonName: row.seasonName,
      sessionName: row.sessionName,
      registrationStatus: payment.registrationStatus,
      paymentStatus: payment.paymentStatus,
      membershipOption: row.membershipOption,
      amountDueMinor: payment.amountDueMinor,
      paymentLink: payment.paymentLink,
      submittedAt: row.submittedAt,
      updatedAt: row.updatedAt,
    });
  }
  return { registrations };
}

export async function getMemberCurrentRegistrationDetail(actor: Member, lookup?: MemberCurrentRegistrationLookup) {
  const status = await getMemberDashboardRegistrationStatus(actor);
  if (!status.window) {
    throw new RegistrationMemberValidationError({ registration: 'Registration was not found.' });
  }

  const submitted = status.registrations.filter((registration) => !registration.isDraft);
  let targetId: number | null = null;

  if (lookup?.viewSlot != null) {
    targetId = getSubmittedRegistrationIdForViewSlot(submitted, lookup.viewSlot);
  } else if (lookup?.curlerMemberId != null) {
    targetId = submitted.find((registration) => registration.curlerId === lookup.curlerMemberId)?.id ?? null;
  } else {
    const selfMatch = submitted.find((registration) => registration.curlerId === actor.id);
    if (selfMatch) {
      targetId = selfMatch.id;
    } else if (submitted.length === 1) {
      targetId = submitted[0]?.id ?? null;
    }
  }

  if (targetId == null) {
    throw new RegistrationMemberValidationError({ registration: 'Registration was not found.' });
  }

  return getMemberRegistrationDetail(targetId, actor);
}

export async function resolveRegistrationViewPath(registrationId: number, viewerMemberId?: number | null): Promise<string> {
  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select({
      id: schema.curlingRegistrations.id,
      submittedAt: schema.curlingRegistrations.submitted_at,
      submittedByMemberId: schema.curlingRegistrations.submitted_by_member_id,
      curlerMemberId: schema.curlingRegistrations.curler_member_id,
    })
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.id, registrationId))
    .limit(1);
  if (!registration || registration.submittedAt == null) {
    return '/dashboard';
  }

  const memberId = viewerMemberId ?? registration.submittedByMemberId ?? registration.curlerMemberId;
  if (memberId == null) {
    return '/registration/view/1';
  }

  const [memberRow] = await db.select().from(schema.members).where(eq(schema.members.id, memberId)).limit(1);
  if (!memberRow) {
    return '/registration/view/1';
  }

  const status = await getMemberDashboardRegistrationStatus(memberRow as Member);
  const viewSlot = buildRegistrationViewSlotMap(status.registrations).get(registrationId);
  return viewSlot != null ? `/registration/view/${viewSlot}` : '/dashboard';
}

/**
 * Guarantee labels are derived, not stored, so the detail view re-evaluates the
 * saved priority list rather than trusting a snapshot that could be stale.
 */
async function loadPriorityGuaranteeLabels(
  registrationId: number,
): Promise<Map<number, LeaguePriorityGuaranteeLabel>> {
  try {
    const context = await buildRegistrationContextForDraft(registrationId);
    const evaluation = evaluateLeaguePriorities(context);
    return new Map(evaluation.entries.map((entry) => [entry.leagueId, entry.label]));
  } catch {
    return new Map();
  }
}

export async function getMemberRegistrationDetail(registrationId: number, actor: Member) {
  const shellRegistration = await getRegistrationById(registrationId);
  if (!shellRegistration || !(await canViewOrEditRegistration(actor, shellRegistration))) {
    throw new RegistrationMemberValidationError({ registration: 'Registration was not found.' });
  }
  const { db, schema } = getDrizzleDb();
  const [registration] = await db.select().from(schema.curlingRegistrations).where(eq(schema.curlingRegistrations.id, registrationId)).limit(1);
  if (!registration) throw new RegistrationMemberValidationError({ registration: 'Registration was not found.' });
  const [curler] = registration.curler_member_id
    ? await db.select().from(schema.members).where(eq(schema.members.id, registration.curler_member_id)).limit(1)
    : [];
  const [season] = await db.select().from(schema.curlingSeasons).where(eq(schema.curlingSeasons.id, registration.season_id)).limit(1);
  const [session] = await db.select().from(schema.curlingSessions).where(eq(schema.curlingSessions.id, registration.session_id)).limit(1);
  const selections = await db
    .select({
      id: schema.registrationSelections.id,
      selectionType: schema.registrationSelections.selection_type,
      status: schema.registrationSelections.status,
      leagueId: schema.registrationSelections.league_id,
      leagueName: schema.leagues.name,
    })
    .from(schema.registrationSelections)
    .leftJoin(schema.leagues, eq(schema.registrationSelections.league_id, schema.leagues.id))
    .where(eq(schema.registrationSelections.registration_id, registrationId))
    .orderBy(asc(schema.registrationSelections.id));
  const priorityRows = await db
    .select({
      id: schema.registrationLeaguePriorities.id,
      leagueId: schema.registrationLeaguePriorities.league_id,
      priorityRank: schema.registrationLeaguePriorities.priority_rank,
      byotTeammateText: schema.registrationLeaguePriorities.byot_teammate_text,
      teamRosterPlacementsJson: schema.registrationLeaguePriorities.team_roster_placements,
      leagueName: schema.leagues.name,
      isPlayInBased: schema.leagues.is_play_in_based,
    })
    .from(schema.registrationLeaguePriorities)
    .innerJoin(schema.leagues, eq(schema.registrationLeaguePriorities.league_id, schema.leagues.id))
    .where(eq(schema.registrationLeaguePriorities.registration_id, registrationId))
    .orderBy(asc(schema.registrationLeaguePriorities.priority_rank));
  const guaranteeLabels = await loadPriorityGuaranteeLabels(registrationId);
  const priorities = await Promise.all(
    priorityRows.map(async ({ teamRosterPlacementsJson, isPlayInBased: _isPlayInBased, ...rest }) => ({
      ...rest,
      guaranteeLabel: guaranteeLabels.get(rest.leagueId) ?? null,
      teamRosterDisplay: await selectionTeamRosterDisplay({
        byotTeammateText: rest.byotTeammateText,
        teamRosterPlacementsJson,
      }),
    })),
  );
  const waitlistRows = registration.curler_member_id
    ? await db
        .select({
          id: schema.waitlistEntries.id,
          waitlistId: schema.waitlistEntries.waitlist_id,
          memberId: schema.waitlistEntries.member_id,
          priorityRank: schema.waitlistEntries.priority_rank,
          desiredLeagueCount: schema.waitlistEntries.desired_league_count,
          teamRosterText: schema.waitlistEntries.team_roster_text,
          teamRosterPlacements: schema.waitlistEntries.team_roster_placements,
          declineCount: schema.waitlistEntries.decline_count,
          status: schema.waitlistEntries.status,
          rolledOverFromWaitlistEntryId: schema.waitlistEntries.rolled_over_from_waitlist_entry_id,
          leagueId: schema.leagues.id,
          leagueName: schema.leagues.name,
          waitlistName: schema.leagueWaitlists.name,
          primaryMemberName: schema.members.name,
          primaryMemberFirstName: schema.members.first_name,
          primaryMemberLastName: schema.members.last_name,
          primaryMemberEmail: schema.members.email,
        })
        .from(schema.waitlistEntries)
        .innerJoin(schema.members, eq(schema.waitlistEntries.member_id, schema.members.id))
        .innerJoin(schema.leagueWaitlists, eq(schema.waitlistEntries.waitlist_id, schema.leagueWaitlists.id))
        .innerJoin(
          schema.leagues,
          and(
            eq(schema.leagues.waitlist_id, schema.waitlistEntries.waitlist_id),
            eq(schema.leagues.session_id, registration.session_id),
          ),
        )
        .where(eq(schema.waitlistEntries.status, 'active'))
        .orderBy(asc(schema.waitlistEntries.position_sort_key), asc(schema.waitlistEntries.joined_at), asc(schema.waitlistEntries.id))
    : [];
  const waitlists = registration.curler_member_id
    ? await Promise.all(
        waitlistRows
          .filter((entry) =>
            waitlistEntryIncludesMember(registration.curler_member_id as number, {
              memberId: entry.memberId,
              teamRosterPlacements: entry.teamRosterPlacements,
            }),
          )
          .map(async (entry) => {
            const primaryMemberName = memberName({
              name: entry.primaryMemberName,
              first_name: entry.primaryMemberFirstName,
              last_name: entry.primaryMemberLastName,
              email: entry.primaryMemberEmail,
            });
            const isPrimaryMember = isPrimaryWaitlistEntryMember(entry, registration.curler_member_id as number);
            return {
              id: entry.id,
              waitlistId: entry.waitlistId,
              priorityRank: entry.priorityRank,
              desiredLeagueCount: entry.desiredLeagueCount,
              declineCount: entry.declineCount,
              status: entry.status,
              rolledOverFromWaitlistEntryId: entry.rolledOverFromWaitlistEntryId,
              leagueId: entry.leagueId,
              leagueName: entry.leagueName,
              waitlistName: entry.waitlistName,
              isPrimaryMember,
              canRemoveSelf: isPrimaryMember,
              primaryMemberName,
              teammateContactMessage: isPrimaryMember
                ? null
                : waitlistTeammateContactMessage(primaryMemberName),
              teamRosterDisplay: await waitlistTeamRosterDisplay({
                memberId: entry.memberId,
                teamRosterPlacements: entry.teamRosterPlacements,
                teamRosterText: entry.teamRosterText,
              }),
            };
          }),
      )
    : [];
  const waitlistDetails = await Promise.all(waitlists.map(async (entry) => ({
    ...entry,
    position: await waitlistPosition(entry.waitlistId, entry.id),
  })));
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.registration_id, registrationId))
    .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
    .limit(1);
  const [financialAssistance] = await db
    .select({
      requestedPercent: schema.financialAssistanceRequests.requested_percentage,
      approvedPercent: schema.financialAssistanceRequests.approved_percentage,
      status: schema.financialAssistanceRequests.status,
    })
    .from(schema.financialAssistanceRequests)
    .where(eq(schema.financialAssistanceRequests.registration_id, registrationId))
    .limit(1);
  const order = invoice?.payment_order_id
    ? (await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, invoice.payment_order_id)).limit(1))[0]
    : null;
  const canEditDuringPriority = await canEditRegistrationDuringPriority(actor, shellRegistration);
  const canCancelDuringPriority = await canCancelRegistrationDuringPriority(actor, shellRegistration);
  const playInEntry: Record<number, Awaited<ReturnType<typeof evaluateRegistrantPlayInEntry>>> = {};
  for (const priorityRow of priorityRows) {
    if (playInEntry[priorityRow.leagueId]) continue;
    if (Number(priorityRow.isPlayInBased) !== 1) continue;
    try {
      playInEntry[priorityRow.leagueId] = await evaluateRegistrantPlayInEntry({
        leagueId: priorityRow.leagueId,
        memberId: registration.curler_member_id,
        teamRosterPlacements: parseTeamRosterPlacements(priorityRow.teamRosterPlacementsJson),
        pendingTeammateText: priorityRow.byotTeammateText,
      });
    } catch {
      // Leagues that cannot be evaluated are omitted.
    }
  }
  return {
    registration: {
      id: registration.id,
      curlerId: registration.curler_member_id,
      curlerName: memberName(curler),
      seasonName: season?.name ?? null,
      sessionName: session?.name ?? null,
      registrationStatus: registration.status,
      membershipOption: registration.membership_option,
      submittedAt: registration.submitted_at,
      updatedAt: registration.updated_at,
      studentDiscountClaimed: registration.student_discount_claimed === 1,
      studentInstitution: trimOrNull(registration.student_institution),
      reciprocalDiscountClaimed: registration.reciprocal_discount_claimed === 1,
      reciprocalClubName: trimOrNull(registration.reciprocal_club_name),
      usaCurlingMembershipOptIn: booleanFromSqliteFlag(registration.usa_curling_membership_opt_in),
      uswcaMembershipOptIn: booleanFromSqliteFlag(registration.uswca_membership_opt_in),
      nameTagName: normalizeNameTagName(curler?.name_tag_name) || null,
      nameTagIncludePronouns: nameTagIncludePronounsFromStored(curler?.name_tag_include_pronouns),
      nameTagReplacementQuantity: parseNameTagReplacementQuantity(registration.name_tag_replacement_quantity),
      icePrivilegesChoice: (registration.ice_privileges_choice ?? null) as
        | 'none'
        | 'league_play'
        | 'basic_ice'
        | null,
      experienceType: (registration.experience_type ?? null) as
        | 'none_or_minimal'
        | 'specified_years'
        | 'known_existing'
        | null,
      experienceSelfReportedYears:
        registration.experience_self_reported_years == null
          ? null
          : Number(registration.experience_self_reported_years),
      basicIceFallbackInterest: booleanFromSqliteFlag(registration.basic_ice_fallback_interest),
      financialAssistance: financialAssistance
        ? {
            requestedPercent: Number(financialAssistance.requestedPercent),
            approvedPercent:
              financialAssistance.approvedPercent == null ? null : Number(financialAssistance.approvedPercent),
            status: financialAssistance.status,
          }
        : null,
      guardian: guardianSummaryFromRegistration(registration),
      membershipCommitteeComments: registration.membership_committee_comments?.trim()
        ? registration.membership_committee_comments.trim()
        : null,
    },
    selections,
    priorities,
    desiredLeagueCount: registration.desired_league_count ?? null,
    playInEntry,
    waitlists: waitlistDetails,
    payment: {
      status: invoice?.status ?? (registration.status === 'confirmed' ? 'paid' : 'not_required'),
      amountDueMinor: registrationAmountDueMinor({
        invoiceStatus: invoice?.status,
        invoiceTotalMinor: invoice?.total_minor,
        registrationStatus: registration.status,
      }),
      amountPaidMinor: registrationAmountPaidMinor({
        invoiceStatus: invoice?.status,
        invoiceTotalMinor: invoice?.total_minor,
      }),
      paymentLink: order?.status === 'pending' ? hostedCheckoutUrl(order.metadata) : null,
      deferredReason: invoice?.deferred_reason ?? null,
    },
    communications: await listRegistrationOutboundMessages({ registrationId, limit: 25 }),
    canEditDuringPriority,
    canCancelDuringPriority,
  };
}

export { cancelMemberRegistration } from './registrationPriorityEdit.js';

export async function removeMemberWaitlistEntry(input: { entryId: number; actor: Member }) {
  const { db, schema } = getDrizzleDb();
  const [entry] = await db.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, input.entryId)).limit(1);
  if (!entry || entry.status !== 'active') {
    throw new RegistrationMemberValidationError({ waitlistEntry: 'Active waitlist entry was not found.' });
  }
  const removedByStaff = isAdmin(input.actor) || isServerAdmin(input.actor);
  if (!removedByStaff) {
    const [primaryMember] = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, entry.member_id))
      .limit(1);
    const primaryMemberName = primaryMember ? waitlistMemberDisplayName(primaryMember) : 'the team contact';
    if (
      waitlistEntryIncludesMember(input.actor.id, entry) &&
      !isPrimaryWaitlistEntryMember(entry, input.actor.id)
    ) {
      throw new RegistrationMemberValidationError({
        waitlistEntry: waitlistTeammateContactMessage(primaryMemberName),
      });
    }
    const canRemoveAsPrimary =
      isPrimaryWaitlistEntryMember(entry, input.actor.id) ||
      (await canActorImpersonateTarget(input.actor.id, entry.member_id));
    if (!canRemoveAsPrimary) {
      throw new RegistrationMemberValidationError({ waitlistEntry: 'You do not have access to remove this waitlist entry.' });
    }
  }
  const placement = await resolvePlacementLeagueForWaitlist(entry.waitlist_id);
  const [member] = await db.select().from(schema.members).where(eq(schema.members.id, entry.member_id)).limit(1);
  await db.transaction(async (tx) => {
    await recordAndDeleteWaitlistEntry(tx, {
      entry,
      leagueId: placement?.leagueId ?? null,
      actorMemberId: input.actor.id,
      source: removedByStaff ? 'staff_action' : 'member_self',
      reason: 'WAITLIST_REMOVED_BY_MEMBER',
      metadata: { sourceRegistrationId: entry.source_registration_id },
      memberName: member ? waitlistMemberDisplayName(member) : null,
      actorMemberName: waitlistMemberDisplayName(input.actor),
    });
  });
  if (member?.email) {
    await sendRegistrationEmailForDashboard({
      messageType: 'waitlist_removed_by_member',
      recipientEmail: member.email,
      recipientName: memberName(member),
      recipientMemberId: member.id,
      registrationId: entry.source_registration_id ?? null,
      waitlistEntryId: null,
      payload: {
        leagueName: placement?.leagueName,
      },
    });
  }
  return { entryId: entry.id, deleted: true };
}
