import { and, asc, desc, eq, gt, gte, inArray, lte, notInArray } from 'drizzle-orm';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type {
  CurlingLeagueSabbaticalStatusSqlite,
  LeagueEntryTeamStatusSqlite,
} from '../db/drizzle-schema.js';
import { evaluatePlayInLeagueFromDb } from '../registration/playInEntryService.js';
import { ensureRosterPlacementsForUnpaidRegistrations } from '../registration/registrationRosterService.js';
import { waitlistEntryIncludesMember } from '../registration/waitlistMemberMembership.js';
import { normalizeHalfYearExperienceValue } from '../registration/curlingExperienceYears.js';
import { getCurrentDateStringAsync } from '../utils/time.js';

const ACTIVE_SABBATICAL_STATUSES: CurlingLeagueSabbaticalStatusSqlite[] = [
  'active',
  'returning',
  'staff_overridden',
];

/** Entry declarations that still occupy a play-in slot for the member. */
const ACTIVE_ENTRY_TEAM_STATUSES: LeagueEntryTeamStatusSqlite[] = [
  'pending',
  'guaranteed',
  'playdown',
  'entered',
];

const PURCHASED_SEASON_MEMBERSHIP_STATUSES = ['active', 'pending', 'expired'] as const;

/** Submitted registrations that have not yet collected membership payment. */
const UNPAID_MEMBERSHIP_REGISTRATION_STATUSES = [
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
] as const;

/**
 * League selections that should appear on the membership card before payment
 * commits roster rows. Waitlists/sabbaticals/third-league interest are handled
 * elsewhere (or intentionally omitted).
 */
const DASHBOARD_SESSION_CACHE_TTL_MS = 10 * 60 * 1000;

type DashboardSession = {
  id: number;
  seasonId: number;
  seasonStartDate: string;
  name: string;
  endDate: string | null;
  isUpcoming: boolean;
  firstSessionId: number;
} | null;

let dashboardSessionCache: {
  today: string;
  cachedAt: number;
  session: DashboardSession;
} | null = null;

export type MembershipCardStatusKind = 'regular' | 'social' | 'former' | 'non_member' | 'lifetime';

export type MembershipCardLeagueParticipation = 'roster' | 'sabbatical' | 'waitlist' | 'pending';

export type ClubTenureKind = 'new' | 'years';

export type ClubTenure = {
  kind: ClubTenureKind;
  /** Null when `kind` is `new`. Inclusive of the current membership season. */
  years: number | null;
};

type MembershipSeason = {
  seasonId: number;
  startDate: string;
};

/**
 * Play-in entry on the membership card before Grant entry:
 * - guaranteed → treat like roster (no badge)
 * - otherwise → pending (may still need to play in)
 */
export function playInMembershipCardParticipation(
  teamEvaluation: { guaranteed: boolean } | undefined,
): 'roster' | 'pending' | null {
  if (!teamEvaluation) return null;
  return teamEvaluation.guaranteed ? 'roster' : 'pending';
}

export type MemberMembershipCardData = {
  name: string;
  membershipStatus: {
    kind: MembershipCardStatusKind;
    validThrough: string | null;
  };
  icePrivilegesValidThrough: string | null;
  /** True when membership/ice dates reflect an unpaid submitted registration. */
  pendingRegistrationPayment: boolean;
  /** Club membership tenure for the current dashboard session, or null when unknown. */
  clubTenure: ClubTenure | null;
  session: {
    id: number;
    name: string;
    isUpcoming: boolean;
  } | null;
  leagues: Array<{
    leagueId: number;
    leagueName: string;
    participation: MembershipCardLeagueParticipation;
  }>;
};

export type PendingRegistrationMembershipGrant = {
  membershipOption: 'regular' | 'social' | 'regular_spare_only' | 'junior_recreational';
  seasonId: number;
  seasonStartDate: string;
  seasonEndsAt: string;
};

function normalizeDateString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.split('T')[0];
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
}

function dateColumnBindValue(dateString: string): Date | string {
  if (getDatabaseConfig()?.type === 'postgres') {
    return new Date(`${dateString}T00:00:00`);
  }
  return dateString;
}

