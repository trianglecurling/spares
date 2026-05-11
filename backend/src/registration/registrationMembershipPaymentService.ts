import { and, asc, eq, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type {
  CurlingExperienceTypeSqlite,
  CurlingMembershipOptionSqlite,
  RegistrationInvoiceLineKindSqlite,
} from '../db/drizzle-schema.js';
import { createPaymentService, PaymentServiceError } from '../services/paymentService.js';
import { evaluateRegistrationDraft } from './evaluateRegistrationDraft.js';
import { calculateClubExperienceYears } from './registrationAgeExperience.js';
import type { RegistrationFeeLineItem, RegistrationFeePreview } from './registrationFeeCalculator.js';
import type { RegistrationPaymentDecision } from './registrationPaymentDecision.js';
import type { LeagueConfig, RegistrationContext, RegistrationSelectionInput } from './registrationContext.js';
import { canViewOrEditRegistration, getEffectiveRegistrationWindow, getRegistrationById } from './registrationShellService.js';
import type { Member } from '../types.js';

export class RegistrationMembershipPaymentValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Registration membership payment validation failed');
  }
}

type RegistrationMembershipPaymentSelection = {
  membershipOption: CurlingMembershipOptionSqlite;
  studentDiscountClaimed: boolean;
  studentInstitution: string | null;
  reciprocalDiscountClaimed: boolean;
  reciprocalClubName: string | null;
  experienceType: CurlingExperienceTypeSqlite | null;
  experienceSelfReportedYears: number | null;
};

type RegistrationMembershipPaymentRowFields = {
  status: string;
  membership_option: CurlingMembershipOptionSqlite;
  student_discount_claimed: number;
  student_institution: string | null;
  reciprocal_discount_claimed: number;
  reciprocal_club_name: string | null;
  experience_type: CurlingExperienceTypeSqlite | null;
  experience_self_reported_years: number | null;
};

export type RegistrationMembershipPaymentPayload = {
  selection: RegistrationMembershipPaymentSelection;
  isFirstSessionOfSeason: boolean;
  knownExperienceYears: number;
  feePreview: RegistrationFeePreview;
  paymentDecision: RegistrationPaymentDecision;
};

type UpdateMembershipInput = {
  membershipOption: 'regular' | 'social' | 'junior_recreational';
  basicIcePrivileges?: boolean;
  juniorAssistancePercent?: number | null;
};

type UpdateDiscountsInput = {
  studentDiscountClaimed?: boolean;
  studentInstitution?: string | null;
  reciprocalDiscountClaimed?: boolean;
  reciprocalClubName?: string | null;
};

type UpdateExperienceInput =
  | {
      experienceType: 'none_or_minimal';
      experienceSelfReportedYears?: null;
    }
  | {
      experienceType: 'specified_years';
      experienceSelfReportedYears: number;
    }
  | {
      experienceType: 'known_existing';
      experienceSelfReportedYears?: null;
    };

type SubmitRegistrationInput = {
  registrationId: number;
  actor: Member;
};

type SubmitRegistrationResult =
  | {
      outcome: 'immediate_payment';
      registrationId: number;
      invoiceId: number;
      checkoutUrl: string;
      orderToken: string;
      totalDueMinor: number;
    }
  | {
      outcome: 'deferred_payment' | 'no_payment_required';
      registrationId: number;
      invoiceId: number;
      totalDueMinor: number;
      deferralReasons: string[];
    };

function normalizeDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === null || value === undefined) return '';
  const raw = String(value);
  return raw.includes('T') ? raw.slice(0, 10) : raw;
}

