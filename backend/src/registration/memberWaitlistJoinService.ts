import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { RegistrationMemberValidationError } from './registrationMemberService.js';
import { effectiveExperienceYears } from './registrationAgeExperience.js';
import { defaultSabbaticalDurationLimitYears } from './sabbaticalDurationLimit.js';
import { leagueMinimumExperienceConstraint } from './leagueEligibilityConstraints.js';
import { memberExperienceBaselinesFromRow } from './curlingExperienceYears.js';
import { blockingError, type DecisionMessage } from './registrationDecisionTypes.js';
import { validateWaitlistEligibility } from './registrationEligibility.js';
import {
  isActiveWaitlistEntry,
  type ExistingWaitlistEntry,
  type LeagueConfig,
  type RegistrationContext,
} from './registrationContext.js';
import { getEffectiveRegistrationWindow } from './registrationShellService.js';
import { getActiveWaitlistEntryPosition, resolvePlacementLeagueForWaitlist } from './waitlistEntityService.js';
import { addWaitlistEntry, WaitlistStaffValidationError } from './waitlistStaffService.js';
import {
  findActiveWaitlistEntryForMemberOnWaitlist,
  loadExistingWaitlistEntriesForMember,
} from './waitlistMemberMembership.js';

type MemberLeagueHold = {
  leagueId: number;
  leagueName: string;
  format: LeagueConfig['format'];
  isPlayInBased: boolean;
};

const EXPERIENCE_DEFERRAL_WINDOW_YEARS = 2;

function experienceYearsLabel(years: number): string {
  return years === 1 ? '1 year' : `${years} years`;
}

export function memberWaitlistExperienceEvaluation(
  context: RegistrationContext,
  league: LeagueConfig,
): { blockingExperienceErrors: DecisionMessage[]; experienceWarning: string | null } {
  const requiredExperience = leagueMinimumExperienceConstraint(league.minExperienceYears);
  if (requiredExperience == null) {
    return { blockingExperienceErrors: [], experienceWarning: null };
  }

  const experienceYears = effectiveExperienceYears(context);
  if (experienceYears >= requiredExperience) {
    return { blockingExperienceErrors: [], experienceWarning: null };
  }

  const yearsShort = requiredExperience - experienceYears;
  if (yearsShort <= EXPERIENCE_DEFERRAL_WINDOW_YEARS) {
    return {
      blockingExperienceErrors: [],
      experienceWarning: `This league requires ${experienceYearsLabel(requiredExperience)} of experience. In order to be accepted from this waitlist, you must satisfy this requirement by the time your entry is available.`,
    };
  }

  return {
    blockingExperienceErrors: [
      blockingError('insufficient_experience', `League requires ${requiredExperience} years of experience.`),
    ],
    experienceWarning: null,
  };
}

function uniqueMessages(messages: string[]): string[] {
  return [...new Set(messages)];
}

const SUBMITTED_REGISTRATION_STATUSES = [
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
  'paid',
  'confirmed',
] as const;

/** Registration selections that commit the member to a league roster for the session. */
function expectedByotRosterSize(format: LeagueConfig['format']): number | null {
  if (format === 'teams') return 4;
  if (format === 'doubles') return 2;
  return null;
}

