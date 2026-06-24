import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { canActorImpersonateTarget, listAccountSwitchOptions } from '../services/accountAccess.js';
import type { Member } from '../types.js';
import { isAdmin, isServerAdmin } from '../utils/auth.js';
import { canCancelRegistrationDuringPriority, canEditRegistrationDuringPriority } from './registrationPriorityEdit.js';
import {
  canViewOrEditRegistration,
  getDefaultRegistrationWindow,
  getRegistrationById,
} from './registrationShellService.js';
import { listRegistrationOutboundMessages, sendRegistrationEmailForDashboard } from './registrationEmailService.js';
import { syncCurlingRegistrationPaymentConfirmationForOrder } from './registrationMembershipPaymentService.js';
import { resolvePlacementLeagueForWaitlist } from './waitlistEntityService.js';
import { recordAndDeleteWaitlistEntry, waitlistMemberDisplayName } from './waitlistAudit.js';
import {
  isPrimaryWaitlistEntryMember,
  memberParticipationOnWaitlistEntry,
  waitlistEntryIncludesMember,
  waitlistTeammateContactMessage,
} from './waitlistMemberMembership.js';

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

function hostedCheckoutUrl(metadata: unknown): string | null {
  const value = typeof metadata === 'string' ? (() => {
    try {
      return JSON.parse(metadata) as unknown;
    } catch {
      return null;
    }
  })() : metadata;
  if (value && typeof value === 'object' && 'hostedCheckoutUrl' in value && typeof value.hostedCheckoutUrl === 'string') {
    return value.hostedCheckoutUrl;
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
  return {
    paymentStatus: invoice?.status ?? (registrationStatus === 'confirmed' ? 'paid' : 'not_required'),
    amountDueMinor: invoice?.total_minor ?? null,
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
      registrationStatus: row.status,
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
      registrationStatus: row.status,
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
      rank: schema.registrationSelections.rank,
      leagueId: schema.registrationSelections.league_id,
      replacesLeagueId: schema.registrationSelections.replaces_league_id,
      isTemporarySabbaticalFill: schema.registrationSelections.is_temporary_sabbatical_fill,
      byotTeammateText: schema.registrationSelections.byot_teammate_text,
      leagueName: schema.leagues.name,
    })
    .from(schema.registrationSelections)
    .leftJoin(schema.leagues, eq(schema.registrationSelections.league_id, schema.leagues.id))
    .where(eq(schema.registrationSelections.registration_id, registrationId))
    .orderBy(asc(schema.registrationSelections.rank), asc(schema.registrationSelections.id));
  const replacedLeagueIds = [
    ...new Set(
      selections
        .map((selection) => selection.replacesLeagueId)
        .filter((leagueId): leagueId is number => leagueId != null),
    ),
  ];
  const replacedLeagues =
    replacedLeagueIds.length > 0
      ? await db
          .select({ id: schema.leagues.id, name: schema.leagues.name })
          .from(schema.leagues)
          .where(inArray(schema.leagues.id, replacedLeagueIds))
      : [];
  const replacedLeagueNames = new Map(replacedLeagues.map((league) => [league.id, league.name]));
  const selectionsWithContext = selections.map((selection) => ({
    ...selection,
    replacedLeagueName:
      selection.replacesLeagueId != null
        ? replacedLeagueNames.get(selection.replacesLeagueId) ?? null
        : null,
  }));
  const waitlistRows = registration.curler_member_id
    ? await db
        .select({
          id: schema.waitlistEntries.id,
          waitlistId: schema.waitlistEntries.waitlist_id,
          memberId: schema.waitlistEntries.member_id,
          entryType: schema.waitlistEntries.entry_type,
          replacesLineageStartLeagueId: schema.waitlistEntries.replaces_lineage_start_league_id,
          originalReplacesLeagueId: schema.waitlistEntries.original_replaces_league_id,
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
    ? waitlistRows
        .filter((entry) =>
          waitlistEntryIncludesMember(registration.curler_member_id as number, {
            memberId: entry.memberId,
            teamRosterPlacements: entry.teamRosterPlacements,
          }),
        )
        .map((entry) => {
          const participation = memberParticipationOnWaitlistEntry(registration.curler_member_id as number, entry);
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
            entryType: participation.entryType,
            replacesLineageStartLeagueId: entry.replacesLineageStartLeagueId,
            originalReplacesLeagueId: participation.replacesLeagueId ?? entry.originalReplacesLeagueId,
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
          };
        })
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
  const order = invoice?.payment_order_id
    ? (await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, invoice.payment_order_id)).limit(1))[0]
    : null;
  const canEditDuringPriority = await canEditRegistrationDuringPriority(actor, shellRegistration);
  const canCancelDuringPriority = await canCancelRegistrationDuringPriority(actor, shellRegistration);
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
      reciprocalDiscountClaimed: registration.reciprocal_discount_claimed === 1,
    },
    selections: selectionsWithContext,
    waitlists: waitlistDetails,
    payment: {
      status: invoice?.status ?? (registration.status === 'confirmed' ? 'paid' : 'not_required'),
      amountDueMinor: invoice?.total_minor ?? null,
      amountPaidMinor: invoice?.status === 'paid' ? invoice.total_minor : null,
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