function mapLeagueConfig(row: {
  id: number;
  session_id: number | null;
  name: string;
  league_type: 'standard' | 'bring_your_own_team';
  capacity_type: 'individual' | 'team';
  capacity_value: number;
  registration_fee_minor: number;
  requires_club_membership: number;
  is_instructional: number;
  min_experience_years: number | null;
  min_age: number | null;
  max_age: number | null;
  start_date: unknown;
  end_date: unknown;
  first_day_of_play: unknown;
  last_day_of_play: unknown;
  allows_waitlist: number;
  allows_sabbatical: number;
  predecessor_league_id: number | null;
  successor_league_id: number | null;
}): LeagueConfig {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    leagueType: row.league_type,
    capacityType: row.capacity_type,
    capacityValue: row.capacity_value,
    registrationFeeMinor: row.registration_fee_minor,
    requiresClubMembership: row.requires_club_membership === 1,
    isInstructional: row.is_instructional === 1,
    minExperienceYears: row.min_experience_years,
    minAge: row.min_age,
    maxAge: row.max_age,
    startDate: normalizeDate(row.start_date),
    endDate: normalizeDate(row.end_date),
    firstDayOfPlay: row.first_day_of_play ? normalizeDate(row.first_day_of_play) : null,
    lastDayOfPlay: row.last_day_of_play ? normalizeDate(row.last_day_of_play) : null,
    allowsWaitlist: row.allows_waitlist === 1,
    allowsSabbatical: row.allows_sabbatical === 1,
    predecessorLeagueId: row.predecessor_league_id,
    successorLeagueId: row.successor_league_id,
    discountEligible: true,
  };
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function jsonStorageValue(value: unknown): unknown {
  return getDatabaseConfig()?.type === 'postgres' ? value : JSON.stringify(value);
}

function dbValue(value: unknown): never {
  return value as never;
}

function frontendBaseUrl(): string {
  return config.frontendUrl.replace(/\/+$/, '');
}

function membershipPaymentFieldsFromRegistrationRow(row: RegistrationMembershipPaymentRowFields): RegistrationMembershipPaymentSelection {
  return {
    membershipOption: (row.membership_option ?? 'none') as CurlingMembershipOptionSqlite,
    studentDiscountClaimed: row.student_discount_claimed === 1,
    studentInstitution: row.student_institution ?? null,
    reciprocalDiscountClaimed: row.reciprocal_discount_claimed === 1,
    reciprocalClubName: row.reciprocal_club_name ?? null,
    experienceType: (row.experience_type ?? null) as CurlingExperienceTypeSqlite | null,
    experienceSelfReportedYears:
      row.experience_self_reported_years === null || row.experience_self_reported_years === undefined
        ? null
        : Number(row.experience_self_reported_years),
  };
}

async function requireRegistrationAccess(registrationId: number, actor: Member) {
  const registration = await getRegistrationById(registrationId);
  if (!registration) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration draft not found.' });
  }
  if (!(await canViewOrEditRegistration(actor, registration))) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'You do not have access to this registration.' });
  }
  return registration;
}

async function loadFullRegistration(registrationId: number) {
  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select()
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.id, registrationId))
    .limit(1);
  if (!registration) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration draft not found.' });
  }
  return registration;
}

export async function isFirstSessionOfSeason(seasonId: number, sessionId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const [firstSession] = await db
    .select({ id: schema.curlingSessions.id })
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.season_id, seasonId))
    .orderBy(asc(schema.curlingSessions.start_date), asc(schema.curlingSessions.id))
    .limit(1);
  return firstSession?.id === sessionId;
}

async function loadCompletedSessions(memberId: number): Promise<RegistrationContext['experience']['completedSessions']> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.leagueRoster.league_id,
      seasonKey: schema.curlingSeasons.name,
    })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .innerJoin(schema.curlingSessions, eq(schema.leagues.session_id, schema.curlingSessions.id))
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
    .where(
      eq(schema.leagueRoster.member_id, memberId)
    );

  return rows.map((row) => ({
    leagueId: row.leagueId,
    seasonKey: row.seasonKey,
  }));
}

async function loadLeaguesForSession(sessionId: number): Promise<Record<number, LeagueConfig>> {
  const { db, schema } = getDrizzleDb();
  const rows = await db.select().from(schema.leagues).where(eq(schema.leagues.session_id, sessionId));
  return Object.fromEntries(rows.map((row) => [row.id, mapLeagueConfig(row)]));
}

async function loadRegistrationSelections(registrationId: number): Promise<RegistrationSelectionInput[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.registrationSelections)
    .where(eq(schema.registrationSelections.registration_id, registrationId))
    .orderBy(asc(schema.registrationSelections.rank), asc(schema.registrationSelections.id));

  return rows.map((row) => ({
    selectionType: row.selection_type,
    leagueId: row.league_id,
    rank: row.rank,
    replacesLeagueId: row.replaces_league_id,
    byotTeammateText: row.byot_teammate_text,
    isTemporarySabbaticalFill: row.is_temporary_sabbatical_fill === 1,
  }));
}