function mapLeagueRowToConfig(
  row: {
    id: number;
    session_id: number | null;
    name: string;
    day_of_week: number;
    league_type: 'standard' | 'bring_your_own_team';
    capacity_type: 'individual' | 'team';
    capacity_value: number;
    registration_fee_minor: number;
    registration_fee_override_minor?: number | null;
    requires_club_membership: number;
    format: LeagueConfig['format'];
    min_experience_years: number | null;
    max_experience_years?: number | null;
    min_age: number | null;
    max_age: number | null;
    start_date: unknown;
    end_date: unknown;
    first_day_of_play: unknown;
    last_day_of_play: unknown;
    allows_waitlist: number;
    waitlist_id: number | null;
    is_play_in_based?: number;
    is_junior_recreational?: number;
    allows_sabbatical: number;
    predecessor_league_id: number | null;
    successor_league_id: number | null;
  },
  defaultLeagueFeeMinor: number,
): LeagueConfig {
  const feeMinor =
    row.registration_fee_override_minor != null ? row.registration_fee_override_minor : defaultLeagueFeeMinor;
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    dayOfWeek: row.day_of_week,
    leagueType: row.league_type,
    capacityType: row.capacity_type,
    capacityValue: row.capacity_value,
    registrationFeeMinor: feeMinor,
    requiresClubMembership: row.requires_club_membership === 1,
    format: row.format,
    minExperienceYears: row.min_experience_years,
    maxExperienceYears: row.max_experience_years ?? null,
    minAge: row.min_age,
    maxAge: row.max_age,
    startDate: row.start_date ? String(row.start_date).slice(0, 10) : null,
    endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
    firstDayOfPlay: row.first_day_of_play ? String(row.first_day_of_play).slice(0, 10) : null,
    lastDayOfPlay: row.last_day_of_play ? String(row.last_day_of_play).slice(0, 10) : null,
    allowsWaitlist: row.waitlist_id != null,
    waitlistId: row.waitlist_id,
    isPlayInBased: row.is_play_in_based === 1,
    isJuniorRecreational: row.is_junior_recreational === 1,
    allowsSabbatical: row.allows_sabbatical === 1,
    predecessorLeagueId: row.predecessor_league_id,
    successorLeagueId: row.successor_league_id,
  };
}

async function loadSubmittedRegistration(memberId: number, sessionId: number) {
  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select({
      id: schema.curlingRegistrations.id,
      membershipOption: schema.curlingRegistrations.membership_option,
      experienceType: schema.curlingRegistrations.experience_type,
      experienceSelfReportedYears: schema.curlingRegistrations.experience_self_reported_years,
    })
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.curler_member_id, memberId),
        eq(schema.curlingRegistrations.session_id, sessionId),
        sql`${schema.curlingRegistrations.submitted_at} IS NOT NULL`,
        inArray(schema.curlingRegistrations.status, [...SUBMITTED_REGISTRATION_STATUSES]),
      ),
    )
    .orderBy(desc(schema.curlingRegistrations.updated_at), desc(schema.curlingRegistrations.id))
    .limit(1);
  return registration ?? null;
}

async function loadImmediatelyPriorSessionId(currentSessionId: number): Promise<number | null> {
  const { db, schema } = getDrizzleDb();
  const [currentSession] = await db
    .select({ startDate: schema.curlingSessions.start_date })
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.id, currentSessionId))
    .limit(1);
  if (!currentSession) return null;

  const [priorSession] = await db
    .select({ id: schema.curlingSessions.id })
    .from(schema.curlingSessions)
    .where(lt(schema.curlingSessions.start_date, currentSession.startDate))
    .orderBy(desc(schema.curlingSessions.start_date))
    .limit(1);

  return priorSession?.id ?? null;
}

async function loadPriorSessionLeagueHoldsForCurrentSession(
  memberId: number,
  currentSessionId: number,
): Promise<MemberLeagueHold[]> {
  const priorSessionId = await loadImmediatelyPriorSessionId(currentSessionId);
  if (priorSessionId == null) return [];

  const priorRosterHolds = await loadLeagueHoldsFromRoster(memberId, priorSessionId);
  if (priorRosterHolds.length === 0) return [];

  const { db, schema } = getDrizzleDb();
  const currentLeagues = await db
    .select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      format: schema.leagues.format,
      predecessorLeagueId: schema.leagues.predecessor_league_id,
      isPlayInBased: schema.leagues.is_play_in_based,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.session_id, currentSessionId));
  const currentLeagueById = new Map(currentLeagues.map((league) => [league.id, league] as const));

  const mapped: MemberLeagueHold[] = [];
  for (const hold of priorRosterHolds) {
    const currentLeagueId = currentLeagues.find((league) => league.predecessorLeagueId === hold.leagueId)?.id ?? null;
    if (currentLeagueId == null) continue;
    const currentLeague = currentLeagueById.get(currentLeagueId);
    if (!currentLeague) continue;
    mapped.push({
      leagueId: currentLeague.id,
      leagueName: currentLeague.name,
      format: currentLeague.format,
      isPlayInBased: currentLeague.isPlayInBased === 1,
    });
  }

  return mapped;
}

