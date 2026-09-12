import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { CurlingMembershipOptionSqlite } from '../db/drizzle-schema.js';
import {
  listCurlingRegistrationPaymentActivity,
  listCurlingRegistrationPaymentActivityByRegistrationIds,
} from '../domains/payments/queries/paymentSummaries.js';
import { createPaymentService, PaymentServiceError } from '../services/paymentService.js';
import type { Member } from '../types.js';
import { effectiveLeagueRegistrationFeeMinor } from './registrationConfigValidation.js';
import type {
  JuniorAssistanceRequest,
  LeagueConfig,
  RegistrationContext,
  RegistrationSelectionInput,
} from './registrationContext.js';
import { calculateRegistrationFees } from './registrationFeeCalculator.js';
import { isLeagueProcessingActive } from './registrationLeagueProcessing.js';
import { LISTABLE_REGISTRATION_STATUSES } from './registrationStaffQuery.js';
import { defaultSabbaticalDurationLimitYears } from './sabbaticalDurationLimit.js';
import { memberCanManageRegistrations } from '../utils/registrationStaffAccess.js';
import {
  addChargedLeague,
  emptyRegistrationChargeSet,
  mergeRegistrationChargeSets,
  type RegistrationChargeSet,
} from './registrationBillingChargeSet.js';
import {
  COUNTED_REGISTRATION_REFUND_STATUSES,
  netPaidMinorFromPaymentActivity,
  parseRegistrationRefundNote,
  refundableRemainingMinor,
  refundDueMinor,
  registrationBalanceMinor,
  remainingDueMinor,
} from './registrationBillingMath.js';

const ENTERED_PLAY_IN_TEAM_STATUSES = ['entered'] as const;

const BILLING_REGISTRATION_STATUSES = LISTABLE_REGISTRATION_STATUSES.filter((status) => status !== 'cancelled');

export class RegistrationBillingValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super(Object.values(details)[0] || 'Registration billing operation failed');
  }
}

function billingMemberName(row: {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null | undefined): string {
  if (!row) return 'Unknown curler';
  const parts = [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : row.name?.trim() || row.email?.trim() || 'Unknown curler';
}

function assertBillingAccess(actor: Member): void {
  if (!memberCanManageRegistrations(actor)) {
    throw new RegistrationBillingValidationError({
      registration: 'You do not have permission to manage registrations.',
    });
  }
}

function billingLeagueConfig(
  row: {
    id: number;
    session_id: number | null;
    name: string;
    league_type: 'standard' | 'bring_your_own_team';
    capacity_type: 'individual' | 'team';
    capacity_value: number;
    registration_fee_minor: number;
    registration_fee_override_minor?: number | null;
    requires_club_membership: number;
    format: 'teams' | 'doubles' | 'instructional';
    allows_waitlist: number;
    waitlist_id: number | null;
    is_play_in_based?: number;
    is_junior_recreational?: number;
    allows_sabbatical: number;
  },
  defaultLeagueFeeMinor: number,
): LeagueConfig {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    leagueType: row.league_type,
    capacityType: row.capacity_type,
    capacityValue: row.capacity_value,
    registrationFeeMinor: effectiveLeagueRegistrationFeeMinor(
      row.registration_fee_override_minor,
      defaultLeagueFeeMinor,
    ),
    requiresClubMembership: row.requires_club_membership === 1,
    format: row.format,
    allowsWaitlist: row.waitlist_id != null,
    waitlistId: row.waitlist_id,
    isPlayInBased: row.is_play_in_based === 1,
    isJuniorRecreational: row.is_junior_recreational === 1,
    allowsSabbatical: row.allows_sabbatical === 1,
    discountEligible: true,
  };
}

async function isBillingFirstSessionOfSeason(seasonId: number, sessionId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const [firstSession] = await db
    .select({ id: schema.curlingSessions.id })
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.season_id, seasonId))
    .orderBy(asc(schema.curlingSessions.start_date), asc(schema.curlingSessions.id))
    .limit(1);
  return firstSession?.id === sessionId;
}