async function loadActiveLeagueIds(memberId: number, sessionId: number): Promise<number[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ leagueId: schema.leagueRoster.league_id })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .where(
      and(
        eq(schema.leagueRoster.member_id, memberId),
        eq(schema.leagueRoster.status, 'active'),
        eq(schema.leagues.session_id, sessionId)
      )
    );
  return rows.map((row) => row.leagueId);
}

async function loadExistingSabbaticals(memberId: number): Promise<RegistrationContext['existingSabbaticals']> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.curlingLeagueSabbaticals)
    .where(eq(schema.curlingLeagueSabbaticals.member_id, memberId));
  return rows.map((row) => ({
    id: row.id,
    originalLeagueId: row.original_league_id,
    currentLeagueId: row.current_league_id,
    firstSabbaticalLeagueId: row.first_sabbatical_league_id,
    firstSabbaticalStartDate: normalizeDate(row.first_sabbatical_start_date),
    status: row.status,
    staffOverride: row.staff_override === 1,
  }));
}

async function loadExistingWaitlistEntries(memberId: number, sessionId: number): Promise<RegistrationContext['existingWaitlistEntries']> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.waitlistEntries.league_id,
      entryType: schema.waitlistEntries.entry_type,
      replacesLeagueId: schema.waitlistEntries.replaces_league_id,
      status: schema.waitlistEntries.status,
    })
    .from(schema.waitlistEntries)
    .innerJoin(schema.leagues, eq(schema.waitlistEntries.league_id, schema.leagues.id))
    .where(and(eq(schema.waitlistEntries.member_id, memberId), eq(schema.leagues.session_id, sessionId)));
  return rows.map((row) => ({
    leagueId: row.leagueId,
    entryType: row.entryType,
    replacesLeagueId: row.replacesLeagueId,
    status: row.status,
  }));
}

async function loadJuniorAssistance(registrationId: number): Promise<RegistrationContext['juniorAssistance'] | undefined> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.financialAssistanceRequests)
    .where(eq(schema.financialAssistanceRequests.registration_id, registrationId))
    .limit(1);
  if (!row) return undefined;
  return {
    requestedPercent: row.requested_percentage,
    approvedPercent: row.approved_percentage,
    status: row.status,
  };
}