async function loadLeagueHoldsFromRoster(memberId: number, sessionId: number): Promise<MemberLeagueHold[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.leagueRoster.league_id,
      leagueName: schema.leagues.name,
      format: schema.leagues.format,
      isPlayInBased: schema.leagues.is_play_in_based,
    })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .where(
      and(
        eq(schema.leagueRoster.member_id, memberId),
        eq(schema.leagueRoster.status, 'active'),
        eq(schema.leagues.session_id, sessionId),
      ),
    );
  return rows.map((row) => ({
    leagueId: row.leagueId,
    leagueName: row.leagueName,
    format: row.format,
    isPlayInBased: row.isPlayInBased === 1,
  }));
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
    .where(eq(schema.leagueRoster.member_id, memberId));
  return rows.map((row) => ({
    leagueId: row.leagueId,
    seasonKey: row.seasonKey,
  }));
}

async function loadRegistrationSettings() {
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

async function buildMemberWaitlistContext(input: {
  member: Member;
  sessionId: number;
  placementLeague: LeagueConfig;
  leagueHolds: MemberLeagueHold[];
  existingWaitlistEntries: ExistingWaitlistEntry[];
  registration: {
    membershipOption: RegistrationContext['membershipOption'];
    experienceType: RegistrationContext['experience']['type'] | null;
    experienceSelfReportedYears: number | null;
  } | null;
}): Promise<RegistrationContext> {
  const { db, schema } = getDrizzleDb();
  const [session] = await db
    .select()
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.id, input.sessionId))
    .limit(1);
  if (!session) {
    throw new RegistrationMemberValidationError({ session: 'Session was not found.' });
  }
  const effectiveWindow = await getEffectiveRegistrationWindow(session.season_id, input.sessionId);
  if (!effectiveWindow) {
    throw new RegistrationMemberValidationError({ session: 'Registration window was not found.' });
  }
  const settings = await loadRegistrationSettings();
  const completedSessions = await loadCompletedSessions(input.member.id);
  const experienceBaselines = memberExperienceBaselinesFromRow(input.member);
  const hasBaselineExperience =
    experienceBaselines.baselineOtherClubExperienceYears > 0 || experienceBaselines.baselineClubExperienceYears > 0;
  const useKnownExperience =
    input.registration?.experienceType === null && (completedSessions.length > 0 || hasBaselineExperience);
  const experienceType =
    input.registration?.experienceType ??
    (useKnownExperience ? 'known_existing' : completedSessions.length > 0 ? 'known_existing' : 'none_or_minimal');
  const activeLeagueIds = input.leagueHolds.map((hold) => hold.leagueId);

  return {
    season: {
      id: effectiveWindow.season.id,
      name: effectiveWindow.season.name ?? '',
      startDate: effectiveWindow.season.startDate ?? '',
      endDate: effectiveWindow.season.endDate ?? '',
    },
    session: {
      id: effectiveWindow.session.id,
      seasonId: effectiveWindow.session.seasonId,
      name: effectiveWindow.session.name ?? '',
      startDate: effectiveWindow.session.startDate ?? '',
      endDate: effectiveWindow.session.endDate ?? '',
    },
    registrationState: 'open',
    isFirstSessionOfSeason: false,
    registrant: {
      memberId: input.member.id,
      hasUserAccount: true,
      isReturningMember: completedSessions.length > 0,
      dateOfBirth: input.member.date_of_birth ? String(input.member.date_of_birth).slice(0, 10) : null,
    },
    membershipOption: input.registration?.membershipOption ?? 'regular',
    experience: {
      type: experienceType,
      selfReportedYears: input.registration?.experienceSelfReportedYears ?? null,
      baselineOtherClubExperienceYears: experienceBaselines.baselineOtherClubExperienceYears,
      baselineClubExperienceYears: experienceBaselines.baselineClubExperienceYears,
      completedSessions,
    },
    activeLeagueIds,
    participatedLeagueIds: activeLeagueIds,
    existingSabbaticals: [],
    existingWaitlistEntries: input.existingWaitlistEntries,
    leagues: { [input.placementLeague.id]: input.placementLeague },
    selections: [],
    priorities: [],
    discountClaims: {},
    ...settings,
    sabbaticalDurationLimitYears: defaultSabbaticalDurationLimitYears(),
  };
}