async function loadBillingPriceSettings(): Promise<{
  priceConfig: RegistrationContext['priceConfig'];
  discountSettings: RegistrationContext['discountSettings'];
}> {
  const { db, schema } = getDrizzleDb();
  const [price] = await db.select().from(schema.registrationPriceSettings).limit(1);
  const [discount] = await db.select().from(schema.registrationDiscountSettings).limit(1);
  return {
    priceConfig: {
      regularMembershipFeeMinor: price?.regular_membership_fee_minor ?? 0,
      socialMembershipFeeMinor: price?.social_membership_fee_minor ?? 0,
      spareOnlyIcePrivilegeFeeMinor: price?.spare_only_ice_privilege_fee_minor ?? 0,
      sabbaticalFeeMinor: price?.sabbatical_fee_minor ?? 0,
      juniorRecreationalFeeMinor: price?.junior_recreational_fee_minor ?? 0,
      defaultLeagueFeeMinor: price?.default_league_fee_minor ?? 0,
      replacementNameTagFeeMinor: price?.replacement_name_tag_fee_minor ?? 0,
    },
    discountSettings: {
      student: {
        amountType: discount?.student_discount_amount_type ?? 'dollar',
        amountValue: discount?.student_discount_amount_value ?? 0,
      },
      reciprocal: {
        amountType: discount?.reciprocal_discount_amount_type ?? 'dollar',
        amountValue: discount?.reciprocal_discount_amount_value ?? 0,
      },
      winterOnly: {
        amountType: discount?.winter_only_discount_amount_type ?? 'dollar',
        amountValue: discount?.winter_only_discount_amount_value ?? 0,
      },
    },
  };
}

async function loadSessionPlacementChargeLeagues(input: {
  sessionId: number;
  memberIds: number[];
}): Promise<Map<number, number[]>> {
  const extraByMember = new Map<number, number[]>();
  if (input.memberIds.length === 0) return extraByMember;
  const { db, schema } = getDrizzleDb();
  const [teamRows, playInRows, sessionRosterRows] = await Promise.all([
    db
      .select({
        memberId: schema.teamMembers.member_id,
        leagueId: schema.leagueTeams.league_id,
      })
      .from(schema.teamMembers)
      .innerJoin(schema.leagueTeams, eq(schema.leagueTeams.id, schema.teamMembers.team_id))
      .innerJoin(schema.leagues, eq(schema.leagues.id, schema.leagueTeams.league_id))
      .where(
        and(
          inArray(schema.teamMembers.member_id, input.memberIds),
          eq(schema.leagues.session_id, input.sessionId),
        ),
      ),
    db
      .select({
        memberId: schema.leagueEntryTeamMembers.member_id,
        leagueId: schema.leagueEntryTeams.league_id,
      })
      .from(schema.leagueEntryTeamMembers)
      .innerJoin(
        schema.leagueEntryTeams,
        eq(schema.leagueEntryTeams.id, schema.leagueEntryTeamMembers.entry_team_id),
      )
      .innerJoin(schema.leagues, eq(schema.leagues.id, schema.leagueEntryTeams.league_id))
      .where(
        and(
          inArray(schema.leagueEntryTeamMembers.member_id, input.memberIds),
          eq(schema.leagues.session_id, input.sessionId),
          inArray(schema.leagueEntryTeams.status, [...ENTERED_PLAY_IN_TEAM_STATUSES]),
        ),
      ),
    db
      .select({
        memberId: schema.leagueRoster.member_id,
        leagueId: schema.leagueRoster.league_id,
      })
      .from(schema.leagueRoster)
      .innerJoin(schema.leagues, eq(schema.leagues.id, schema.leagueRoster.league_id))
      .where(
        and(
          inArray(schema.leagueRoster.member_id, input.memberIds),
          eq(schema.leagueRoster.status, 'active'),
          eq(schema.leagues.session_id, input.sessionId),
        ),
      ),
  ]);

  const push = (memberId: number | null, leagueId: number) => {
    if (memberId == null) return;
    const list = extraByMember.get(memberId) ?? [];
    list.push(leagueId);
    extraByMember.set(memberId, list);
  };
  for (const row of teamRows) push(row.memberId, row.leagueId);
  for (const row of playInRows) push(row.memberId, row.leagueId);
  for (const row of sessionRosterRows) push(row.memberId, row.leagueId);
  return extraByMember;
}