function isExpiredDate(validThrough: string | null, today: string): boolean {
  if (!validThrough) return false;
  return today > validThrough;
}

export function resolveMembershipCardStatus(input: {
  today: string;
  isLifetimeMember?: boolean;
  latestPurchasedSeasonMembership: {
    membershipType: 'regular' | 'social' | 'junior_recreational';
    endsAt: string;
  } | null;
}): MemberMembershipCardData['membershipStatus'] {
  if (input.isLifetimeMember) {
    return { kind: 'lifetime', validThrough: null };
  }

  if (!input.latestPurchasedSeasonMembership) {
    return { kind: 'non_member', validThrough: null };
  }

  const validThrough = normalizeDateString(input.latestPurchasedSeasonMembership.endsAt);
  if (!validThrough) {
    return { kind: 'non_member', validThrough: null };
  }

  if (isExpiredDate(validThrough, input.today)) {
    return { kind: 'former', validThrough };
  }

  const kind =
    input.latestPurchasedSeasonMembership.membershipType === 'social' ? 'social' : 'regular';
  return { kind, validThrough };
}

/**
 * Deferred (and other unpaid) registrations place leagues before payment creates a
 * season_memberships row. Optimistically show the season end date as Member through.
 */
export function applyPendingRegistrationMembership(input: {
  today: string;
  membershipStatus: MemberMembershipCardData['membershipStatus'];
  pendingGrant: PendingRegistrationMembershipGrant | null;
}): {
  membershipStatus: MemberMembershipCardData['membershipStatus'];
  pendingRegistrationPayment: boolean;
} {
  if (input.membershipStatus.kind === 'lifetime' || !input.pendingGrant) {
    return {
      membershipStatus: input.membershipStatus,
      pendingRegistrationPayment: false,
    };
  }

  const pendingThrough = normalizeDateString(input.pendingGrant.seasonEndsAt);
  if (!pendingThrough || isExpiredDate(pendingThrough, input.today)) {
    return {
      membershipStatus: input.membershipStatus,
      pendingRegistrationPayment: false,
    };
  }

  const currentThrough = input.membershipStatus.validThrough;
  const pendingExtendsMembership =
    input.membershipStatus.kind === 'former' ||
    input.membershipStatus.kind === 'non_member' ||
    !currentThrough ||
    currentThrough < pendingThrough;

  if (!pendingExtendsMembership) {
    // Membership date already covers this season (e.g. already purchased), but
    // registration payment for this submission may still be outstanding.
    return {
      membershipStatus: input.membershipStatus,
      pendingRegistrationPayment: true,
    };
  }

  const kind = input.pendingGrant.membershipOption === 'social' ? 'social' : 'regular';
  return {
    membershipStatus: { kind, validThrough: pendingThrough },
    pendingRegistrationPayment: true,
  };
}

export function resolveIcePrivilegesValidThrough(input: {
  membershipKind: MembershipCardStatusKind;
  sessionEndDate: string | null;
  hasActiveSessionIcePrivilege: boolean;
  onSessionRoster: boolean;
}): string | null {
  if (input.membershipKind === 'social' || input.membershipKind === 'non_member') {
    return null;
  }

  if (!input.sessionEndDate) {
    return null;
  }

  if (!input.hasActiveSessionIcePrivilege && !input.onSessionRoster) {
    return null;
  }

  return input.sessionEndDate;
}

/**
 * Club tenure is baseline years at this club (pre-app) plus membership seasons
 * through the current dashboard season. The current year is included. The first
 * session of a member's first tracked season is labeled new rather than 1-year,
 * unless a club baseline already applies.
 */
