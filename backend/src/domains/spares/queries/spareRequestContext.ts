import { and, asc, eq, gte, inArray, or } from 'drizzle-orm';
import { getDrizzleDb } from '../../../db/drizzle-db.js';
import { resolveRelevantSessionIdForLeagues } from '../../../services/curlingSessionService.js';
import { getCurrentDateStringAsync } from '../../../utils/time.js';
import { isLeagueEligibleForSpares } from '../../../utils/leagueSpareEligibility.js';
import {
  sparePositionFromTeamMember,
  type SparePosition,
} from '../../../utils/sparePositionFromTeamMember.js';
import { localDateTimeToUtcDate } from '../../../utils/timeZone.js';
import { config } from '../../../config.js';

export type SpareRequestContextPlayer = {
  memberId: number;
  name: string;
  role: string | null;
  sparePosition: SparePosition | null;
  isSelf: boolean;
};

export type SpareRequestContextGame = {
  id: number;
  date: string;
  time: string;
  opponentName: string | null;
};

export type SpareRequestContextLeague = {
  id: number;
  name: string;
  dayOfWeek: number;
  format: string;
  teamId: number | null;
  teamName: string | null;
  players: SpareRequestContextPlayer[];
  games: SpareRequestContextGame[];
};

export type SpareRequestContext = {
  leagues: SpareRequestContextLeague[];
};

export type TeamMateRow = {
  memberId: number;
  name: string;
  role: string | null;
  sparePosition: SparePosition | null;
};

const ROSTER_ROLE_SORT_ORDER: Record<string, number> = {
  lead: 0,
  second: 1,
  third: 2,
  fourth: 3,
  player1: 0,
  player2: 1,
};

function rosterRoleSortKey(role: string | null | undefined): number {
  if (!role) return 100;
  return ROSTER_ROLE_SORT_ORDER[role.toLowerCase()] ?? 50;
}

function sortTeammatesByRosterRole(players: TeamMateRow[]): TeamMateRow[] {
  return [...players].sort((a, b) => {
    const roleDiff = rosterRoleSortKey(a.role) - rosterRoleSortKey(b.role);
    if (roleDiff !== 0) return roleDiff;
    return a.name.localeCompare(b.name);
  });
}

function formatDateValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  return typeof value === 'string' ? value.slice(0, 10) : String(value ?? '');
}

function formatTimeValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().split('T')[1]?.slice(0, 5) ?? '';
  }
  if (typeof value === 'string') {
    return value.length >= 5 ? value.slice(0, 5) : value;
  }
  return String(value ?? '');
}

function isGameStillUpcoming(date: string, time: string, now: Date, timeZone: string): boolean {
  const start = localDateTimeToUtcDate(date, time, timeZone);
  if (Number.isNaN(start.getTime())) return false;
  return start.getTime() > now.getTime();
}

type LeagueRow = {
  leagueId: number;
  leagueName: string;
  dayOfWeek: number;
  format: string;
  allowsDropIns: number;
  teamId: number | null;
  teamName: string | null;
  memberName: string;
};

/**
 * Active teams in spare-eligible leagues for this session. Being on the team
 * is enough — do not require a separate active league_roster row.
 */
async function loadTeamLeaguesForMember(
  memberId: number,
  sessionId: number,
): Promise<LeagueRow[]> {
  const { db, schema } = getDrizzleDb();
  const rows = (await db
    .select({
      leagueId: schema.leagues.id,
      leagueName: schema.leagues.name,
      dayOfWeek: schema.leagues.day_of_week,
      format: schema.leagues.format,
      allowsDropIns: schema.leagues.allows_drop_ins,
      teamId: schema.leagueTeams.id,
      teamName: schema.leagueTeams.name,
      memberName: schema.members.name,
    })
    .from(schema.teamMembers)
    .innerJoin(schema.leagueTeams, eq(schema.teamMembers.team_id, schema.leagueTeams.id))
    .innerJoin(schema.leagues, eq(schema.leagueTeams.league_id, schema.leagues.id))
    .innerJoin(schema.members, eq(schema.teamMembers.member_id, schema.members.id))
    .where(and(eq(schema.teamMembers.member_id, memberId), eq(schema.leagues.session_id, sessionId)))
    .orderBy(schema.leagues.day_of_week, schema.leagues.name)) as LeagueRow[];

  const byLeague = new Map<number, LeagueRow>();
  for (const row of rows) {
    if (!isLeagueEligibleForSpares({ format: row.format, allowsDropIns: row.allowsDropIns })) {
      continue;
    }
    if (!byLeague.has(row.leagueId)) {
      byLeague.set(row.leagueId, row);
    }
  }
  return [...byLeague.values()];
}

/**
 * Active, spare-eligible leagues for the member in the relevant session,
 * with teammates and scheduled games for their team.
 *
 * Team membership in this session is the source of truth. Active roster rows
 * without a team are still listed so the form can explain that they need a
 * team assignment.
 */