export async function getTeamMemberPlacementOptions(sessionId: number, memberIds: number[]) {
  const { db, schema } = getDrizzleDb();
  const uniqueMemberIds = [...new Set(memberIds)];
  if (uniqueMemberIds.length === 0) return {};

  const memberRows = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      email: schema.members.email,
    })
    .from(schema.members)
    .where(inArray(schema.members.id, uniqueMemberIds));

  const result: Record<
    number,
    {
      memberId: number;
      memberName: string;
      currentLeagueCount: number;
      alreadyOnWaitlistCount: number;
    }
  > = {};

  for (const memberRow of memberRows) {
    const memberName =
      [memberRow.firstName, memberRow.lastName].map((part) => part?.trim()).filter(Boolean).join(' ') ||
      memberRow.name?.trim() ||
      memberRow.email?.trim() ||
      `Member #${memberRow.id}`;
    const { holds } = await resolveMemberLeagueHolds(memberRow.id, sessionId);
    const existingWaitlistEntries = await loadExistingWaitlistEntriesForMember(memberRow.id, sessionId);
    result[memberRow.id] = {
      memberId: memberRow.id,
      memberName,
      currentLeagueCount: holds.length,
      alreadyOnWaitlistCount: existingWaitlistEntries.filter((entry) => isActiveWaitlistEntry(entry)).length,
    };
  }

  return result;
}

function mergeMemberLeagueHolds(holds: MemberLeagueHold[]): MemberLeagueHold[] {
  const holdsByLeagueId = new Map<number, MemberLeagueHold>();
  for (const hold of holds) {
    holdsByLeagueId.set(hold.leagueId, hold);
  }
  return [...holdsByLeagueId.values()];
}

async function resolveMemberLeagueHolds(memberId: number, sessionId: number) {
  const submittedRegistration = await loadSubmittedRegistration(memberId, sessionId);
  const rosterHolds = await loadLeagueHoldsFromRoster(memberId, sessionId);
  // Guaranteed priority entries are already written to league_roster at submit,
  // so a submitted registration adds nothing beyond the roster.
  const priorSessionHolds = submittedRegistration
    ? []
    : await loadPriorSessionLeagueHoldsForCurrentSession(memberId, sessionId);
  const holds = mergeMemberLeagueHolds([...rosterHolds, ...priorSessionHolds]);
  return {
    holds,
    usesRegistration: submittedRegistration != null,
    registration: submittedRegistration,
  };
}

async function loadPlacementLeagueForWaitlist(waitlistId: number) {
  const placement = await resolvePlacementLeagueForWaitlist(waitlistId);
  if (!placement?.leagueId) {
    throw new RegistrationMemberValidationError({ waitlistId: 'Waitlist was not found.' });
  }
  const { db, schema } = getDrizzleDb();
  const settings = await loadRegistrationSettings();
  const [leagueRow] = await db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, placement.leagueId))
    .limit(1);
  if (!leagueRow || leagueRow.waitlist_id !== waitlistId || leagueRow.session_id == null) {
    throw new RegistrationMemberValidationError({ waitlistId: 'Waitlist was not found.' });
  }
  return {
    placementLeagueId: placement.leagueId,
    sessionId: leagueRow.session_id,
    league: mapLeagueRowToConfig(leagueRow, settings.priceConfig.defaultLeagueFeeMinor),
    leagueName: placement.leagueName,
  };
}

export async function getWaitlistTeamMemberPlacementOptions(waitlistId: number, memberIds: number[]) {
  const { sessionId } = await loadPlacementLeagueForWaitlist(waitlistId);
  return getTeamMemberPlacementOptions(sessionId, memberIds);
}

export async function getLeagueTeamMemberPlacementOptions(leagueId: number, memberIds: number[]) {
  const { db, schema } = getDrizzleDb();
  const [league] = await db
    .select({ sessionId: schema.leagues.session_id })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);
  if (!league?.sessionId) {
    throw new RegistrationMemberValidationError({ leagueId: 'League session was not found.' });
  }
  return getTeamMemberPlacementOptions(league.sessionId, memberIds);
}