async function loadRegistrationSettings(): Promise<{
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

type RegistrationMembershipPaymentSourceRow = {
  season_id: number;
  session_id: number;
  curler_member_id: number | null;
  returning_member_answer: number | null;
  submitted_by_member_id: number | null;
  status: string;
  membership_option: CurlingMembershipOptionSqlite;
  student_discount_claimed: number;
  student_institution: string | null;
  reciprocal_discount_claimed: number;
  reciprocal_club_name: string | null;
  experience_type: CurlingExperienceTypeSqlite | null;
  experience_self_reported_years: number | null;
};

async function buildRegistrationContextFromSourceRow(
  registration: RegistrationMembershipPaymentSourceRow,
  options: {
    registrationId?: number;
    curlerDateOfBirth: string | null | undefined;
    completedSessions: RegistrationContext['experience']['completedSessions'];
  },
): Promise<RegistrationContext> {
  const window = await getEffectiveRegistrationWindow(registration.season_id, registration.session_id);
  if (!window) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration window not found.' });
  }

  const settings = await loadRegistrationSettings();
  const selected = membershipPaymentFieldsFromRegistrationRow(registration);
  const membershipOption = selected.membershipOption;
  const useKnownExperience = selected.experienceType === null && options.completedSessions.length > 0;
  const experienceType = (selected.experienceType ?? (useKnownExperience ? 'known_existing' : 'none_or_minimal')) as CurlingExperienceTypeSqlite;
  const memberId = registration.curler_member_id ?? null;
  const emptyContextState: [
    Record<number, LeagueConfig>,
    RegistrationSelectionInput[],
    number[],
    RegistrationContext['existingSabbaticals'],
    RegistrationContext['existingWaitlistEntries'],
    RegistrationContext['juniorAssistance'] | undefined,
  ] = [{}, [], [], [], [], undefined];
  const [leagues, selections, activeLeagueIds, existingSabbaticals, existingWaitlistEntries, juniorAssistance] = options.registrationId
    ? await Promise.all([
        loadLeaguesForSession(registration.session_id),
        loadRegistrationSelections(options.registrationId),
        memberId ? loadActiveLeagueIds(memberId, registration.session_id) : Promise.resolve([]),
        memberId ? loadExistingSabbaticals(memberId) : Promise.resolve([]),
        memberId ? loadExistingWaitlistEntries(memberId, registration.session_id) : Promise.resolve([]),
        loadJuniorAssistance(options.registrationId),
      ])
    : emptyContextState;
  const participatedLeagueIds = Array.from(
    new Set([...options.completedSessions.map((session) => session.leagueId), ...activeLeagueIds])
  );

  return {
    season: {
      id: window.season.id,
      name: window.season.name ?? '',
      startDate: window.season.startDate ?? '',
      endDate: window.season.endDate ?? '',
    },
    session: {
      id: window.session.id,
      seasonId: window.session.seasonId,
      name: window.session.name ?? '',
      startDate: window.session.startDate ?? '',
      endDate: window.session.endDate ?? '',
    },
    registrationState: window.state,
    isFirstSessionOfSeason: await isFirstSessionOfSeason(registration.season_id, registration.session_id),
    registrant: {
      memberId: registration.curler_member_id,
      hasUserAccount: Boolean(registration.curler_member_id),
      isReturningMember: registration.returning_member_answer === 1,
      dateOfBirth: normalizeDate(options.curlerDateOfBirth),
    },
    submittedByMemberId: registration.submitted_by_member_id,
    membershipOption,
    experience: {
      type: experienceType,
      selfReportedYears: selected.experienceSelfReportedYears,
      completedSessions: options.completedSessions,
    },
    activeLeagueIds,
    participatedLeagueIds,
    existingSabbaticals,
    existingWaitlistEntries,
    leagues,
    selections,
    discountClaims:
      membershipOption === 'social'
        ? {}
        : {
            student: {
              claimed: selected.studentDiscountClaimed,
              institution: selected.studentInstitution,
            },
            reciprocal: {
              claimed: selected.reciprocalDiscountClaimed,
              clubName: selected.reciprocalClubName,
            },
            winterOnly: {},
          },
    ...settings,
    juniorAssistance,
    sabbaticalDurationLimitYears: 3,
  };
}

export async function buildRegistrationContextForDraft(registrationId: number): Promise<RegistrationContext> {
  const { db, schema } = getDrizzleDb();
  const registration = await loadFullRegistration(registrationId);
  const [curler] = registration.curler_member_id
    ? await db.select().from(schema.members).where(eq(schema.members.id, registration.curler_member_id)).limit(1)
    : [];
  const completedSessions = registration.curler_member_id ? await loadCompletedSessions(registration.curler_member_id) : [];
  return buildRegistrationContextFromSourceRow(registration, {
    registrationId,
    curlerDateOfBirth: curler?.date_of_birth,
    completedSessions,
  });
}

export type GuestMembershipPaymentPreviewInput = {
  seasonId: number;
  sessionId: number;
  curlerDateOfBirth: string;
  membershipChoice: 'regular' | 'social';
  basicIcePrivileges: boolean;
  studentDiscountClaimed: boolean;
  studentInstitution: string | null;
  reciprocalDiscountClaimed: boolean;
  reciprocalClubName: string | null;
  experienceType: 'none_or_minimal' | 'specified_years' | 'known_existing';
  experienceSelfReportedYears: number | null;
};

