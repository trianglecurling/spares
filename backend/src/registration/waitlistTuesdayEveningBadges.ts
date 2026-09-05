import { and, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { evaluatePlayInLeagueFromDb } from './playInEntryService.js';

export type TuesdayEveningBadge = 'backup' | 'playdown';

export type TuesdayEveningBadgeMemberSets = {
  rosteredMemberIds: Set<number>;
  playdownMemberIds: Set<number>;
};

/** Tuesday Evening, or a Tuesday play-in league if the display name varies. */
export function isTuesdayEveningLeague(league: {
  name: string;
  isPlayInBased?: boolean | number | null;
}): boolean {
  const name = league.name.trim().toLowerCase();
  if (name.includes('tuesday evening')) return true;
  const playInBased = league.isPlayInBased === true || league.isPlayInBased === 1;
  return playInBased && name.includes('tuesday');
}

export function isTopRankedWaitlist(priorityRank: number | null | undefined): boolean {
  return Number(priorityRank) === 1;
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
 * Backup (Tuesday roster) wins over playdown, but only on the member's
 * #1-ranked waitlist. Playdown can appear on any waitlist.
 */
export function resolveTuesdayEveningBadge(input: {
  memberIds: number[];
  rosteredMemberIds: ReadonlySet<number>;
  playdownMemberIds: ReadonlySet<number>;
  isTopRankedWaitlist: boolean;
}): TuesdayEveningBadge | null {
  if (input.memberIds.some((memberId) => input.rosteredMemberIds.has(memberId))) {
    return input.isTopRankedWaitlist ? 'backup' : null;
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

export async function loadTuesdayEveningBadgeMemberSets(input: {
  sessionIds: number[];
  memberIds: number[];
}): Promise<TuesdayEveningBadgeMemberSets> {
  const rosteredMemberIds = new Set<number>();
  const sessionIds = uniquePositiveIds(input.sessionIds);
  const memberIds = uniquePositiveIds(input.memberIds);
  if (sessionIds.length === 0 || memberIds.length === 0) {
    return { rosteredMemberIds, playdownMemberIds: new Set() };
  }

  const { db, schema } = getDrizzleDb();
  const leagues = await db
    .select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      isPlayInBased: schema.leagues.is_play_in_based,
    })
    .from(schema.leagues)
    .where(inArray(schema.leagues.session_id, sessionIds));

  const tuesdayLeagueIds = leagues
    .filter((league) => isTuesdayEveningLeague(league))
    .map((league) => league.id);
  if (tuesdayLeagueIds.length === 0) {
    return { rosteredMemberIds, playdownMemberIds: new Set() };
  }

  const rosterRows = await db
    .select({ memberId: schema.leagueRoster.member_id })
    .from(schema.leagueRoster)
    .where(
      and(
        inArray(schema.leagueRoster.league_id, tuesdayLeagueIds),
        inArray(schema.leagueRoster.member_id, memberIds),
        eq(schema.leagueRoster.status, 'active'),
      ),
    );
  for (const row of rosterRows) {
    if (row.memberId != null) rosteredMemberIds.add(row.memberId);
  }

  return {
    rosteredMemberIds,
    playdownMemberIds: await loadPlaydownMemberIds(tuesdayLeagueIds, memberIds),
  };
}
