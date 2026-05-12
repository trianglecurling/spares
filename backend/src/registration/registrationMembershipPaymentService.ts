import { and, asc, desc, eq, sql } from 'drizzle-orm';
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
import { effectiveLeagueRegistrationFeeMinor } from './registrationConfigValidation.js';
import type { RegistrationFeeLineItem, RegistrationFeePreview } from './registrationFeeCalculator.js';
import { evaluateWaitlistCleanup } from './registrationLeagueSelections.js';
import type { RegistrationPaymentDecision } from './registrationPaymentDecision.js';
import type { LeagueConfig, RegistrationContext, RegistrationSelectionInput } from './registrationContext.js';
import { canViewOrEditRegistration, getEffectiveRegistrationWindow, getRegistrationById, getRegistrationShellPayload } from './registrationShellService.js';
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

export type RegistrationPaymentStatusPayload = {
  registrationId: number | null;
  paymentStatus: 'confirming' | 'confirmed' | 'failed' | 'deferred' | 'no_payment_due' | 'unknown';
  registrationStatus: string | null;
  invoiceStatus: string | null;
  paymentOrderStatus: string | null;
  totalDueMinor: number | null;
};

export function resolveRegistrationPaymentStatus(input: {
  invoiceStatus: string | null;
  registrationStatus: string | null;
  paymentOrderStatus: string | null;
  totalDueMinor: number | null;
}): RegistrationPaymentStatusPayload['paymentStatus'] {
  if (input.invoiceStatus === 'paid' || input.registrationStatus === 'confirmed') return 'confirmed';
  if (input.invoiceStatus === 'failed' || input.paymentOrderStatus === 'failed') return 'failed';
  if (input.invoiceStatus === 'deferred') return 'deferred';
  if (input.totalDueMinor === 0) return 'no_payment_due';
  return 'confirming';
}

function normalizeDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === null || value === undefined) return '';
  const raw = String(value);
  return raw.includes('T') ? raw.slice(0, 10) : raw;
}