export async function getGuestMembershipPaymentPreview(input: GuestMembershipPaymentPreviewInput): Promise<RegistrationMembershipPaymentPayload> {
  const window = await getEffectiveRegistrationWindow(input.seasonId, input.sessionId);
  if (!window) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration window not found.' });
  }
  const membershipOption: CurlingMembershipOptionSqlite =
    input.membershipChoice === 'social' ? 'social' : input.basicIcePrivileges ? 'regular_spare_only' : 'regular';
  const experienceTypeResolved: CurlingExperienceTypeSqlite | null =
    input.membershipChoice === 'social'
      ? null
      : input.experienceType === 'known_existing'
        ? 'none_or_minimal'
        : input.experienceType;
  const experienceYears =
    input.membershipChoice === 'social' || input.experienceType !== 'specified_years' ? null : input.experienceSelfReportedYears;

  const synthetic: RegistrationMembershipPaymentSourceRow = {
    season_id: input.seasonId,
    session_id: input.sessionId,
    curler_member_id: null,
    returning_member_answer: 0,
    submitted_by_member_id: null,
    status: 'shell_complete',
    membership_option: membershipOption,
    student_discount_claimed: input.membershipChoice === 'social' ? 0 : input.studentDiscountClaimed ? 1 : 0,
    student_institution: input.membershipChoice === 'social' ? null : input.studentInstitution,
    reciprocal_discount_claimed: input.membershipChoice === 'social' ? 0 : input.reciprocalDiscountClaimed ? 1 : 0,
    reciprocal_club_name: input.membershipChoice === 'social' ? null : input.reciprocalClubName,
    experience_type: experienceTypeResolved,
    experience_self_reported_years: experienceYears,
  };

  const context = await buildRegistrationContextFromSourceRow(synthetic, {
    curlerDateOfBirth: input.curlerDateOfBirth,
    completedSessions: [],
  });
  const evaluation = evaluateRegistrationDraft(context);

  return {
    selection: membershipPaymentFieldsFromRegistrationRow(synthetic),
    isFirstSessionOfSeason: context.isFirstSessionOfSeason,
    knownExperienceYears: calculateClubExperienceYears(context.experience.completedSessions),
    feePreview: evaluation.feePreview,
    paymentDecision: evaluation.paymentDecision,
  };
}

export async function getRegistrationMembershipPaymentPayload(
  registrationId: number,
  actor: Member,
): Promise<RegistrationMembershipPaymentPayload> {
  await requireRegistrationAccess(registrationId, actor);
  const registration = await loadFullRegistration(registrationId);
  const context = await buildRegistrationContextForDraft(registrationId);
  const evaluation = evaluateRegistrationDraft(context);

  return {
    selection: membershipPaymentFieldsFromRegistrationRow(registration),
    isFirstSessionOfSeason: context.isFirstSessionOfSeason,
    knownExperienceYears: calculateClubExperienceYears(context.experience.completedSessions),
    feePreview: evaluation.feePreview,
    paymentDecision: evaluation.paymentDecision,
  };
}

function assertShellComplete(row: { status: string }): void {
  if (row.status !== 'shell_complete' && row.status !== 'submitted' && row.status !== 'awaiting_payment') {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Complete the registration shell before choosing membership.' });
  }
}

export async function updateMembership(registrationId: number, actor: Member, input: UpdateMembershipInput) {
  await requireRegistrationAccess(registrationId, actor);
  const registration = await loadFullRegistration(registrationId);
  assertShellComplete(registration);

  const membershipOption: CurlingMembershipOptionSqlite =
    input.membershipOption === 'social'
      ? 'social'
      : input.membershipOption === 'junior_recreational'
        ? 'junior_recreational'
        : input.basicIcePrivileges
          ? 'regular_spare_only'
          : 'regular';
  const { db, schema } = getDrizzleDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.curlingRegistrations)
      .set({
        membership_option: membershipOption,
        student_discount_claimed:
          membershipOption === 'social' || membershipOption === 'junior_recreational' ? 0 : registration.student_discount_claimed,
        student_institution:
          membershipOption === 'social' || membershipOption === 'junior_recreational' ? null : registration.student_institution,
        reciprocal_discount_claimed:
          membershipOption === 'social' || membershipOption === 'junior_recreational' ? 0 : registration.reciprocal_discount_claimed,
        reciprocal_club_name:
          membershipOption === 'social' || membershipOption === 'junior_recreational' ? null : registration.reciprocal_club_name,
        experience_type:
          membershipOption === 'social' || membershipOption === 'junior_recreational' ? null : registration.experience_type,
        experience_self_reported_years:
          membershipOption === 'social' || membershipOption === 'junior_recreational' ? null : registration.experience_self_reported_years,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, registrationId));

    await tx
      .delete(schema.financialAssistanceRequests)
      .where(eq(schema.financialAssistanceRequests.registration_id, registrationId));
    const requestedPercent = input.juniorAssistancePercent ?? 0;
    if (membershipOption === 'junior_recreational' && requestedPercent > 0) {
      if (![25, 50, 75].includes(requestedPercent)) {
        throw new RegistrationMembershipPaymentValidationError({
          juniorAssistancePercent: 'Junior Recreational assistance must be 25%, 50%, or 75%.',
        });
      }
      await tx.insert(schema.financialAssistanceRequests).values({
        registration_id: registrationId,
        member_id: registration.curler_member_id ?? actor.id,
        requested_percentage: requestedPercent,
        status: 'pending',
        updated_at: sql`CURRENT_TIMESTAMP`,
      });
    }
  });
  return getRegistrationMembershipPaymentPayload(registrationId, actor);
}

