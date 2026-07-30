import { and, asc, desc, eq, gt, gte, inArray, lte } from 'drizzle-orm';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type {
  CurlingLeagueSabbaticalStatusSqlite,
  LeagueEntryTeamStatusSqlite,
} from '../db/drizzle-schema.js';
import { evaluatePlayInLeagueFromDb } from '../registration/playInEntryService.js';
import { waitlistEntryIncludesMember } from '../registration/waitlistMemberMembership.js';
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

const DASHBOARD_SESSION_CACHE_TTL_MS = 10 * 60 * 1000;

type DashboardSession = {
  id: number;
  name: string;
  endDate: string | null;
  isUpcoming: boolean;
} | null;

let dashboardSessionCache: {
  today: string;
  cachedAt: number;
  session: DashboardSession;
} | null = null;

export type MembershipCardStatusKind = 'regular' | 'social' | 'former' | 'non_member' | 'lifetime';

export type MembershipCardLeagueParticipation = 'roster' | 'sabbatical' | 'waitlist' | 'pending';

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

async function loadDashboardSessionUncached(today: string): Promise<DashboardSession> {
  const { db, schema } = getDrizzleDb();
  const todayValue = dateColumnBindValue(today);

  const [currentSession] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
      startDate: schema.curlingSessions.start_date,
      endDate: schema.curlingSessions.end_date,
    })
    .from(schema.curlingSessions)
    .where(
      and(
        lte(schema.curlingSessions.start_date, todayValue as never),
        gte(schema.curlingSessions.end_date, todayValue as never),
      ),
    )
    .orderBy(desc(schema.curlingSessions.start_date))
    .limit(1);

  if (currentSession) {
    return {
      id: currentSession.id,
      name: currentSession.name,
      endDate: normalizeDateString(currentSession.endDate),
      isUpcoming: false,
    };
  }

  const [upcomingSession] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
      startDate: schema.curlingSessions.start_date,
      endDate: schema.curlingSessions.end_date,
    })
    .from(schema.curlingSessions)
    .where(gt(schema.curlingSessions.start_date, todayValue as never))
    .orderBy(asc(schema.curlingSessions.start_date))
    .limit(1);

  if (!upcomingSession) {
    return null;
  }

  return {
    id: upcomingSession.id,
    name: upcomingSession.name,
    endDate: normalizeDateString(upcomingSession.endDate),
    isUpcoming: true,
  };
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
    onSessionRoster: rosterRows.length > 0,
  };
}

async function loadIsLifetimeMember(memberId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ lifetime_member: schema.members.lifetime_member })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  return (row?.lifetime_member ?? 0) === 1;
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
  const [latestPurchasedSeasonMembership, session, isLifetimeMember, pendingGrant] =
    await Promise.all([
      loadLatestPurchasedSeasonMembership(member.id),
      resolveDashboardSession(today),
      loadIsLifetimeMember(member.id),
      loadPendingRegistrationMembershipGrant(member.id),
    ]);

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

  return {
    name: member.name,
    membershipStatus,
    icePrivilegesValidThrough,
    pendingRegistrationPayment,
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