function chargeSetFromRosterRows(
  rows: Array<{ leagueId: number; temporaryFill: number }>,
): RegistrationChargeSet {
  const current = emptyRegistrationChargeSet();
  for (const row of rows) {
    addChargedLeague(current, row.leagueId, row.temporaryFill === 1);
  }
  return {
    chargedLeagueIds: [...new Set(current.chargedLeagueIds)],
    temporaryFillLeagueIds: [...new Set(current.temporaryFillLeagueIds)],
  };
}

export async function loadPlacedRosterChargeSet(input: {
  registrationId: number;
  curlerMemberId: number;
}): Promise<RegistrationChargeSet> {
  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select({ sessionId: schema.curlingRegistrations.session_id })
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.id, input.registrationId))
    .limit(1);
  const [placedRows, extrasByMember] = await Promise.all([
    db
      .select({
        leagueId: schema.leagueRoster.league_id,
        temporaryFill: schema.leagueRoster.is_temporary_sabbatical_fill,
      })
      .from(schema.leagueRoster)
      .where(
        and(
          eq(schema.leagueRoster.member_id, input.curlerMemberId),
          eq(schema.leagueRoster.source_registration_id, input.registrationId),
          eq(schema.leagueRoster.status, 'active'),
        ),
      ),
    registration
      ? loadSessionPlacementChargeLeagues({
          sessionId: registration.sessionId,
          memberIds: [input.curlerMemberId],
        })
      : Promise.resolve(new Map<number, number[]>()),
  ]);
  return mergeRegistrationChargeSets(chargeSetFromRosterRows(placedRows), {
    chargedLeagueIds: extrasByMember.get(input.curlerMemberId) ?? [],
  });
}

export async function computeRegistrationNetPaidMinor(registrationId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const [activity, [invoice]] = await Promise.all([
    listCurlingRegistrationPaymentActivity(registrationId),
    db
      .select({
        status: schema.registrationInvoices.status,
        totalMinor: schema.registrationInvoices.total_minor,
        offlinePaymentNote: schema.registrationInvoices.offline_payment_note,
      })
      .from(schema.registrationInvoices)
      .where(eq(schema.registrationInvoices.registration_id, registrationId))
      .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
      .limit(1),
  ]);
  return netPaidMinorFromPaymentActivity(activity, invoice ?? null);
}