export async function updateDiscounts(registrationId: number, actor: Member, input: UpdateDiscountsInput) {
  await requireRegistrationAccess(registrationId, actor);
  const registration = await loadFullRegistration(registrationId);
  assertShellComplete(registration);
  if (registration.membership_option === 'social') {
    throw new RegistrationMembershipPaymentValidationError({ discounts: 'Social membership cannot receive discounts.' });
  }
  if (registration.membership_option === 'junior_recreational') {
    throw new RegistrationMembershipPaymentValidationError({ discounts: 'Junior Recreational cannot receive standard discounts.' });
  }

  const studentClaimed = input.studentDiscountClaimed === true;
  const reciprocalClaimed = input.reciprocalDiscountClaimed === true;
  if (studentClaimed && !trimOrNull(input.studentInstitution)) {
    throw new RegistrationMembershipPaymentValidationError({ studentInstitution: 'Student discount requires an institution.' });
  }
  if (reciprocalClaimed && !trimOrNull(input.reciprocalClubName)) {
    throw new RegistrationMembershipPaymentValidationError({ reciprocalClubName: 'Reciprocal discount requires another curling club.' });
  }

  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.curlingRegistrations)
    .set({
      student_discount_claimed: studentClaimed ? 1 : 0,
      student_institution: studentClaimed ? trimOrNull(input.studentInstitution) : null,
      reciprocal_discount_claimed: reciprocalClaimed ? 1 : 0,
      reciprocal_club_name: reciprocalClaimed ? trimOrNull(input.reciprocalClubName) : null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.curlingRegistrations.id, registrationId));
  return getRegistrationMembershipPaymentPayload(registrationId, actor);
}

export async function updateExperience(registrationId: number, actor: Member, input: UpdateExperienceInput) {
  await requireRegistrationAccess(registrationId, actor);
  const registration = await loadFullRegistration(registrationId);
  assertShellComplete(registration);
  if (registration.membership_option === 'social') {
    throw new RegistrationMembershipPaymentValidationError({ experience: 'Social membership does not require curling experience.' });
  }
  if (registration.membership_option === 'junior_recreational') {
    throw new RegistrationMembershipPaymentValidationError({ experience: 'Junior Recreational does not use normal league experience.' });
  }
  if (input.experienceType === 'specified_years') {
    if (!Number.isFinite(input.experienceSelfReportedYears) || input.experienceSelfReportedYears < 0) {
      throw new RegistrationMembershipPaymentValidationError({ experienceSelfReportedYears: 'Experience must be a non-negative number.' });
    }
  }

  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.curlingRegistrations)
    .set({
      experience_type: input.experienceType,
      experience_self_reported_years: input.experienceType === 'specified_years' ? input.experienceSelfReportedYears : null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.curlingRegistrations.id, registrationId));
  return getRegistrationMembershipPaymentPayload(registrationId, actor);
}