export function resolveClubTenure(input: {
  membershipSeasons: MembershipSeason[];
  currentSession: { id: number; seasonId: number } | null;
  firstSessionIdOfCurrentSeason: number | null;
  baselineClubExperienceYears?: number;
}): ClubTenure | null {
  const baselineYears = Math.max(
    0,
    normalizeHalfYearExperienceValue(input.baselineClubExperienceYears ?? 0),
  );

  let trackedYears = 0;
  let inFirstTrackedSeason = false;
  if (input.membershipSeasons.length > 0) {
    const sorted = [...input.membershipSeasons].sort(
      (a, b) => a.startDate.localeCompare(b.startDate) || a.seasonId - b.seasonId,
    );
    const currentSeasonId = input.currentSession?.seasonId ?? null;
    const currentIndex =
      currentSeasonId == null ? -1 : sorted.findIndex((season) => season.seasonId === currentSeasonId);
    trackedYears = currentIndex < 0 ? sorted.length : currentIndex + 1;
    inFirstTrackedSeason = currentIndex === 0;
  }

  if (trackedYears === 0 && baselineYears === 0) {
    return null;
  }

  const inFirstSessionOfSeason =
    input.currentSession != null &&
    input.firstSessionIdOfCurrentSeason != null &&
    input.currentSession.id === input.firstSessionIdOfCurrentSeason;

  if (inFirstTrackedSeason && inFirstSessionOfSeason && baselineYears === 0) {
    return { kind: 'new', years: null };
  }

  return { kind: 'years', years: baselineYears + trackedYears };
}

/** Numeric club tenure used for waitlist ordering. "New" and unknown tenure sort as 0. */
export function clubTenureSortYears(tenure: ClubTenure | null | undefined): number {
  if (!tenure || tenure.kind === 'new') return 0;
  return Math.max(0, tenure.years ?? 0);
}

function uniqueMembershipSeasons(seasons: Array<{ seasonId: number; startDate: string | null }>): MembershipSeason[] {
  const byId = new Map<number, string>();
  for (const season of seasons) {
    const startDate = normalizeDateString(season.startDate);
    if (!startDate) continue;
    const existing = byId.get(season.seasonId);
    if (!existing || startDate < existing) {
      byId.set(season.seasonId, startDate);
    }
  }
  return [...byId.entries()].map(([seasonId, startDate]) => ({ seasonId, startDate }));
}

async function loadFirstSessionIdOfSeason(seasonId: number): Promise<number | null> {
  const { db, schema } = getDrizzleDb();
  const [firstSession] = await db
    .select({ id: schema.curlingSessions.id })
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.season_id, seasonId))
    .orderBy(asc(schema.curlingSessions.start_date), asc(schema.curlingSessions.id))
    .limit(1);
  return firstSession?.id ?? null;
}

type DashboardSessionRow = {
  id: number;
  name: string;
  endDate: unknown;
  seasonId: number;
  seasonStartDate: unknown;
};

async function toDashboardSession(row: DashboardSessionRow, isUpcoming: boolean): Promise<DashboardSession> {
  const seasonStartDate = normalizeDateString(row.seasonStartDate);
  if (!seasonStartDate) return null;
  const firstSessionId = (await loadFirstSessionIdOfSeason(row.seasonId)) ?? row.id;
  return {
    id: row.id,
    seasonId: row.seasonId,
    seasonStartDate,
    name: row.name,
    endDate: normalizeDateString(row.endDate),
    isUpcoming,
    firstSessionId,
  };
}

async function loadDashboardSessionUncached(today: string): Promise<DashboardSession> {
  const { db, schema } = getDrizzleDb();
  const todayValue = dateColumnBindValue(today);

  const [currentSession] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
      endDate: schema.curlingSessions.end_date,
      seasonId: schema.curlingSessions.season_id,
      seasonStartDate: schema.curlingSeasons.start_date,
    })
    .from(schema.curlingSessions)
    .innerJoin(
      schema.curlingSeasons,
      eq(schema.curlingSessions.season_id, schema.curlingSeasons.id),
    )
    .where(
      and(
        lte(schema.curlingSessions.start_date, todayValue as never),
        gte(schema.curlingSessions.end_date, todayValue as never),
      ),
    )
    .orderBy(desc(schema.curlingSessions.start_date))
    .limit(1);

  if (currentSession) {
    return toDashboardSession(currentSession, false);
  }

  const [upcomingSession] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
      endDate: schema.curlingSessions.end_date,
      seasonId: schema.curlingSessions.season_id,
      seasonStartDate: schema.curlingSeasons.start_date,
    })
    .from(schema.curlingSessions)
    .innerJoin(
      schema.curlingSeasons,
      eq(schema.curlingSessions.season_id, schema.curlingSeasons.id),
    )
    .where(gt(schema.curlingSessions.start_date, todayValue as never))
    .orderBy(asc(schema.curlingSessions.start_date))
    .limit(1);

  if (!upcomingSession) {
    return null;
  }

  return toDashboardSession(upcomingSession, true);
}