function stubBillingContext(input: {
  season: RegistrationContext['season'];
  session: RegistrationContext['session'];
  isFirstSessionOfSeason: boolean;
  settings: Awaited<ReturnType<typeof loadBillingPriceSettings>>;
  leagues: Record<number, LeagueConfig>;
  registration: {
    id: number;
    curlerMemberId: number | null;
    returningMemberAnswer: number;
    submittedByMemberId: number | null;
    membershipOption: CurlingMembershipOptionSqlite | string;
    studentDiscountClaimed: number;
    studentInstitution: string | null;
    reciprocalDiscountClaimed: number;
    reciprocalClubName: string | null;
    nameTagReplacementQuantity: number | null;
    hasLifetimeMembership: boolean;
    dateOfBirth: string | null;
  };
  selections: RegistrationSelectionInput[];
  chargedLeagueIds: number[];
  juniorAssistance?: JuniorAssistanceRequest;
}): RegistrationContext {
  const membershipOption = (input.registration.membershipOption ?? 'none') as CurlingMembershipOptionSqlite;
  const skipOrdinaryDiscounts = membershipOption === 'social' || membershipOption === 'junior_recreational';
  return {
    season: input.season,
    session: input.session,
    registrationState: 'open',
    isFirstSessionOfSeason: input.isFirstSessionOfSeason,
    registrant: {
      memberId: input.registration.curlerMemberId,
      hasUserAccount: Boolean(input.registration.curlerMemberId),
      isReturningMember: input.registration.returningMemberAnswer === 1,
      dateOfBirth: input.registration.dateOfBirth,
      hasLifetimeMembership: input.registration.hasLifetimeMembership,
    },
    submittedByMemberId: input.registration.submittedByMemberId,
    membershipOption,
    experience: {
      type: 'none_or_minimal',
      selfReportedYears: null,
      baselineOtherClubExperienceYears: 0,
      baselineClubExperienceYears: 0,
      completedSessions: [],
    },
    activeLeagueIds: input.chargedLeagueIds,
    participatedLeagueIds: [],
    existingSabbaticals: [],
    existingWaitlistEntries: [],
    leagues: input.leagues,
    priorities: [],
    selections: input.selections,
    discountClaims: skipOrdinaryDiscounts
      ? {}
      : {
          student: {
            claimed: input.registration.studentDiscountClaimed === 1,
            institution: input.registration.studentInstitution,
          },
          reciprocal: {
            claimed: input.registration.reciprocalDiscountClaimed === 1,
            clubName: input.registration.reciprocalClubName,
          },
          winterOnly: {},
        },
    juniorAssistance: input.juniorAssistance,
    ...input.settings,
    sabbaticalDurationLimitYears: defaultSabbaticalDurationLimitYears(),
    nameTagReplacementQuantity: input.registration.nameTagReplacementQuantity,
  };
}

export type StaffRegistrationBillingLine = {
  description: string;
  amountMinor: number;
  lineType?: string;
};

export type StaffRegistrationBillingRow = {
  registrationId: number;
  curlerId: number | null;
  curlerName: string;
  curlerEmail: string | null;
  registrationStatus: string;
  chargedLeagues: Array<{ id: number; name: string }>;
  owedLines: StaffRegistrationBillingLine[];
  owedDiscountLines: StaffRegistrationBillingLine[];
  owedSubtotalMinor: number;
  owedDiscountMinor: number;
  owedMinor: number;
  paidMinor: number;
  balanceMinor: number;
  canRequestPayment: boolean;
  canIssueRefund: boolean;
};

function billingFeeLines(
  items: Array<{ description: string; amountMinor: number; lineType?: string }>,
): StaffRegistrationBillingLine[] {
  return items.map((item) => ({
    description: item.description,
    amountMinor: item.amountMinor,
    lineType: item.lineType,
  }));
}