function assertReadyToSubmit(registration: { status: string }, context: RegistrationContext, feePreview: RegistrationFeePreview): void {
  if (registration.status !== 'shell_complete' && registration.status !== 'submitted' && registration.status !== 'awaiting_payment') {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration is not ready to submit.' });
  }
  if (context.registrationState === 'closed') {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration is closed.' });
  }
  if (
    context.membershipOption !== 'regular' &&
    context.membershipOption !== 'regular_spare_only' &&
    context.membershipOption !== 'social' &&
    context.membershipOption !== 'junior_recreational'
  ) {
    throw new RegistrationMembershipPaymentValidationError({ membershipOption: 'Choose regular, social, or Junior Recreational membership.' });
  }
  if (context.membershipOption === 'social' || context.membershipOption === 'junior_recreational') {
    return;
  }
  if (!context.experience.type) {
    throw new RegistrationMembershipPaymentValidationError({ experience: 'Curling experience is required.' });
  }
  if (context.experience.type === 'specified_years' && (context.experience.selfReportedYears ?? -1) < 0) {
    throw new RegistrationMembershipPaymentValidationError({ experienceSelfReportedYears: 'Experience must be a non-negative number.' });
  }
  if (feePreview.blockingErrors.length > 0) {
    throw new RegistrationMembershipPaymentValidationError({
      fees: feePreview.blockingErrors.map((error) => error.message).join(' '),
    });
  }
}

async function createInvoiceSnapshot(input: {
  registrationId: number;
  payerMemberId: number;
  feePreview: RegistrationFeePreview;
  paymentDecision: RegistrationPaymentDecision;
}): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const status =
    input.paymentDecision.outcome === 'deferred_payment'
      ? 'deferred'
      : input.paymentDecision.outcome === 'immediate_payment'
        ? 'awaiting_payment'
        : 'paid';
  const [invoice] = await db
    .insert(schema.registrationInvoices)
    .values({
      registration_id: input.registrationId,
      payer_member_id: input.payerMemberId,
      status,
      subtotal_minor: input.feePreview.subtotalMinor,
      discount_minor: input.feePreview.discountTotalMinor,
      total_minor: input.feePreview.totalDueMinor,
      currency: 'usd',
      deferred: input.paymentDecision.outcome === 'deferred_payment' ? 1 : 0,
      deferred_reason: input.paymentDecision.deferralReasons.join(',') || null,
    })
    .returning({ id: schema.registrationInvoices.id });

  const lineItems = [...input.feePreview.lineItems, ...input.feePreview.discountLineItems];
  if (lineItems.length > 0) {
    await db.insert(schema.registrationInvoiceLineItems).values(
      lineItems.map((lineItem: RegistrationFeeLineItem, index: number) => ({
        invoice_id: invoice.id,
        line_type: lineItem.lineType as RegistrationInvoiceLineKindSqlite,
        description: lineItem.description,
        related_league_id: lineItem.relatedLeagueId ?? null,
        amount_minor: lineItem.amountMinor,
        discount_eligible: lineItem.discountEligible ? 1 : 0,
        sort_order: index,
      }))
    );
  }
  return invoice.id;
}