function mapLeagueConfig(
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
  },
  defaultLeagueFeeMinor: number
): LeagueConfig {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    leagueType: row.league_type,
    capacityType: row.capacity_type,
    capacityValue: row.capacity_value,
    registrationFeeMinor: effectiveLeagueRegistrationFeeMinor(row.registration_fee_override_minor, defaultLeagueFeeMinor),
    requiresClubMembership: row.requires_club_membership === 1,
    format: row.format,
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

function textJsonValue(value: unknown): string {
  return JSON.stringify(value);
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

async function loadLeaguesForSession(sessionId: number, defaultLeagueFeeMinor: number): Promise<Record<number, LeagueConfig>> {
  const { db, schema } = getDrizzleDb();
  const rows = await db.select().from(schema.leagues).where(eq(schema.leagues.session_id, sessionId));
  return Object.fromEntries(rows.map((row) => [row.id, mapLeagueConfig(row, defaultLeagueFeeMinor)]));
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
      defaultLeagueFeeMinor: price?.default_league_fee_minor ?? 0,
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
  const defaultLeagueFeeMinor = settings.priceConfig.defaultLeagueFeeMinor;
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
        loadLeaguesForSession(registration.session_id, defaultLeagueFeeMinor),
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

async function assertShellStillComplete(registrationId: number): Promise<void> {
  const payload = await getRegistrationShellPayload(registrationId);
  if (!payload) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration draft not found.' });
  }
  const { registration, curler, policiesComplete, isMinor } = payload;
  const details: Record<string, string> = {};
  if (!registration.submitted_by_member_id) details.submitter = 'The submitting user is required.';
  if (!registration.curler_member_id) details.curler = 'The curler is required.';
  if (!policiesComplete) details.policies = 'All required policies must be accepted.';
  if (
    !curler?.firstName ||
    !curler.lastName ||
    !curler.dateOfBirth ||
    !curler.email ||
    !curler.phone ||
    !curler.mailingAddress ||
    !curler.emergencyContactName ||
    !curler.emergencyContactPhone
  ) {
    details.demographics = 'Required curler demographic information is incomplete.';
  }
  if (isMinor && (!registration.guardian_first_name || !registration.guardian_last_name || !registration.guardian_email || !registration.guardian_phone)) {
    details.guardian = 'Parent/guardian information is required for minors.';
  }
  if (Object.keys(details).length > 0) {
    throw new RegistrationMembershipPaymentValidationError(details);
  }
}

function collectDecisionErrors(
  keyPrefix: string,
  errors: Array<{ code: string; message: string }>,
  details: Record<string, string>
): void {
  for (const [index, error] of errors.entries()) {
    details[`${keyPrefix}.${index}.${error.code}`] = error.message;
  }
}

function assertReadyToSubmit(
  registration: { status: string },
  context: RegistrationContext,
  evaluation: ReturnType<typeof evaluateRegistrationDraft>
): void {
  if (
    registration.status !== 'shell_complete' &&
    registration.status !== 'submitted' &&
    registration.status !== 'awaiting_payment' &&
    registration.status !== 'awaiting_placement' &&
    registration.status !== 'awaiting_staff_review' &&
    registration.status !== 'payment_started' &&
    registration.status !== 'confirmed'
  ) {
    throw new RegistrationMembershipPaymentValidationError({ registration: 'Registration is not ready to submit.' });
  }
  if (registration.status === 'confirmed') {
    return;
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
  const details: Record<string, string> = {};
  if (evaluation.feePreview.blockingErrors.length > 0) {
    collectDecisionErrors('fees', evaluation.feePreview.blockingErrors, details);
  }
  if (evaluation.selectionValidation.blockingErrors.length > 0) {
    collectDecisionErrors('selection', evaluation.selectionValidation.blockingErrors, details);
  }
  const waitlistCleanup = evaluateWaitlistCleanup(context);
  if (waitlistCleanup.blockingErrors.length > 0) {
    collectDecisionErrors('waitlistCleanup', waitlistCleanup.blockingErrors, details);
  }
  if (Object.keys(details).length > 0) {
    throw new RegistrationMembershipPaymentValidationError(details);
  }
  if (context.membershipOption === 'social' || context.membershipOption === 'junior_recreational') return;
  if (!context.experience.type) {
    throw new RegistrationMembershipPaymentValidationError({ experience: 'Curling experience is required.' });
  }
  if (context.experience.type === 'specified_years' && (context.experience.selfReportedYears ?? -1) < 0) {
    throw new RegistrationMembershipPaymentValidationError({ experienceSelfReportedYears: 'Experience must be a non-negative number.' });
  }
}

async function createInvoiceSnapshot(input: {
  registrationId: number;
  payerMemberId: number;
  feePreview: RegistrationFeePreview;
  paymentDecision: RegistrationPaymentDecision;
  tx?: any;
  existingInvoiceId?: number | null;
}): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const status =
    input.paymentDecision.outcome === 'deferred_payment'
      ? 'deferred'
      : input.paymentDecision.outcome === 'immediate_payment'
        ? 'awaiting_payment'
        : 'paid';
  const invoiceValues = {
    registration_id: input.registrationId,
    payer_member_id: input.payerMemberId,
    status,
    subtotal_minor: input.feePreview.subtotalMinor,
    discount_minor: input.feePreview.discountTotalMinor,
    total_minor: input.feePreview.totalDueMinor,
    currency: 'usd',
    deferred: input.paymentDecision.outcome === 'deferred_payment' ? 1 : 0,
    deferred_reason: input.paymentDecision.deferralReasons.join(',') || null,
    updated_at: sql`CURRENT_TIMESTAMP`,
  };

  const invoiceId = input.existingInvoiceId ?? null;
  const invoice = invoiceId
    ? (
        await executor
          .update(schema.registrationInvoices)
          .set(invoiceValues)
          .where(eq(schema.registrationInvoices.id, invoiceId))
          .returning({ id: schema.registrationInvoices.id })
      )[0]
    : (
        await executor
          .insert(schema.registrationInvoices)
          .values(invoiceValues)
          .returning({ id: schema.registrationInvoices.id })
      )[0];

  const lineItems = [...input.feePreview.lineItems, ...input.feePreview.discountLineItems];
  await executor.delete(schema.registrationInvoiceLineItems).where(eq(schema.registrationInvoiceLineItems.invoice_id, invoice.id));
  if (lineItems.length > 0) {
    await executor.insert(schema.registrationInvoiceLineItems).values(
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

async function loadLatestRegistrationInvoice(registrationId: number) {
  const { db, schema } = getDrizzleDb();
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.registration_id, registrationId))
    .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
    .limit(1);
  return invoice ?? null;
}

function waitlistPositionSortKey(registrationId: number, leagueId: number): string {
  return `${Date.now().toString().padStart(13, '0')}:${registrationId}:${leagueId}`;
}

function isFutureTimestamp(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return true;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function waitlistReason(selectionType: RegistrationSelectionInput['selectionType']): string {
  return selectionType === 'waitlist_replace' ? 'WAITLIST_REPLACE_CREATED' : 'WAITLIST_ADD_CREATED';
}

async function persistRegistrationWaitlists(input: {
  tx: any;
  registrationId: number;
  actorMemberId: number;
  curlerMemberId: number;
  selections: RegistrationSelectionInput[];
}): Promise<void> {
  const { schema } = getDrizzleDb();
  const waitlistSelections = input.selections.filter(
    (selection) => selection.selectionType === 'waitlist_add' || selection.selectionType === 'waitlist_replace'
  );
  for (const selection of waitlistSelections) {
    if (!selection.leagueId) continue;
    const [existing] = await input.tx
      .select()
      .from(schema.waitlistEntries)
      .where(
        and(
          eq(schema.waitlistEntries.member_id, input.curlerMemberId),
          eq(schema.waitlistEntries.league_id, selection.leagueId),
          eq(schema.waitlistEntries.status, 'active')
        )
      )
      .limit(1);

    const nextEntry = {
      member_id: input.curlerMemberId,
      league_id: selection.leagueId,
      source_registration_id: input.registrationId,
      entry_type: selection.selectionType === 'waitlist_replace' ? 'replace' : 'add',
      replaces_league_id: selection.selectionType === 'waitlist_replace' ? selection.replacesLeagueId ?? null : null,
      status: 'active',
      updated_at: sql`CURRENT_TIMESTAMP`,
    };

    let entryId: number;
    let before: unknown = null;
    let after: unknown = nextEntry;
    let action: 'entry_created' | 'replacement_league_changed' | 'entry_converted_add_to_replace' | 'entry_converted_replace_to_add' = 'entry_created';
    if (existing) {
      entryId = existing.id;
      before = {
        entryType: existing.entry_type,
        replacesLeagueId: existing.replaces_league_id,
        sourceRegistrationId: existing.source_registration_id,
        status: existing.status,
      };
      const entryTypeChanged = existing.entry_type !== nextEntry.entry_type;
      const replacementChanged = existing.replaces_league_id !== nextEntry.replaces_league_id;
      const sourceChanged = existing.source_registration_id !== input.registrationId;
      if (!entryTypeChanged && !replacementChanged && !sourceChanged) continue;
      action = entryTypeChanged
        ? nextEntry.entry_type === 'replace'
          ? 'entry_converted_add_to_replace'
          : 'entry_converted_replace_to_add'
        : 'replacement_league_changed';
      await input.tx.update(schema.waitlistEntries).set(nextEntry).where(eq(schema.waitlistEntries.id, entryId));
    } else {
      const joinedAt = new Date();
      const [inserted] = await input.tx
        .insert(schema.waitlistEntries)
        .values({
          ...nextEntry,
          position_sort_key: waitlistPositionSortKey(input.registrationId, selection.leagueId),
          joined_at: dbValue(joinedAt),
        })
        .returning({ id: schema.waitlistEntries.id });
      entryId = inserted.id;
      after = { ...nextEntry, id: entryId };
    }

    await input.tx.insert(schema.waitlistAuditEvents).values({
      waitlist_entry_id: entryId,
      league_id: selection.leagueId,
      member_id: input.curlerMemberId,
      actor_member_id: input.actorMemberId,
      source: 'registration_submission',
      action,
      reason: existing ? 'WAITLIST_ENTRY_UPDATED_FROM_REGISTRATION' : waitlistReason(selection.selectionType),
      before_json: before ? textJsonValue(before) : null,
      after_json: textJsonValue(after),
      metadata_json: textJsonValue({ sourceRegistrationId: input.registrationId, reason: 'REGISTRATION_SUBMITTED' }),
      created_at: dbValue(new Date()),
    });
  }
}

function sabbaticalFeeForLeague(feePreview: RegistrationFeePreview, leagueId: number): number {
  return feePreview.lineItems.find((item) => item.lineType === 'sabbatical_fee' && item.relatedLeagueId === leagueId)?.amountMinor ?? 0;
}

async function persistRegistrationSabbaticals(input: {
  tx: any;
  registrationId: number;
  curlerMemberId: number;
  context: RegistrationContext;
  feePreview: RegistrationFeePreview;
}): Promise<void> {
  const { schema } = getDrizzleDb();
  const sabbaticalSelections = input.context.selections.filter(
    (selection) => selection.selectionType === 'sabbatical' && selection.leagueId
  );
  for (const selection of sabbaticalSelections) {
    const leagueId = selection.leagueId!;
    const league = input.context.leagues[leagueId];
    if (!league) continue;
    const startDate = league.firstDayOfPlay ?? league.startDate;
    const endDate = league.lastDayOfPlay ?? league.endDate;
    const [existing] = await input.tx
      .select()
      .from(schema.curlingLeagueSabbaticals)
      .where(
        and(
          eq(schema.curlingLeagueSabbaticals.member_id, input.curlerMemberId),
          eq(schema.curlingLeagueSabbaticals.current_league_id, leagueId),
          eq(schema.curlingLeagueSabbaticals.source_registration_id, input.registrationId)
        )
      )
      .limit(1);
    const sabbaticalId = existing?.id ?? (
      await input.tx
        .insert(schema.curlingLeagueSabbaticals)
        .values({
          member_id: input.curlerMemberId,
          lineage_key: `${input.curlerMemberId}:${leagueId}`,
          original_league_id: leagueId,
          current_league_id: leagueId,
          source_registration_id: input.registrationId,
          first_sabbatical_league_id: leagueId,
          first_sabbatical_start_date: dbValue(startDate),
          status: 'active',
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .returning({ id: schema.curlingLeagueSabbaticals.id })
    )[0].id;

    const [existingSession] = await input.tx
      .select({ id: schema.curlingSabbaticalSessions.id })
      .from(schema.curlingSabbaticalSessions)
      .where(
        and(
          eq(schema.curlingSabbaticalSessions.sabbatical_id, sabbaticalId),
          eq(schema.curlingSabbaticalSessions.registration_id, input.registrationId),
          eq(schema.curlingSabbaticalSessions.league_id, leagueId)
        )
      )
      .limit(1);
    const sessionValues = {
      sabbatical_id: sabbaticalId,
      league_id: leagueId,
      registration_id: input.registrationId,
      fee_amount_minor: sabbaticalFeeForLeague(input.feePreview, leagueId),
      payment_status: 'unpaid',
      starts_at: dbValue(startDate),
      ends_at: dbValue(endDate),
      updated_at: sql`CURRENT_TIMESTAMP`,
    };
    if (existingSession) {
      await input.tx
        .update(schema.curlingSabbaticalSessions)
        .set(sessionValues)
        .where(eq(schema.curlingSabbaticalSessions.id, existingSession.id));
    } else {
      await input.tx.insert(schema.curlingSabbaticalSessions).values(sessionValues);
    }

    await input.tx
      .update(schema.registrationSelections)
      .set({
        related_sabbatical_id: sabbaticalId,
        status: 'confirmed',
        fee_amount_minor_snapshot: sabbaticalFeeForLeague(input.feePreview, leagueId),
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(schema.registrationSelections.registration_id, input.registrationId),
          eq(schema.registrationSelections.league_id, leagueId),
          eq(schema.registrationSelections.selection_type, 'sabbatical')
        )
      );
  }
}

async function setSubmittedSelectionStatuses(tx: any, registrationId: number): Promise<void> {
  const { schema } = getDrizzleDb();
  await tx
    .update(schema.registrationSelections)
    .set({ status: 'confirmed', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(schema.registrationSelections.registration_id, registrationId),
        sql`${schema.registrationSelections.selection_type} IN ('guaranteed_return', 'byot_request', 'spare_only', 'junior_recreational')`
      )
    );
  await tx
    .update(schema.registrationSelections)
    .set({ status: 'pending', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(schema.registrationSelections.registration_id, registrationId),
        sql`${schema.registrationSelections.selection_type} IN ('return_subject_to_availability', 'third_league_interest')`
      )
    );
  await tx
    .update(schema.registrationSelections)
    .set({ status: 'waitlisted', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(schema.registrationSelections.registration_id, registrationId),
        sql`${schema.registrationSelections.selection_type} IN ('waitlist_add', 'waitlist_replace')`
      )
    );
}

export async function submitRegistrationMembershipPayment(input: SubmitRegistrationInput): Promise<SubmitRegistrationResult> {
  await requireRegistrationAccess(input.registrationId, input.actor);
  const registration = await loadFullRegistration(input.registrationId);
  await assertShellStillComplete(input.registrationId);
  const context = await buildRegistrationContextForDraft(input.registrationId);
  const evaluation = evaluateRegistrationDraft(context);
  assertReadyToSubmit(registration, context, evaluation);

  const payerMemberId = registration.submitted_by_member_id ?? input.actor.id;
  const { db, schema } = getDrizzleDb();
  const existingInvoice = await loadLatestRegistrationInvoice(input.registrationId);
  if (
    evaluation.paymentDecision.outcome === 'immediate_payment' &&
    existingInvoice?.payment_order_id &&
    existingInvoice.status === 'checkout_started'
  ) {
    const existingOrder = await createPaymentService().getPaymentOrderById(existingInvoice.payment_order_id);
    const hostedCheckoutUrl = typeof existingOrder?.metadata.hostedCheckoutUrl === 'string' ? existingOrder.metadata.hostedCheckoutUrl : null;
    if (
      existingOrder &&
      existingOrder.status === 'pending' &&
      hostedCheckoutUrl &&
      isFutureTimestamp(existingOrder.metadata.hostedCheckoutExpiresAt)
    ) {
      return {
        outcome: 'immediate_payment',
        registrationId: input.registrationId,
        invoiceId: existingInvoice.id,
        checkoutUrl: hostedCheckoutUrl,
        orderToken: existingOrder.orderToken,
        totalDueMinor: existingInvoice.total_minor,
      };
    }
  }
  if (existingInvoice?.status === 'paid' && registration.status === 'confirmed') {
    return {
      outcome: evaluation.paymentDecision.outcome,
      registrationId: input.registrationId,
      invoiceId: existingInvoice.id,
      totalDueMinor: existingInvoice.total_minor,
      deferralReasons: evaluation.paymentDecision.deferralReasons,
    } as SubmitRegistrationResult;
  }

  const reusableInvoiceId =
    existingInvoice && !['failed', 'cancelled', 'refunded'].includes(existingInvoice.status) ? existingInvoice.id : null;
  const invoiceId = await db.transaction(async (tx) => {
    if (!registration.curler_member_id) {
      throw new RegistrationMembershipPaymentValidationError({ curler: 'The curler is required.' });
    }
    await persistRegistrationWaitlists({
      tx,
      registrationId: input.registrationId,
      actorMemberId: input.actor.id,
      curlerMemberId: registration.curler_member_id,
      selections: context.selections,
    });
    await persistRegistrationSabbaticals({
      tx,
      registrationId: input.registrationId,
      curlerMemberId: registration.curler_member_id,
      context,
      feePreview: evaluation.feePreview,
    });
    await setSubmittedSelectionStatuses(tx, input.registrationId);
    const snapshotId = await createInvoiceSnapshot({
      registrationId: input.registrationId,
      payerMemberId,
      feePreview: evaluation.feePreview,
      paymentDecision: evaluation.paymentDecision,
      tx,
      existingInvoiceId: reusableInvoiceId,
    });
    const submittedStatus =
      evaluation.paymentDecision.outcome === 'immediate_payment'
        ? 'awaiting_payment'
        : evaluation.paymentDecision.outcome === 'deferred_payment'
          ? evaluation.paymentDecision.requiresStaffReview
            ? 'awaiting_staff_review'
            : 'awaiting_placement'
          : 'confirmed';
    await tx
      .update(schema.curlingRegistrations)
      .set({
        status: submittedStatus,
        submitted_at: dbValue(registration.submitted_at ?? new Date()),
        last_fee_preview_json: dbValue(jsonStorageValue(evaluation.feePreview)),
        payment_decision_json: dbValue(jsonStorageValue(evaluation.paymentDecision)),
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, input.registrationId));
    return snapshotId;
  });

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
          seasonId: registration.season_id,
          sessionId: registration.session_id,
          curlerUserId: registration.curler_member_id,
          curlerMemberId: registration.curler_member_id,
          submittedByUserId: registration.submitted_by_member_id,
          submittedByMemberId: registration.submitted_by_member_id,
        },
      });
      const checkout = await paymentService.createHostedCheckoutForOrder({
        orderId: order.id,
        successUrl: `${frontendBaseUrl()}/registration/success?registration_id=${input.registrationId}&order_token=${order.orderToken}&session_id={CHECKOUT_SESSION_ID}`,
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
      amount_minor: schema.paymentOrders.amount_minor,
      currency: schema.paymentOrders.currency,
    })
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.id, orderId))
    .limit(1);
  if (!order || order.subject_type !== 'curling_registration' || order.status !== 'succeeded' || !order.subject_id) {
    return;
  }
  const registrationId = order.subject_id;

  const [registration] = await db
    .select()
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.id, registrationId))
    .limit(1);
  if (!registration || !registration.curler_member_id) return;
  const curlerMemberId = registration.curler_member_id;
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.payment_order_id, order.id))
    .limit(1);
  if (!invoice) {
    throw new RegistrationMembershipPaymentValidationError({ payment: 'No registration invoice was found for this payment.' });
  }
  if (invoice.total_minor !== order.amount_minor || invoice.currency.toLowerCase() !== order.currency.toLowerCase()) {
    throw new RegistrationMembershipPaymentValidationError({ payment: 'Payment amount did not match the registration invoice.' });
  }
  const [season] = await db
    .select()
    .from(schema.curlingSeasons)
    .where(eq(schema.curlingSeasons.id, registration.season_id))
    .limit(1);
  if (!season) return;

  const paidAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.registrationInvoices)
      .set({
        status: 'paid',
        paid_at: dbValue(paidAt),
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.registrationInvoices.payment_order_id, order.id));
    await tx
      .update(schema.curlingRegistrations)
      .set({
        status: 'confirmed',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, registrationId));
    await tx
      .update(schema.registrationSelections)
      .set({
        status: 'confirmed',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(schema.registrationSelections.registration_id, registrationId),
          sql`${schema.registrationSelections.selection_type} IN ('guaranteed_return', 'byot_request', 'sabbatical', 'spare_only', 'junior_recreational')`
        )
      );
    await tx
      .update(schema.curlingSabbaticalSessions)
      .set({ payment_status: 'paid', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.curlingSabbaticalSessions.registration_id, registration.id));

    const [existingMembership] = await tx
      .select({ id: schema.seasonMemberships.id })
      .from(schema.seasonMemberships)
      .where(eq(schema.seasonMemberships.source_registration_id, registration.id))
      .limit(1);
    if (!existingMembership && registration.membership_option !== 'none') {
      const membershipType = registration.membership_option === 'social' ? 'social' : 'regular';
      await tx.insert(schema.seasonMemberships).values({
        member_id: curlerMemberId,
        season_id: registration.season_id,
        membership_type: membershipType,
        starts_at: dbValue(normalizeDate(season.start_date)),
        ends_at: dbValue(normalizeDate(season.end_date)),
        source_registration_id: registration.id,
        payment_order_id: order.id,
        status: 'active',
      } as any);
    }

    if (registration.membership_option === 'regular_spare_only') {
      const [existingPrivilege] = await tx
        .select({ id: schema.curlingIcePrivileges.id })
        .from(schema.curlingIcePrivileges)
        .where(eq(schema.curlingIcePrivileges.source_registration_id, registration.id))
        .limit(1);
      if (!existingPrivilege) {
        await tx.insert(schema.curlingIcePrivileges).values({
          member_id: curlerMemberId,
          season_id: registration.season_id,
          session_id: registration.session_id,
          source_type: 'spare_only',
          source_registration_id: registration.id,
          status: 'active',
        } as any);
      }
    }
  });
}