export async function listStaffRegistrationBilling(input: {
  actor: Member;
  sessionId: number;
  curlerMemberIds?: number[];
}): Promise<{
  sessionId: number;
  sessionName: string;
  leagueProcessingActive: boolean;
  registrations: StaffRegistrationBillingRow[];
}> {
  assertBillingAccess(input.actor);
  const { db, schema } = getDrizzleDb();
  const [session] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
      startDate: schema.curlingSessions.start_date,
      endDate: schema.curlingSessions.end_date,
      seasonId: schema.curlingSessions.season_id,
      seasonName: schema.curlingSeasons.name,
      seasonStartDate: schema.curlingSeasons.start_date,
      seasonEndDate: schema.curlingSeasons.end_date,
    })
    .from(schema.curlingSessions)
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
    .where(eq(schema.curlingSessions.id, input.sessionId))
    .limit(1);
  if (!session) {
    throw new RegistrationBillingValidationError({ sessionId: 'Session was not found.' });
  }
  const sessionName = session.seasonName ? `${session.seasonName} / ${session.name}` : session.name;
  if (input.curlerMemberIds && input.curlerMemberIds.length === 0) {
    return {
      sessionId: session.id,
      sessionName,
      leagueProcessingActive: await isLeagueProcessingActive(),
      registrations: [],
    };
  }

  const registrationRows = await db
    .select({
      id: schema.curlingRegistrations.id,
      status: schema.curlingRegistrations.status,
      curlerMemberId: schema.curlingRegistrations.curler_member_id,
      submittedByMemberId: schema.curlingRegistrations.submitted_by_member_id,
      membershipOption: schema.curlingRegistrations.membership_option,
      returningMemberAnswer: schema.curlingRegistrations.returning_member_answer,
      studentDiscountClaimed: schema.curlingRegistrations.student_discount_claimed,
      studentInstitution: schema.curlingRegistrations.student_institution,
      reciprocalDiscountClaimed: schema.curlingRegistrations.reciprocal_discount_claimed,
      reciprocalClubName: schema.curlingRegistrations.reciprocal_club_name,
      nameTagReplacementQuantity: schema.curlingRegistrations.name_tag_replacement_quantity,
      curlerName: schema.members.name,
      curlerFirstName: schema.members.first_name,
      curlerLastName: schema.members.last_name,
      curlerEmail: schema.members.email,
      lifetimeMember: schema.members.lifetime_member,
      dateOfBirth: schema.members.date_of_birth,
    })
    .from(schema.curlingRegistrations)
    .leftJoin(schema.members, eq(schema.curlingRegistrations.curler_member_id, schema.members.id))
    .where(
      and(
        eq(schema.curlingRegistrations.session_id, input.sessionId),
        sql`${schema.curlingRegistrations.submitted_at} IS NOT NULL`,
        inArray(schema.curlingRegistrations.status, [...BILLING_REGISTRATION_STATUSES]),
        input.curlerMemberIds && input.curlerMemberIds.length > 0
          ? inArray(schema.curlingRegistrations.curler_member_id, input.curlerMemberIds)
          : undefined,
      ),
    )
    .orderBy(asc(schema.members.last_name), asc(schema.members.first_name), asc(schema.curlingRegistrations.id));

  const registrationIds = registrationRows.map((row) => row.id);
  const [settings, firstSession, leagueProcessingActive] = await Promise.all([
    loadBillingPriceSettings(),
    isBillingFirstSessionOfSeason(session.seasonId, session.id),
    isLeagueProcessingActive(),
  ]);

  const sessionLeagues = await db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.session_id, session.id));
  const leagues: Record<number, LeagueConfig> = {};
  for (const row of sessionLeagues) {
    leagues[row.id] = billingLeagueConfig(row, settings.priceConfig.defaultLeagueFeeMinor);
  }

  const [rosterRows, selectionRows, assistanceRows, invoiceRows] = registrationIds.length
    ? await Promise.all([
        db
          .select({
            registrationId: schema.leagueRoster.source_registration_id,
            leagueId: schema.leagueRoster.league_id,
            temporaryFill: schema.leagueRoster.is_temporary_sabbatical_fill,
          })
          .from(schema.leagueRoster)
          .where(
            and(
              inArray(schema.leagueRoster.source_registration_id, registrationIds),
              eq(schema.leagueRoster.status, 'active'),
            ),
          ),
        db
          .select({
            registrationId: schema.registrationSelections.registration_id,
            selectionType: schema.registrationSelections.selection_type,
            leagueId: schema.registrationSelections.league_id,
            temporaryFill: schema.registrationSelections.is_temporary_sabbatical_fill,
          })
          .from(schema.registrationSelections)
          .where(inArray(schema.registrationSelections.registration_id, registrationIds)),
        db
          .select({
            registrationId: schema.financialAssistanceRequests.registration_id,
            requestedPercent: schema.financialAssistanceRequests.requested_percentage,
            approvedPercent: schema.financialAssistanceRequests.approved_percentage,
            status: schema.financialAssistanceRequests.status,
          })
          .from(schema.financialAssistanceRequests)
          .where(inArray(schema.financialAssistanceRequests.registration_id, registrationIds)),
        db
          .select({
            id: schema.registrationInvoices.id,
            registrationId: schema.registrationInvoices.registration_id,
            status: schema.registrationInvoices.status,
            totalMinor: schema.registrationInvoices.total_minor,
            offlinePaymentNote: schema.registrationInvoices.offline_payment_note,
            updatedAt: schema.registrationInvoices.updated_at,
          })
          .from(schema.registrationInvoices)
          .where(inArray(schema.registrationInvoices.registration_id, registrationIds))
          .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id)),
      ])
      : [[], [], [], []];

  const curlerMemberIds = [
    ...new Set(
      registrationRows
        .map((row) => row.curlerMemberId)
        .filter((memberId): memberId is number => memberId != null),
    ),
  ];
  const extrasByMember = curlerMemberIds.length
    ? await loadSessionPlacementChargeLeagues({
        sessionId: session.id,
        memberIds: curlerMemberIds,
      })
    : new Map<number, number[]>();

  const missingLeagueIds = new Set<number>();
  for (const row of rosterRows) missingLeagueIds.add(row.leagueId);
  for (const row of selectionRows) {
    if (row.leagueId != null) missingLeagueIds.add(row.leagueId);
  }
  for (const leagueIds of extrasByMember.values()) {
    for (const leagueId of leagueIds) missingLeagueIds.add(leagueId);
  }
  const unknownLeagueIds = [...missingLeagueIds].filter((id) => leagues[id] == null);
  if (unknownLeagueIds.length > 0) {
    const extraLeagues = await db.select().from(schema.leagues).where(inArray(schema.leagues.id, unknownLeagueIds));
    for (const row of extraLeagues) {
      leagues[row.id] = billingLeagueConfig(row, settings.priceConfig.defaultLeagueFeeMinor);
    }
  }

  const registrationsByMember = new Map<number, number[]>();
  for (const row of registrationRows) {
    if (row.curlerMemberId == null) continue;
    const list = registrationsByMember.get(row.curlerMemberId) ?? [];
    list.push(row.id);
    registrationsByMember.set(row.curlerMemberId, list);
  }

  const rosterByRegistration = new Map<number, RegistrationChargeSet>();
  const addChargeSet = (registrationId: number, part: Partial<RegistrationChargeSet>) => {
    rosterByRegistration.set(
      registrationId,
      mergeRegistrationChargeSets(rosterByRegistration.get(registrationId), part),
    );
  };
  for (const row of rosterRows) {
    if (row.registrationId == null) continue;
    addChargeSet(row.registrationId, {
      chargedLeagueIds: [row.leagueId],
      temporaryFillLeagueIds: row.temporaryFill === 1 ? [row.leagueId] : [],
    });
  }
  for (const [memberId, leagueIds] of extrasByMember) {
    for (const registrationId of registrationsByMember.get(memberId) ?? []) {
      addChargeSet(registrationId, { chargedLeagueIds: leagueIds });
    }
  }

  const selectionsByRegistration = new Map<number, RegistrationSelectionInput[]>();
  for (const row of selectionRows) {
    const list = selectionsByRegistration.get(row.registrationId) ?? [];
    list.push({
      selectionType: row.selectionType,
      leagueId: row.leagueId,
      isTemporarySabbaticalFill: row.temporaryFill === 1,
    });
    selectionsByRegistration.set(row.registrationId, list);
  }

  const assistanceByRegistration = new Map<number, JuniorAssistanceRequest>();
  for (const row of assistanceRows) {
    assistanceByRegistration.set(row.registrationId, {
      requestedPercent: row.requestedPercent,
      approvedPercent: row.approvedPercent,
      status: row.status,
    });
  }

  const latestInvoiceByRegistration = new Map<
    number,
    { status: string; totalMinor: number; offlinePaymentNote: string | null }
  >();
  for (const row of invoiceRows) {
    if (latestInvoiceByRegistration.has(row.registrationId)) continue;
    latestInvoiceByRegistration.set(row.registrationId, {
      status: row.status,
      totalMinor: row.totalMinor,
      offlinePaymentNote: row.offlinePaymentNote,
    });
  }

  const paidByRegistration = new Map<number, number>();
  const activityByRegistration = await listCurlingRegistrationPaymentActivityByRegistrationIds(registrationIds);
  for (const registrationId of registrationIds) {
    paidByRegistration.set(
      registrationId,
      netPaidMinorFromPaymentActivity(
        activityByRegistration.get(registrationId) ?? [],
        latestInvoiceByRegistration.get(registrationId) ?? null,
      ),
    );
  }

  const season: RegistrationContext['season'] = {
    id: session.seasonId,
    name: session.seasonName ?? '',
    startDate: String(session.seasonStartDate ?? ''),
    endDate: String(session.seasonEndDate ?? ''),
  };
  const sessionContext: RegistrationContext['session'] = {
    id: session.id,
    seasonId: session.seasonId,
    name: session.name ?? '',
    startDate: String(session.startDate ?? ''),
    endDate: String(session.endDate ?? ''),
  };

  const registrations: StaffRegistrationBillingRow[] = registrationRows.map((row) => {
    const roster = rosterByRegistration.get(row.id) ?? emptyRegistrationChargeSet();
    const chargedLeagueIds = roster.chargedLeagueIds;
    const temporaryFillLeagueIds = roster.temporaryFillLeagueIds;
    const chargedLeagues = chargedLeagueIds
      .map((leagueId) => ({ id: leagueId, name: leagues[leagueId]?.name ?? `League ${leagueId}` }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const context = stubBillingContext({
      season,
      session: sessionContext,
      isFirstSessionOfSeason: firstSession,
      settings,
      leagues,
      registration: {
        id: row.id,
        curlerMemberId: row.curlerMemberId,
        returningMemberAnswer: row.returningMemberAnswer ?? 0,
        submittedByMemberId: row.submittedByMemberId,
        membershipOption: row.membershipOption,
        studentDiscountClaimed: row.studentDiscountClaimed ?? 0,
        studentInstitution: row.studentInstitution,
        reciprocalDiscountClaimed: row.reciprocalDiscountClaimed ?? 0,
        reciprocalClubName: row.reciprocalClubName,
        nameTagReplacementQuantity: row.nameTagReplacementQuantity,
        hasLifetimeMembership: (row.lifetimeMember ?? 0) === 1,
        dateOfBirth: row.dateOfBirth ? String(row.dateOfBirth) : null,
      },
      selections: selectionsByRegistration.get(row.id) ?? [],
      chargedLeagueIds,
      juniorAssistance: assistanceByRegistration.get(row.id),
    });
    const feePreview = calculateRegistrationFees(context, {
      chargedLeagueIds,
      temporaryFillLeagueIds,
    });
    const owedMinor = feePreview.totalDueMinor;
    const paidMinor = paidByRegistration.get(row.id) ?? 0;
    const balanceMinor = registrationBalanceMinor(owedMinor, paidMinor);
    return {
      registrationId: row.id,
      curlerId: row.curlerMemberId,
      curlerName: billingMemberName({
        name: row.curlerName,
        first_name: row.curlerFirstName,
        last_name: row.curlerLastName,
        email: row.curlerEmail,
      }),
      curlerEmail: row.curlerEmail,
      registrationStatus: row.status,
      chargedLeagues,
      owedLines: billingFeeLines(feePreview.lineItems),
      owedDiscountLines: billingFeeLines(feePreview.discountLineItems),
      owedSubtotalMinor: feePreview.subtotalMinor,
      owedDiscountMinor: feePreview.discountTotalMinor,
      owedMinor,
      paidMinor,
      balanceMinor,
      canRequestPayment: remainingDueMinor(owedMinor, paidMinor) > 0 && !leagueProcessingActive,
      canIssueRefund: refundDueMinor(owedMinor, paidMinor) > 0,
    };
  });

  return {
    sessionId: session.id,
    sessionName,
    leagueProcessingActive,
    registrations,
  };
}

export async function issueStaffRegistrationRefund(input: {
  actor: Member;
  registrationId: number;
  note: string;
}): Promise<{
  registrationId: number;
  amountRefundedMinor: number;
  refundIds: number[];
}> {
  assertBillingAccess(input.actor);
  const parsedNote = parseRegistrationRefundNote(input.note);
  if (!parsedNote.ok) {
    throw new RegistrationBillingValidationError({ note: parsedNote.error });
  }

  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select({
      id: schema.curlingRegistrations.id,
      status: schema.curlingRegistrations.status,
      sessionId: schema.curlingRegistrations.session_id,
      curlerMemberId: schema.curlingRegistrations.curler_member_id,
    })
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.id, input.registrationId))
    .limit(1);
  if (!registration) {
    throw new RegistrationBillingValidationError({ registration: 'Registration was not found.' });
  }
  if (registration.status === 'cancelled') {
    throw new RegistrationBillingValidationError({
      registration: 'Canceled registrations cannot be refunded from billing.',
    });
  }
  if (!registration.curlerMemberId) {
    throw new RegistrationBillingValidationError({ curler: 'The curler is required.' });
  }

  const billing = await listStaffRegistrationBilling({
    actor: input.actor,
    sessionId: registration.sessionId,
  });
  const row = billing.registrations.find((item) => item.registrationId === input.registrationId);
  if (!row) {
    throw new RegistrationBillingValidationError({ registration: 'This registration is not on the billing list.' });
  }
  const amountToRefund = refundDueMinor(row.owedMinor, row.paidMinor);
  if (amountToRefund <= 0) {
    throw new RegistrationBillingValidationError({ payment: 'This registration does not have an overpayment to refund.' });
  }

  const activity = await listCurlingRegistrationPaymentActivity(input.registrationId);
  const refundedByOrder = new Map<number, number>();
  for (const entry of activity) {
    if (entry.kind !== 'refund' || !COUNTED_REGISTRATION_REFUND_STATUSES.has(entry.status)) continue;
    refundedByOrder.set(entry.orderId, (refundedByOrder.get(entry.orderId) ?? 0) + entry.amountMinor);
  }

  const refundableOrders = activity
    .filter(
      (entry) =>
        entry.kind === 'payment' &&
        (entry.status === 'succeeded' || entry.status === 'partially_refunded') &&
        refundableRemainingMinor(entry.amountMinor, refundedByOrder.get(entry.orderId) ?? 0) > 0,
    )
    .sort((left, right) => {
      const leftTime = left.occurredAt ? new Date(left.occurredAt).getTime() : 0;
      const rightTime = right.occurredAt ? new Date(right.occurredAt).getTime() : 0;
      return rightTime - leftTime;
    });

  if (refundableOrders.length === 0) {
    throw new RegistrationBillingValidationError({
      payment: 'No refundable card payment is on file for this registration.',
    });
  }

  const paymentService = createPaymentService();
  const refundIds: number[] = [];
  let remaining = amountToRefund;
  try {
    for (const order of refundableOrders) {
      if (remaining <= 0) break;
      const available = refundableRemainingMinor(order.amountMinor, refundedByOrder.get(order.orderId) ?? 0);
      if (available <= 0) continue;
      const chunk = Math.min(remaining, available);
      const refund = await paymentService.createRefundForOrder({
        orderId: order.orderId,
        amountMinor: chunk,
        reason: parsedNote.note,
        requestedByMemberId: input.actor.id,
      });
      refundIds.push(refund.refundId);
      remaining -= chunk;
    }
  } catch (error) {
    if (error instanceof PaymentServiceError) {
      throw new RegistrationBillingValidationError({ payment: error.message });
    }
    throw error;
  }

  if (remaining > 0) {
    throw new RegistrationBillingValidationError({
      payment: `Only part of the overpayment could be refunded. $${(remaining / 100).toFixed(2)} still has no refundable card payment.`,
    });
  }

  return {
    registrationId: input.registrationId,
    amountRefundedMinor: amountToRefund,
    refundIds,
  };
}