export async function getSpareRequestContextForMember(
  memberId: number,
): Promise<SpareRequestContext> {
  const today = await getCurrentDateStringAsync();
  const sessionId = await resolveRelevantSessionIdForLeagues(today);
  if (sessionId == null) {
    return { leagues: [] };
  }

  const { db, schema } = getDrizzleDb();

  const teamLeagues = await loadTeamLeaguesForMember(memberId, sessionId);
  const teamLeagueIds = new Set(teamLeagues.map((row) => row.leagueId));

  const rosterRows = (await db
    .select({
      leagueId: schema.leagues.id,
      leagueName: schema.leagues.name,
      dayOfWeek: schema.leagues.day_of_week,
      format: schema.leagues.format,
      allowsDropIns: schema.leagues.allows_drop_ins,
      memberName: schema.members.name,
    })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .innerJoin(schema.members, eq(schema.leagueRoster.member_id, schema.members.id))
    .where(
      and(
        eq(schema.leagueRoster.member_id, memberId),
        eq(schema.leagueRoster.status, 'active'),
        eq(schema.leagues.session_id, sessionId),
      ),
    )
    .orderBy(schema.leagues.day_of_week, schema.leagues.name)) as Array<{
    leagueId: number;
    leagueName: string;
    dayOfWeek: number;
    format: string;
    allowsDropIns: number;
    memberName: string;
  }>;

  const unassignedRosterLeagues: LeagueRow[] = [];
  for (const row of rosterRows) {
    if (teamLeagueIds.has(row.leagueId)) continue;
    if (!isLeagueEligibleForSpares({ format: row.format, allowsDropIns: row.allowsDropIns })) {
      continue;
    }
    unassignedRosterLeagues.push({
      ...row,
      teamId: null,
      teamName: null,
    });
  }

  const leaguesForContext = [...teamLeagues, ...unassignedRosterLeagues].sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.leagueName.localeCompare(b.leagueName);
  });

  const teamIds = [
    ...new Set(leaguesForContext.map((row) => row.teamId).filter((id): id is number => id != null)),
  ];

  const teammateRows = teamIds.length
    ? ((await db
        .select({
          teamId: schema.teamMembers.team_id,
          memberId: schema.teamMembers.member_id,
          name: schema.members.name,
          role: schema.teamMembers.role,
          isSkip: schema.teamMembers.is_skip,
          isVice: schema.teamMembers.is_vice,
        })
        .from(schema.teamMembers)
        .innerJoin(schema.members, eq(schema.teamMembers.member_id, schema.members.id))
        .where(inArray(schema.teamMembers.team_id, teamIds))
        .orderBy(schema.teamMembers.team_id, schema.teamMembers.role)) as Array<{
        teamId: number;
        memberId: number;
        name: string;
        role: string;
        isSkip: number;
        isVice: number;
      }>)
    : [];

  const teammatesByTeam = new Map<number, TeamMateRow[]>();
  for (const row of teammateRows) {
    const list = teammatesByTeam.get(row.teamId) ?? [];
    list.push({
      memberId: row.memberId,
      name: row.name,
      role: row.role || null,
      sparePosition: sparePositionFromTeamMember({
        role: row.role,
        is_skip: row.isSkip,
        is_vice: row.isVice,
      }),
    });
    teammatesByTeam.set(row.teamId, list);
  }
  for (const [teamId, list] of teammatesByTeam) {
    teammatesByTeam.set(teamId, sortTeammatesByRosterRole(list));
  }

  const gameRows = teamIds.length
    ? ((await db
        .select({
          id: schema.games.id,
          leagueId: schema.games.league_id,
          team1Id: schema.games.team1_id,
          team2Id: schema.games.team2_id,
          gameDate: schema.games.game_date,
          gameTime: schema.games.game_time,
        })
        .from(schema.games)
        .where(
          and(
            eq(schema.games.status, 'scheduled'),
            gte(schema.games.game_date, today),
            or(inArray(schema.games.team1_id, teamIds), inArray(schema.games.team2_id, teamIds)),
          ),
        )
        .orderBy(asc(schema.games.game_date), asc(schema.games.game_time), asc(schema.games.id))) as Array<{
        id: number;
        leagueId: number;
        team1Id: number;
        team2Id: number;
        gameDate: unknown;
        gameTime: unknown;
      }>)
    : [];

  const opponentTeamIds = new Set<number>();
  for (const row of gameRows) {
    opponentTeamIds.add(row.team1Id);
    opponentTeamIds.add(row.team2Id);
  }
  const opponentNames = new Map<number, string | null>();
  if (opponentTeamIds.size > 0) {
    const nameRows = (await db
      .select({ id: schema.leagueTeams.id, name: schema.leagueTeams.name })
      .from(schema.leagueTeams)
      .where(inArray(schema.leagueTeams.id, [...opponentTeamIds]))) as Array<{
      id: number;
      name: string | null;
    }>;
    for (const row of nameRows) {
      opponentNames.set(row.id, row.name);
    }
  }

  const now = new Date();
  const timeZone = config.timeZone;
  const gamesByLeague = new Map<number, SpareRequestContextGame[]>();
  for (const league of leaguesForContext) {
    if (league.teamId == null) {
      gamesByLeague.set(league.leagueId, []);
      continue;
    }
    const myTeamId = league.teamId;
    const games: SpareRequestContextGame[] = [];
    for (const row of gameRows) {
      if (row.leagueId !== league.leagueId) continue;
      if (row.team1Id !== myTeamId && row.team2Id !== myTeamId) continue;
      const date = formatDateValue(row.gameDate);
      const time = formatTimeValue(row.gameTime);
      if (!date || !time) continue;
      if (!isGameStillUpcoming(date, time, now, timeZone)) continue;
      const opponentId = row.team1Id === myTeamId ? row.team2Id : row.team1Id;
      games.push({
        id: row.id,
        date,
        time,
        opponentName: opponentNames.get(opponentId) ?? null,
      });
    }
    gamesByLeague.set(league.leagueId, games);
  }

  const leagues: SpareRequestContextLeague[] = leaguesForContext.map((row) => {
    const games = gamesByLeague.get(row.leagueId) ?? [];
    if (row.teamId != null) {
      const teammates = teammatesByTeam.get(row.teamId) ?? [];
      return {
        id: row.leagueId,
        name: row.leagueName,
        dayOfWeek: row.dayOfWeek,
        format: row.format,
        teamId: row.teamId,
        teamName: row.teamName,
        players: teammates.map((player) => ({
          ...player,
          isSelf: player.memberId === memberId,
        })),
        games,
      };
    }

    return {
      id: row.leagueId,
      name: row.leagueName,
      dayOfWeek: row.dayOfWeek,
      format: row.format,
      teamId: null,
      teamName: null,
      players: [
        {
          memberId,
          name: row.memberName,
          role: null,
          sparePosition: null,
          isSelf: true,
        },
      ],
      games: [],
    };
  });

  return { leagues };
}