async function resolveDashboardSession(today: string): Promise<DashboardSession> {
  const now = Date.now();
  if (
    dashboardSessionCache &&
    dashboardSessionCache.today === today &&
    now - dashboardSessionCache.cachedAt < DASHBOARD_SESSION_CACHE_TTL_MS
  ) {
    return dashboardSessionCache.session;
  }

  const session = await loadDashboardSessionUncached(today);
  dashboardSessionCache = { today, cachedAt: now, session };
  return session;
}

export async function loadDashboardSessionForClubTenure(): Promise<{
  session: { id: number; seasonId: number; seasonStartDate: string } | null;
  firstSessionIdOfCurrentSeason: number | null;
}> {
  const today = await getCurrentDateStringAsync();
  const session = await resolveDashboardSession(today);
  return {
    session: session
      ? { id: session.id, seasonId: session.seasonId, seasonStartDate: session.seasonStartDate }
      : null,
    firstSessionIdOfCurrentSeason: session?.firstSessionId ?? null,
  };
}

type SessionLeaguesResult = {
  leagues: MemberMembershipCardData['leagues'];
  onSessionRoster: boolean;
};

async function loadLatestPurchasedSeasonMembership(memberId: number) {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      membershipType: schema.seasonMemberships.membership_type,
      endsAt: schema.seasonMemberships.ends_at,
    })
    .from(schema.seasonMemberships)
    .where(
      and(
        eq(schema.seasonMemberships.member_id, memberId),
        inArray(schema.seasonMemberships.status, [...PURCHASED_SEASON_MEMBERSHIP_STATUSES]),
      ),
    )
    .orderBy(desc(schema.seasonMemberships.ends_at))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const endsAt = normalizeDateString(row.endsAt);
  if (!endsAt) return null;
  return {
    membershipType: row.membershipType,
    endsAt,
  };
}

/**
 * Unpaid submitted registration that will grant season membership once paid.
 * Used to optimistically show Member through before season_memberships is written.
 */
async function loadPendingRegistrationMembershipGrant(
  memberId: number,
): Promise<PendingRegistrationMembershipGrant | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      membershipOption: schema.curlingRegistrations.membership_option,
      seasonId: schema.curlingSeasons.id,
      seasonStartDate: schema.curlingSeasons.start_date,
      seasonEndsAt: schema.curlingSeasons.end_date,
      seasonMembershipId: schema.seasonMemberships.id,
    })
    .from(schema.curlingRegistrations)
    .innerJoin(
      schema.curlingSeasons,
      eq(schema.curlingRegistrations.season_id, schema.curlingSeasons.id),
    )
    .leftJoin(
      schema.seasonMemberships,
      eq(schema.seasonMemberships.source_registration_id, schema.curlingRegistrations.id),
    )
    .where(
      and(
        eq(schema.curlingRegistrations.curler_member_id, memberId),
        inArray(schema.curlingRegistrations.status, [...UNPAID_MEMBERSHIP_REGISTRATION_STATUSES]),
      ),
    )
    .orderBy(desc(schema.curlingSeasons.end_date), desc(schema.curlingRegistrations.id))
    .limit(10);

  for (const row of rows) {
    if (row.seasonMembershipId != null) continue;
    if (row.membershipOption === 'none') continue;
    const seasonEndsAt = normalizeDateString(row.seasonEndsAt);
    if (!seasonEndsAt) continue;
    const seasonStartDate = normalizeDateString(row.seasonStartDate);
    if (
      row.membershipOption !== 'regular' &&
      row.membershipOption !== 'social' &&
      row.membershipOption !== 'regular_spare_only' &&
      row.membershipOption !== 'junior_recreational'
    ) {
      continue;
    }
    return {
      membershipOption: row.membershipOption,
      seasonId: row.seasonId,
      seasonStartDate: seasonStartDate ?? seasonEndsAt,
      seasonEndsAt,
    };
  }
  return null;
}