export async function submitRegistrationMembershipPayment(input: SubmitRegistrationInput): Promise<SubmitRegistrationResult> {
  await requireRegistrationAccess(input.registrationId, input.actor);
  const registration = await loadFullRegistration(input.registrationId);
  const context = await buildRegistrationContextForDraft(input.registrationId);
  const evaluation = evaluateRegistrationDraft(context);
  assertReadyToSubmit(registration, context, evaluation.feePreview);

  const payerMemberId = registration.submitted_by_member_id ?? input.actor.id;
  const invoiceId = await createInvoiceSnapshot({
    registrationId: input.registrationId,
    payerMemberId,
    feePreview: evaluation.feePreview,
    paymentDecision: evaluation.paymentDecision,
  });

  const { db, schema } = getDrizzleDb();
  if (evaluation.paymentDecision.outcome === 'immediate_payment') {
    try {
      const paymentService = createPaymentService();
      const order = await paymentService.createPaymentOrder({
        provider: 'stripe',
        subjectType: 'curling_registration',
        subjectId: input.registrationId,
        amountMinor: evaluation.feePreview.totalDueMinor,
        currency: 'usd',
        createdByMemberId: payerMemberId,
        metadata: {
          registrationId: input.registrationId,
          invoiceId,
          curlerMemberId: registration.curler_member_id,
          submittedByMemberId: registration.submitted_by_member_id,
        },
      });
      const checkout = await paymentService.createHostedCheckoutForOrder({
        orderId: order.id,
        successUrl: `${frontendBaseUrl()}/registration/success?registration_id=${input.registrationId}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontendBaseUrl()}/registration/cancel?registration_id=${input.registrationId}`,
      });
      await db
        .update(schema.registrationInvoices)
        .set({
          status: 'checkout_started',
          payment_order_id: order.id,
          stripe_checkout_session_id: checkout.providerOrderId,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.registrationInvoices.id, invoiceId));
      await db
        .update(schema.curlingRegistrations)
        .set({
          status: 'payment_started',
          submitted_at: dbValue(registration.submitted_at ?? new Date()),
          last_fee_preview_json: dbValue(jsonStorageValue(evaluation.feePreview)),
          payment_decision_json: dbValue(jsonStorageValue(evaluation.paymentDecision)),
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.curlingRegistrations.id, input.registrationId));

      return {
        outcome: 'immediate_payment',
        registrationId: input.registrationId,
        invoiceId,
        checkoutUrl: checkout.checkoutUrl,
        orderToken: order.orderToken,
        totalDueMinor: evaluation.feePreview.totalDueMinor,
      };
    } catch (error) {
      if (error instanceof PaymentServiceError) {
        throw new RegistrationMembershipPaymentValidationError({ payment: error.message });
      }
      throw error;
    }
  }

  await db
    .update(schema.curlingRegistrations)
    .set({
      status: evaluation.paymentDecision.outcome === 'deferred_payment' ? 'awaiting_placement' : 'confirmed',
      submitted_at: dbValue(registration.submitted_at ?? new Date()),
      last_fee_preview_json: dbValue(jsonStorageValue(evaluation.feePreview)),
      payment_decision_json: dbValue(jsonStorageValue(evaluation.paymentDecision)),
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.curlingRegistrations.id, input.registrationId));

  return {
    outcome: evaluation.paymentDecision.outcome,
    registrationId: input.registrationId,
    invoiceId,
    totalDueMinor: evaluation.feePreview.totalDueMinor,
    deferralReasons: evaluation.paymentDecision.deferralReasons,
  };
}

export async function confirmCurlingRegistrationForPaymentOrder(orderId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [order] = await db
    .select({
      id: schema.paymentOrders.id,
      subject_type: schema.paymentOrders.subject_type,
      subject_id: schema.paymentOrders.subject_id,
      status: schema.paymentOrders.status,
    })
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.id, orderId))
    .limit(1);
  if (!order || order.subject_type !== 'curling_registration' || order.status !== 'succeeded' || !order.subject_id) {
    return;
  }

  const [registration] = await db
    .select()
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.id, order.subject_id))
    .limit(1);
  if (!registration || !registration.curler_member_id) return;
  const [season] = await db
    .select()
    .from(schema.curlingSeasons)
    .where(eq(schema.curlingSeasons.id, registration.season_id))
    .limit(1);
  if (!season) return;

  const paidAt = new Date();
  await db
    .update(schema.registrationInvoices)
    .set({
      status: 'paid',
      paid_at: dbValue(paidAt),
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.registrationInvoices.payment_order_id, order.id));
  await db
    .update(schema.curlingRegistrations)
    .set({
      status: 'confirmed',
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.curlingRegistrations.id, order.subject_id));

  const membershipType = registration.membership_option === 'social' ? 'social' : 'regular';
  await db
    .insert(schema.seasonMemberships)
    .values({
      member_id: registration.curler_member_id,
      season_id: registration.season_id,
      membership_type: membershipType,
      starts_at: dbValue(normalizeDate(season.start_date)),
      ends_at: dbValue(normalizeDate(season.end_date)),
      source_registration_id: registration.id,
      payment_order_id: order.id,
      status: 'active',
    });

  if (registration.membership_option === 'regular_spare_only') {
    await db.insert(schema.curlingIcePrivileges).values({
      member_id: registration.curler_member_id,
      season_id: registration.season_id,
      session_id: registration.session_id,
      source_type: 'spare_only',
      source_registration_id: registration.id,
      status: 'active',
    });
  }
}

export async function markCurlingRegistrationPaymentCancelled(registrationId: number, actor: Member): Promise<void> {
  await requireRegistrationAccess(registrationId, actor);
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.registrationInvoices)
    .set({ status: 'failed', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(schema.registrationInvoices.registration_id, registrationId));
  await db
    .update(schema.curlingRegistrations)
    .set({ status: 'awaiting_payment', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(schema.curlingRegistrations.id, registrationId));
}