/**
 * Resolve teammates for a requester in a league.
 * Being on a team in the league is enough; an active roster row is only
 * required when the member is unassigned.
 * Returns null when the requester has neither a team nor an active roster row.
 */
export async function getRequesterTeamContext(
  requesterId: number,
  leagueId: number,
): Promise<{ teamId: number | null; teammates: TeamMateRow[] } | null> {
  const { db, schema } = getDrizzleDb();

  const [league] = (await db
    .select({
      format: schema.leagues.format,
      allowsDropIns: schema.leagues.allows_drop_ins,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1)) as Array<{ format: string; allowsDropIns: number }>;
  if (!league) return null;
  if (!isLeagueEligibleForSpares({ format: league.format, allowsDropIns: league.allowsDropIns })) {
    return null;
  }

  const [assignment] = (await db
    .select({
      teamId: schema.leagueTeams.id,
    })
    .from(schema.teamMembers)
    .innerJoin(schema.leagueTeams, eq(schema.teamMembers.team_id, schema.leagueTeams.id))
    .where(
      and(eq(schema.teamMembers.member_id, requesterId), eq(schema.leagueTeams.league_id, leagueId)),
    )
    .limit(1)) as Array<{ teamId: number }>;

  if (assignment?.teamId != null) {
    const teammates = (await db
      .select({
        memberId: schema.teamMembers.member_id,
        name: schema.members.name,
        role: schema.teamMembers.role,
        isSkip: schema.teamMembers.is_skip,
        isVice: schema.teamMembers.is_vice,
      })
      .from(schema.teamMembers)
      .innerJoin(schema.members, eq(schema.teamMembers.member_id, schema.members.id))
      .where(eq(schema.teamMembers.team_id, assignment.teamId))) as Array<{
      memberId: number;
      name: string;
      role: string;
      isSkip: number;
      isVice: number;
    }>;

    return {
      teamId: assignment.teamId,
      teammates: sortTeammatesByRosterRole(
        teammates.map((row) => ({
          memberId: row.memberId,
          name: row.name,
          role: row.role || null,
          sparePosition: sparePositionFromTeamMember({
            role: row.role,
            is_skip: row.isSkip,
            is_vice: row.isVice,
          }),
        })),
      ),
    };
  }

  const [roster] = await db
    .select({ id: schema.leagueRoster.id })
    .from(schema.leagueRoster)
    .where(
      and(
        eq(schema.leagueRoster.member_id, requesterId),
        eq(schema.leagueRoster.league_id, leagueId),
        eq(schema.leagueRoster.status, 'active'),
      ),
    )
    .limit(1);
  if (!roster) return null;
  return { teamId: null, teammates: [] };
}