/**
 * Play-in leagues where the member is on an active entry declaration but not
 * yet on the league roster (staff has not granted entry). Guaranteed teams are
 * listed like roster; others get pending (may still need to play in).
 */
async function loadPlayInEntryLeagues(
  memberId: number,
  sessionId: number,
): Promise<Array<{ leagueId: number; leagueName: string; participation: 'roster' | 'pending' }>> {
  const { db, schema } = getDrizzleDb();
  const memberships = await db
    .select({
      leagueId: schema.leagues.id,
      leagueName: schema.leagues.name,
      entryTeamId: schema.leagueEntryTeams.id,
    })
    .from(schema.leagueEntryTeamMembers)
    .innerJoin(
      schema.leagueEntryTeams,
      eq(schema.leagueEntryTeamMembers.entry_team_id, schema.leagueEntryTeams.id),
    )
    .innerJoin(schema.leagues, eq(schema.leagueEntryTeams.league_id, schema.leagues.id))
    .where(
      and(
        eq(schema.leagueEntryTeamMembers.member_id, memberId),
        eq(schema.leagues.session_id, sessionId),
        eq(schema.leagues.is_play_in_based, 1),
        inArray(schema.leagueEntryTeams.status, ACTIVE_ENTRY_TEAM_STATUSES),
      ),
    );

  if (memberships.length === 0) return [];

  const entryTeamByLeagueId = new Map<number, { leagueId: number; leagueName: string; entryTeamId: number }>();
  for (const row of memberships) {
    if (!entryTeamByLeagueId.has(row.leagueId)) {
      entryTeamByLeagueId.set(row.leagueId, row);
    }
  }

  const rows: Array<{ leagueId: number; leagueName: string; participation: 'roster' | 'pending' }> = [];
  for (const candidate of entryTeamByLeagueId.values()) {
    const evaluated = await evaluatePlayInLeagueFromDb(candidate.leagueId);
    if (!evaluated) continue;
    const teamEvaluation = evaluated.evaluation.teams.find(
      (team) => team.entryTeamId === candidate.entryTeamId,
    );
    const participation = playInMembershipCardParticipation(teamEvaluation);
    if (!participation) continue;
    rows.push({
      leagueId: candidate.leagueId,
      leagueName: candidate.leagueName,
      participation,
    });
  }
  return rows;
}