export async function markCurlingRegistrationPaymentFailedForOrder(orderId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.payment_order_id, orderId))
    .limit(1);
  if (!invoice) return;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.registrationInvoices)
      .set({ status: 'failed', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.registrationInvoices.id, invoice.id));
    await tx
      .update(schema.curlingRegistrations)
      .set({ status: 'awaiting_payment', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.curlingRegistrations.id, invoice.registration_id));
  });
}

export async function getRegistrationPaymentStatusByOrderToken(orderToken: string): Promise<RegistrationPaymentStatusPayload> {
  const order = await createPaymentService().getPaymentOrderByToken(orderToken);
  if (!order || order.subjectType !== 'curling_registration') {
    return {
      registrationId: null,
      paymentStatus: 'unknown',
      registrationStatus: null,
      invoiceStatus: null,
      paymentOrderStatus: null,
      totalDueMinor: null,
    };
  }
  const { db, schema } = getDrizzleDb();
  const [invoice] = await db
    .select()
    .from(schema.registrationInvoices)
    .where(eq(schema.registrationInvoices.payment_order_id, order.id))
    .limit(1);
  const registrationId = order.subjectId ?? invoice?.registration_id ?? null;
  const [registration] = registrationId
    ? await db.select().from(schema.curlingRegistrations).where(eq(schema.curlingRegistrations.id, registrationId)).limit(1)
    : [];
  const paymentStatus = resolveRegistrationPaymentStatus({
    invoiceStatus: invoice?.status ?? null,
    registrationStatus: registration?.status ?? null,
    paymentOrderStatus: order.status,
    totalDueMinor: invoice?.total_minor ?? order.amountMinor ?? null,
  });
  return {
    registrationId,
    paymentStatus,
    registrationStatus: registration?.status ?? null,
    invoiceStatus: invoice?.status ?? null,
    paymentOrderStatus: order.status,
    totalDueMinor: invoice?.total_minor ?? order.amountMinor ?? null,
  };
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