export async function getMemberWaitlistJoinContext(member: Member, waitlistId: number) {
  const { placementLeagueId, sessionId, league } = await loadPlacementLeagueForWaitlist(waitlistId);

  const existingEntry = await findActiveWaitlistEntryForMemberOnWaitlist(member.id, waitlistId);

  const { holds, usesRegistration, registration } = await resolveMemberLeagueHolds(member.id, sessionId);
  const existingWaitlistEntries = await loadExistingWaitlistEntriesForMember(member.id, sessionId);
  const context = await buildMemberWaitlistContext({
    member,
    sessionId,
    placementLeague: league,
    leagueHolds: holds,
    existingWaitlistEntries,
    registration,
  });

  const waitlistEligibility = validateWaitlistEligibility(context, league);
  const experienceEvaluation = memberWaitlistExperienceEvaluation(context, league);
  const blockingErrors = uniqueMessages([
    ...waitlistEligibility.blockingErrors
      .filter((error) => error.code !== 'registration_closed' && error.code !== 'insufficient_experience')
      .map((error) => error.message),
    ...experienceEvaluation.blockingExperienceErrors.map((error) => error.message),
  ]);
  const warnings = experienceEvaluation.experienceWarning ? [experienceEvaluation.experienceWarning] : [];

  const expectedRosterSize = expectedByotRosterSize(league.format);
  const requiresByotRoster = league.leagueType === 'bring_your_own_team';

  return {
    waitlistId,
    placementLeagueId,
    placementLeague: {
      id: league.id,
      name: league.name,
      leagueType: league.leagueType,
      format: league.format,
    },
    alreadyOnWaitlist: Boolean(existingEntry),
    existingEntryId: existingEntry?.id ?? null,
    usesRegistration,
    currentLeagueCount: holds.length,
    requiresByotRoster,
    expectedByotRosterSize: expectedRosterSize,
    blockingErrors,
    warnings,
    canJoin: !existingEntry && blockingErrors.length === 0,
  };
}

export async function joinMemberWaitlist(input: {
  member: Member;
  waitlistId: number;
  teamRosterText?: string | null;
  teamRosterPlacements?: Array<{ memberId: number }> | null;
  notifyJoined?: boolean;
}) {
  const contextPayload = await getMemberWaitlistJoinContext(input.member, input.waitlistId);
  if (contextPayload.alreadyOnWaitlist) {
    throw new RegistrationMemberValidationError({ waitlistEntry: 'You are already on this waitlist.' });
  }
  if (contextPayload.blockingErrors.length > 0) {
    throw new RegistrationMemberValidationError({
      eligibility: contextPayload.blockingErrors.join(' '),
    });
  }
  const hasTeamPlacements = (input.teamRosterPlacements?.length ?? 0) > 0;
  if (contextPayload.requiresByotRoster && !hasTeamPlacements && !input.teamRosterText?.trim()) {
    throw new RegistrationMemberValidationError({
      teamRosterPlacements: 'Provide team roster placement details for each player.',
    });
  }

  let result;
  try {
    result = await addWaitlistEntry({
      leagueId: contextPayload.placementLeagueId,
      memberId: input.member.id,
      teamRosterText: input.teamRosterText,
      teamRosterPlacements: input.teamRosterPlacements,
      actorMemberId: input.member.id,
      reason: 'WAITLIST_ENTRY_CREATED',
      auditSource: 'member_self',
      notifyJoined: input.notifyJoined,
    });
  } catch (error) {
    if (error instanceof WaitlistStaffValidationError) {
      throw new RegistrationMemberValidationError(error.details);
    }
    throw error;
  }

  const { assignTrailingWaitlistPriorityRank } = await import('./memberWaitlistPriority.js');
  await assignTrailingWaitlistPriorityRank(input.member.id, result.entry.id);

  const { position, total } = await getActiveWaitlistEntryPosition(input.waitlistId, result.entry.id);

  return {
    entryId: result.entry.id,
    position,
    queueTotal: total,
  };
}