async function loadSessionLeagues(memberId: number, sessionId: number): Promise<SessionLeaguesResult> {
  const { db, schema } = getDrizzleDb();
  const byLeagueId = new Map<
    number,
    { leagueId: number; leagueName: string; participation: MembershipCardLeagueParticipation }
  >();

  const [rosterRows, sabbaticalRows, waitlistRows, playInEntryRows] = await Promise.all([
    db
      .select({
        leagueId: schema.leagueRoster.league_id,
        leagueName: schema.leagues.name,
      })
      .from(schema.leagueRoster)
      .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
      .where(
        and(
          eq(schema.leagueRoster.member_id, memberId),
          eq(schema.leagueRoster.status, 'active'),
          eq(schema.leagues.session_id, sessionId),
        ),
      )
      .orderBy(asc(schema.leagues.day_of_week), asc(schema.leagues.name)),
    db
      .select({
        leagueId: schema.leagues.id,
        leagueName: schema.leagues.name,
      })
      .from(schema.curlingSabbaticalSessions)
      .innerJoin(
        schema.curlingLeagueSabbaticals,
        eq(schema.curlingSabbaticalSessions.sabbatical_id, schema.curlingLeagueSabbaticals.id),
      )
      .innerJoin(schema.leagues, eq(schema.curlingSabbaticalSessions.league_id, schema.leagues.id))
      .where(
        and(
          eq(schema.curlingLeagueSabbaticals.member_id, memberId),
          eq(schema.leagues.session_id, sessionId),
          inArray(schema.curlingLeagueSabbaticals.status, ACTIVE_SABBATICAL_STATUSES),
        ),
      )
      .orderBy(asc(schema.leagues.day_of_week), asc(schema.leagues.name)),
    db
      .select({
        memberId: schema.waitlistEntries.member_id,
        teamRosterPlacements: schema.waitlistEntries.team_roster_placements,
        leagueId: schema.leagues.id,
        leagueName: schema.leagues.name,
      })
      .from(schema.waitlistEntries)
      .innerJoin(schema.leagueWaitlists, eq(schema.waitlistEntries.waitlist_id, schema.leagueWaitlists.id))
      .innerJoin(
        schema.leagues,
        and(
          eq(schema.leagues.waitlist_id, schema.waitlistEntries.waitlist_id),
          eq(schema.leagues.session_id, sessionId),
        ),
      )
      .where(eq(schema.waitlistEntries.status, 'active'))
      .orderBy(asc(schema.leagues.day_of_week), asc(schema.leagues.name)),
    loadPlayInEntryLeagues(memberId, sessionId),
  ]);

  for (const row of rosterRows) {
    byLeagueId.set(row.leagueId, {
      leagueId: row.leagueId,
      leagueName: row.leagueName,
      participation: 'roster',
    });
  }

  for (const row of sabbaticalRows) {
    if (byLeagueId.has(row.leagueId)) continue;
    byLeagueId.set(row.leagueId, {
      leagueId: row.leagueId,
      leagueName: row.leagueName,
      participation: 'sabbatical',
    });
  }

  for (const row of waitlistRows) {
    if (
      !waitlistEntryIncludesMember(memberId, {
        memberId: row.memberId,
        teamRosterPlacements: row.teamRosterPlacements,
      })
    ) {
      continue;
    }
    if (byLeagueId.has(row.leagueId)) continue;
    byLeagueId.set(row.leagueId, {
      leagueId: row.leagueId,
      leagueName: row.leagueName,
      participation: 'waitlist',
    });
  }

  for (const row of playInEntryRows) {
    if (byLeagueId.has(row.leagueId)) continue;
    byLeagueId.set(row.leagueId, {
      leagueId: row.leagueId,
      leagueName: row.leagueName,
      participation: row.participation,
    });
  }

  return {
    leagues: Array.from(byLeagueId.values()).sort((a, b) => a.leagueName.localeCompare(b.leagueName)),
    onSessionRoster: rosterRows.length > 0 || playInEntryRows.length > 0,
  };
}

async function loadMemberTenureFields(memberId: number): Promise<{
  isLifetimeMember: boolean;
  baselineClubExperienceYears: number;
}> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({
      lifetime_member: schema.members.lifetime_member,
      baseline_club_experience_years: schema.members.baseline_club_experience_years,
    })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  return {
    isLifetimeMember: (row?.lifetime_member ?? 0) === 1,
    baselineClubExperienceYears: normalizeHalfYearExperienceValue(
      Number(row?.baseline_club_experience_years ?? 0),
    ),
  };
}

async function loadPurchasedMembershipSeasons(memberId: number): Promise<MembershipSeason[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      seasonId: schema.seasonMemberships.season_id,
      startDate: schema.curlingSeasons.start_date,
    })
    .from(schema.seasonMemberships)
    .innerJoin(
      schema.curlingSeasons,
      eq(schema.seasonMemberships.season_id, schema.curlingSeasons.id),
    )
    .where(
      and(
        eq(schema.seasonMemberships.member_id, memberId),
        inArray(schema.seasonMemberships.status, [...PURCHASED_SEASON_MEMBERSHIP_STATUSES]),
      ),
    );
  return uniqueMembershipSeasons(rows);
}

