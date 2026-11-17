import { and, gt, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { dateColumnBindValue, resolveRelevantSessionIdForLeagues } from '../services/curlingSessionService.js';
import { getCurrentDateStringAsync } from '../utils/time.js';
import { loadTopWaitlistIdByMember } from './memberWaitlistOrder.js';
import { evaluatePlayInLeagueFromDb } from './playInEntryService.js';

export type TuesdayEveningBadge = 'backup' | 'playdown';

export type TuesdayEveningBadgeMemberSets = {
  rosteredMemberIds: Set<number>;
  playdownMemberIds: Set<number>;
  topWaitlistIdByMember: Map<number, number>;
};

/** Tuesday Evening is the session's play-in league; there is one per session. */
export function isTuesdayEveningLeague(league: { isPlayInBased?: boolean | number | null }): boolean {
  return league.isPlayInBased === true || league.isPlayInBased === 1;
}

/**
 * Stored `playdown` is rare; during registration teams stay `pending` and the
 * play-in evaluation projects `projected_playdown` or `ineligible_single_returner`
 * (ineligible for an auto-berth, so they must play down).
 */
export function isTuesdayPlaydownTeam(team: {
  status: string;
  projectedStatus?: string | null;
}): boolean {
  if (team.status === 'withdrawn' || team.status === 'not_entered' || team.status === 'entered') {
    return false;
  }
  return (
    team.status === 'playdown' ||
    team.projectedStatus === 'projected_playdown' ||
    team.projectedStatus === 'ineligible_single_returner'
  );
}

/**
 * Backup (Tuesday roster) wins over playdown, but only on a rostered member's
 * #1 waitlist. Playdown can appear on any waitlist.
 */
export function resolveTuesdayEveningBadge(input: {
  waitlistId: number;
  memberIds: number[];
  rosteredMemberIds: ReadonlySet<number>;
  playdownMemberIds: ReadonlySet<number>;
  topWaitlistIdByMember: ReadonlyMap<number, number>;
}): TuesdayEveningBadge | null {
  const rosteredMemberIds = input.memberIds.filter((memberId) => input.rosteredMemberIds.has(memberId));
  if (rosteredMemberIds.length > 0) {
    return rosteredMemberIds.some((memberId) => input.topWaitlistIdByMember.get(memberId) === input.waitlistId)
      ? 'backup'
      : null;
  }
  if (input.memberIds.some((memberId) => input.playdownMemberIds.has(memberId))) {
    return 'playdown';
  }
  return null;
}

function uniquePositiveIds(ids: Iterable<number>): number[] {
  return [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
}

async function loadPlaydownMemberIds(leagueIds: number[], memberIds: number[]): Promise<Set<number>> {
  const playdownMemberIds = new Set<number>();
  const memberIdSet = new Set(memberIds);
  for (const leagueId of leagueIds) {
    const result = await evaluatePlayInLeagueFromDb(leagueId);
    if (!result) continue;
    const projectedByTeamId = new Map(
      result.evaluation.teams
        .filter((team) => team.entryTeamId != null)
        .map((team) => [team.entryTeamId as number, team.projectedStatus]),
    );
    for (const team of result.teams) {
      if (
        !isTuesdayPlaydownTeam({
          status: team.status,
          projectedStatus: projectedByTeamId.get(team.id) ?? null,
        })
      ) {
        continue;
      }
      for (const member of team.members) {
        if (member.memberId != null && memberIdSet.has(member.memberId)) {
          playdownMemberIds.add(member.memberId);
        }
      }
    }
  }
  return playdownMemberIds;
}

async function loadTuesdayEveningLeagueIds(sessionIds: number[]): Promise<number[]> {
  if (sessionIds.length === 0) return [];
  const { db, schema } = getDrizzleDb();
  const leagues = await db
    .select({
      id: schema.leagues.id,
      isPlayInBased: schema.leagues.is_play_in_based,
    })
    .from(schema.leagues)
    .where(inArray(schema.leagues.session_id, sessionIds));
  return leagues.filter((league) => isTuesdayEveningLeague(league)).map((league) => league.id);
}

async function loadUpcomingSessionIds(today: string): Promise<number[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.curlingSessions.id })
    .from(schema.curlingSessions)
    .where(gt(schema.curlingSessions.start_date, dateColumnBindValue(today) as never));
  return rows.map((row) => row.id);
}

async function loadRosteredMemberIds(leagueIds: number[], memberIds: number[]): Promise<Set<number>> {
  if (leagueIds.length === 0) return new Set();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ memberId: schema.leagueRoster.member_id })
    .from(schema.leagueRoster)
    .where(and(inArray(schema.leagueRoster.league_id, leagueIds), inArray(schema.leagueRoster.member_id, memberIds)));
  return new Set(rows.map((row) => row.memberId));
}

/**
 * Backup uses the Tuesday Evening roster of the current session. Playdown only
 * applies to play-in teams for a session that has not started yet.
 */
export async function loadTuesdayEveningBadgeMemberSets(input: {
  memberIds: number[];
}): Promise<TuesdayEveningBadgeMemberSets> {
  const memberIds = uniquePositiveIds(input.memberIds);
  if (memberIds.length === 0) {
    return { rosteredMemberIds: new Set(), playdownMemberIds: new Set(), topWaitlistIdByMember: new Map() };
  }

  const today = await getCurrentDateStringAsync();
  const currentSessionId = await resolveRelevantSessionIdForLeagues(today);
  const currentTuesdayLeagueIds = currentSessionId != null ? await loadTuesdayEveningLeagueIds([currentSessionId]) : [];
  const rosteredMemberIds = await loadRosteredMemberIds(currentTuesdayLeagueIds, memberIds);
  const playInLeagueIds = await loadTuesdayEveningLeagueIds(await loadUpcomingSessionIds(today));

  return {
    rosteredMemberIds,
    playdownMemberIds: await loadPlaydownMemberIds(playInLeagueIds, memberIds),
    topWaitlistIdByMember:
      rosteredMemberIds.size > 0 ? await loadTopWaitlistIdByMember([...rosteredMemberIds]) : new Map(),
  };
}