async function loadRosterMembershipSeasons(memberId: number): Promise<MembershipSeason[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      seasonId: schema.curlingSessions.season_id,
      startDate: schema.curlingSeasons.start_date,
    })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .innerJoin(schema.curlingSessions, eq(schema.leagues.session_id, schema.curlingSessions.id))
    .innerJoin(
      schema.curlingSeasons,
      eq(schema.curlingSessions.season_id, schema.curlingSeasons.id),
    )
    .where(eq(schema.leagueRoster.member_id, memberId));
  return uniqueMembershipSeasons(rows);
}

async function memberHasActiveSessionIcePrivilege(memberId: number, sessionId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ id: schema.curlingIcePrivileges.id })
    .from(schema.curlingIcePrivileges)
    .where(
      and(
        eq(schema.curlingIcePrivileges.member_id, memberId),
        eq(schema.curlingIcePrivileges.session_id, sessionId),
        eq(schema.curlingIcePrivileges.status, 'active'),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function getMemberMembershipCard(member: {
  id: number;
  name: string;
}): Promise<MemberMembershipCardData> {
  const today = await getCurrentDateStringAsync();
  const [
    latestPurchasedSeasonMembership,
    session,
    tenureFields,
    pendingGrant,
    purchasedMembershipSeasons,
    rosterMembershipSeasons,
  ] = await Promise.all([
    loadLatestPurchasedSeasonMembership(member.id),
    resolveDashboardSession(today),
    loadMemberTenureFields(member.id),
    loadPendingRegistrationMembershipGrant(member.id),
    loadPurchasedMembershipSeasons(member.id),
    loadRosterMembershipSeasons(member.id),
  ]);
  const { isLifetimeMember, baselineClubExperienceYears } = tenureFields;

  const purchasedMembershipStatus = resolveMembershipCardStatus({
    today,
    isLifetimeMember,
    latestPurchasedSeasonMembership,
  });
  const { membershipStatus, pendingRegistrationPayment } = applyPendingRegistrationMembership({
    today,
    membershipStatus: purchasedMembershipStatus,
    pendingGrant,
  });

  const sessionId = session?.id ?? null;
  let leagues: MemberMembershipCardData['leagues'] = [];
  let onSessionRoster = false;
  let hasActiveSessionIcePrivilege = false;

  if (sessionId) {
    // Repair unpaid registrations that predate roster-on-awaiting-payment.
    await ensureRosterPlacementsForUnpaidRegistrations(member.id);
    const [sessionLeagues, icePrivilege] = await Promise.all([
      loadSessionLeagues(member.id, sessionId),
      memberHasActiveSessionIcePrivilege(member.id, sessionId),
    ]);
    leagues = sessionLeagues.leagues;
    onSessionRoster = sessionLeagues.onSessionRoster;
    hasActiveSessionIcePrivilege = icePrivilege;
  }

  const icePrivilegesValidThrough = resolveIcePrivilegesValidThrough({
    membershipKind: membershipStatus.kind,
    sessionEndDate: session?.endDate ?? null,
    hasActiveSessionIcePrivilege,
    onSessionRoster,
  });

  const tenureSeasons: Array<{ seasonId: number; startDate: string | null }> = [
    ...purchasedMembershipSeasons,
    ...rosterMembershipSeasons,
  ];
  if (pendingGrant) {
    tenureSeasons.push({
      seasonId: pendingGrant.seasonId,
      startDate: pendingGrant.seasonStartDate,
    });
  }
  if (isLifetimeMember && session) {
    tenureSeasons.push({
      seasonId: session.seasonId,
      startDate: session.seasonStartDate,
    });
  }
  const clubTenure = resolveClubTenure({
    membershipSeasons: uniqueMembershipSeasons(tenureSeasons),
    currentSession: session,
    firstSessionIdOfCurrentSeason: session?.firstSessionId ?? null,
    baselineClubExperienceYears,
  });

  return {
    name: member.name,
    membershipStatus,
    icePrivilegesValidThrough,
    pendingRegistrationPayment,
    clubTenure,
    session: session
      ? {
          id: session.id,
          name: session.name,
          isUpcoming: session.isUpcoming,
        }
      : null,
    leagues,
  };
}
