import { eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { LeagueEntryTeamStatusSqlite } from '../db/drizzle-schema.js';
import {
  getCachedPlayInEvaluation,
  getCachedPlayInSource,
  playInEvaluationFingerprint,
  setCachedPlayInEvaluation,
  setCachedPlayInSource,
} from './playInEvaluationCache.js';

/**
 * Play-in ("TLINE") entry evaluation for play-in based leagues.
 *
 * Entry model: the top N teams by combined member TLINE points enter the league
 * automatically (N = capacity - playInSpotCount); everyone else plays down for the
 * remaining spots. Teams need at least MIN_RETURNING_MEMBERS members who played the
 * league in the prior season to be eligible for auto entry; that rule is waived when
 * fewer than N teams meet it.
 *
 * All point values are integer half-point units (e.g. 39 = 19.5 points).
 */

export const MIN_RETURNING_MEMBERS = 2;

export type PlayInMemberPoints = {
  memberId: number;
  pointsHalf: number;
  countsAsReturning: boolean;
};

export type PlayInTeamStatus = LeagueEntryTeamStatusSqlite;

export type PlayInTeamForEvaluation = {
  /** league_entry_teams.id, or null for a hypothetical team being drafted during registration. */
  entryTeamId: number | null;
  memberIds: number[];
  /** Teammates without member accounts yet; they always contribute 0 points. */
  pendingNameCount: number;
  status: PlayInTeamStatus;
};

export type PlayInEvaluationConfig = {
  /** Number of teams that enter automatically on points (capacity - play-in spots). */
  autoEntryCount: number;
  /** Players per team (4 for teams format). */
  teamSize: number;
};

export type PlayInProjectedStatus =
  | 'guaranteed'
  | 'projected_in'
  | 'projected_playdown'
  | 'ineligible_single_returner'
  | 'entered'
  | 'not_entered'
  | 'withdrawn';

export type PlayInEvaluatedTeam = {
  entryTeamId: number | null;
  totalPointsHalf: number;
  returningMemberCount: number;
  /** Meets the returning-members rule without relying on the waiver. */
  meetsReturningRule: boolean;
  /** Team total strictly exceeds the maximin opposing-team bar and meets the returning rule. */
  guaranteed: boolean;
  /**
   * Bar this team must strictly exceed for guarantee (other active teams + worst-case
   * packing of the uncommitted pool). Null when unavailable (e.g. auto-entry spots filled
   * by entered teams).
   */
  guaranteeThresholdHalf: number | null;
  projectedStatus: PlayInProjectedStatus;
};

export type PlayInLeagueEvaluation = {
  autoEntryCount: number;
  teamSize: number;
  playInSpotCount: number;
  /** Fewer than autoEntryCount active teams meet the returning-members rule. */
  returningRuleWaiverActive: boolean;
  /**
   * Guaranteed-entry bar (half points): beat this total to be guaranteed. The value is the
   * maximum opposing `autoEntryCount`-th team total under a worst-case regrouping of
   * uncommitted players. Null if unavailable.
   */
  guaranteeThresholdHalf: number | null;
  teams: PlayInEvaluatedTeam[];
};

export function pointsHalfToNumber(pointsHalf: number): number {
  const value = Number(pointsHalf) / 2;
  return Number.isFinite(value) ? value : 0;
}

export function numberToPointsHalf(points: number): number {
  return Math.round(points * 2);
}

function isActiveTeamStatus(status: PlayInTeamStatus): boolean {
  return status !== 'withdrawn' && status !== 'not_entered';
}

export function teamTotalPointsHalf(memberIds: number[], pointsByMemberId: Map<number, PlayInMemberPoints>): number {
  return memberIds.reduce((sum, memberId) => sum + (pointsByMemberId.get(memberId)?.pointsHalf ?? 0), 0);
}

export function teamReturningMemberCount(
  memberIds: number[],
  pointsByMemberId: Map<number, PlayInMemberPoints>
): number {
  return memberIds.filter((memberId) => pointsByMemberId.get(memberId)?.countsAsReturning).length;
}

function takeTopPadded(pointsHalfDesc: number[], count: number): number[] {
  const sorted = [...pointsHalfDesc].sort((left, right) => right - left);
  const taken = sorted.slice(0, count);
  while (taken.length < count) taken.push(0);
  return taken;
}

function teamSum(members: number[]): number {
  return members.reduce((sum, value) => sum + value, 0);
}

type PackedTeam = { members: number[]; sum: number };

function packedMinSum(teams: PackedTeam[]): number {
  if (teams.length === 0) return 0;
  return Math.min(...teams.map((team) => team.sum));
}

function snakeTeams(playersDesc: number[], teamCount: number): PackedTeam[] {
  const teams: PackedTeam[] = Array.from({ length: teamCount }, () => ({ members: [], sum: 0 }));
  let direction = 1;
  let index = 0;
  for (const points of playersDesc) {
    const team = teams[index];
    if (team) {
      team.members.push(points);
      team.sum += points;
    }
    index += direction;
    if (index === teamCount) {
      direction = -1;
      index = teamCount - 1;
    } else if (index < 0) {
      direction = 1;
      index = 0;
    }
  }
  return teams;
}

function foldTeams(playersDesc: number[], teamSize: number, teamCount: number): PackedTeam[] {
  const teams: PackedTeam[] = Array.from({ length: teamCount }, () => ({ members: [], sum: 0 }));
  for (let round = 0; round < teamSize; round += 1) {
    const slice = playersDesc.slice(round * teamCount, (round + 1) * teamCount);
    if (round % 2 === 1) slice.reverse();
    for (let i = 0; i < teamCount; i += 1) {
      const points = slice[i] ?? 0;
      const team = teams[i];
      if (!team) continue;
      team.members.push(points);
      team.sum += points;
    }
  }
  return teams;
}

function lptTeams(playersDesc: number[], teamSize: number, teamCount: number): PackedTeam[] {
  const teams: PackedTeam[] = Array.from({ length: teamCount }, () => ({ members: [], sum: 0 }));
  for (const points of playersDesc) {
    let bestIndex = -1;
    let bestSum = Number.POSITIVE_INFINITY;
    for (let i = 0; i < teams.length; i += 1) {
      const team = teams[i];
      if (!team || team.members.length >= teamSize) continue;
      if (team.sum < bestSum) {
        bestSum = team.sum;
        bestIndex = i;
      }
    }
    const target = teams[bestIndex];
    if (!target) break;
    target.members.push(points);
    target.sum += points;
  }
  return teams;
}

/** Raise the minimum team total with pairwise swaps. Strict lexicographic progress, so this always stops. */
function improveBySwaps(teams: PackedTeam[]): PackedTeam[] {
  const packed = teams.map((team) => ({ members: [...team.members], sum: team.sum }));
  let minSum = packedMinSum(packed);
  let teamsAtMin = packed.filter((team) => team.sum === minSum).length;
  let changed = true;
  while (changed) {
    changed = false;
    for (let a = 0; a < packed.length; a += 1) {
      for (let b = a + 1; b < packed.length; b += 1) {
        const teamA = packed[a];
        const teamB = packed[b];
        if (!teamA || !teamB) continue;
        if (teamA.sum > minSum && teamB.sum > minSum) continue;
        for (let i = 0; i < teamA.members.length; i += 1) {
          for (let j = 0; j < teamB.members.length; j += 1) {
            const fromA = teamA.members[i] ?? 0;
            const fromB = teamB.members[j] ?? 0;
            if (fromA === fromB) continue;
            const newA = teamA.sum - fromA + fromB;
            const newB = teamB.sum - fromB + fromA;
            let newMin = Math.min(newA, newB);
            let newAtMin = (newA === newMin ? 1 : 0) + (newB === newMin ? 1 : 0);
            for (let k = 0; k < packed.length; k += 1) {
              if (k === a || k === b) continue;
              const other = packed[k]?.sum ?? 0;
              if (other < newMin) {
                newMin = other;
                newAtMin = 1;
              } else if (other === newMin) {
                newAtMin += 1;
              }
            }
            if (newMin > minSum || (newMin === minSum && newAtMin < teamsAtMin)) {
              teamA.members[i] = fromB;
              teamB.members[j] = fromA;
              teamA.sum = newA;
              teamB.sum = newB;
              minSum = newMin;
              teamsAtMin = newAtMin;
              changed = true;
            }
          }
        }
      }
    }
  }
  return packed;
}

function bestPackingMinSum(playersDesc: number[], teamSize: number, teamCount: number): number {
  if (teamCount <= 0) return 0;
  const candidates = [
    snakeTeams(playersDesc, teamCount),
    foldTeams(playersDesc, teamSize, teamCount),
    lptTeams(playersDesc, teamSize, teamCount),
  ];
  let best = candidates[0] ?? [];
  let bestMin = packedMinSum(best);
  for (const candidate of candidates.slice(1)) {
    const min = packedMinSum(candidate);
    if (min > bestMin) {
      best = candidate;
      bestMin = min;
    }
  }
  return packedMinSum(improveBySwaps(best));
}

/** Cap unbounded combination search so evaluation cannot stall the HTTP server. */
const MAX_PACK_SEARCH_NODES = 40_000;

/**
 * Whether `teamCount` disjoint teams of `teamSize` can each total at least `minSum`.
 * Uses the strongest `teamCount * teamSize` players, padding with zero-point newcomers
 * when the pool is short. Pairing is exact for doubles; otherwise constructions and
 * bounded search decide 4-person packings.
 */
export function canFormTeamsWithMinSum(
  pointsHalfDesc: number[],
  teamSize: number,
  teamCount: number,
  minSum: number
): boolean {
  if (teamCount <= 0) return true;
  if (teamSize <= 0) return false;
  if (minSum <= 0) return true;

  const players = takeTopPadded(pointsHalfDesc, teamCount * teamSize);
  const total = teamSum(players);
  if (total < teamCount * minSum) return false;

  let strongest = 0;
  for (let i = 0; i < teamSize; i += 1) strongest += players[i] ?? 0;
  if (strongest < minSum) return false;
  if (teamCount === 1) return true;
  if (minSum > 0) {
    let positiveCount = 0;
    for (const points of players) {
      if (points > 0) positiveCount += 1;
    }
    if (positiveCount < teamCount) return false;
  }

  let weakestPlaceable = players[players.length - 1] ?? 0;
  for (let i = 0; i < teamSize - 1; i += 1) weakestPlaceable += players[i] ?? 0;
  if (weakestPlaceable < minSum) return false;

  if (teamSize === 2) {
    for (let i = 0; i < teamCount; i += 1) {
      if ((players[i] ?? 0) + (players[players.length - 1 - i] ?? 0) < minSum) return false;
    }
    return true;
  }

  if (bestPackingMinSum(players, teamSize, teamCount) >= minSum) return true;

  const used = new Uint8Array(players.length);
  const playerCount = players.length;
  let nodes = 0;

  function search(teamsLeft: number, firstUnused: number, remainingSum: number): boolean {
    if (teamsLeft === 0) return true;
    if (remainingSum < teamsLeft * minSum) return false;
    nodes += 1;
    if (nodes > MAX_PACK_SEARCH_NODES) return false;

    let captain = firstUnused;
    while (captain < playerCount && used[captain]) captain += 1;
    if (captain >= playerCount) return false;

    used[captain] = 1;
    const restNeed = teamsLeft - 1;
    const maxThisTeam = remainingSum - restNeed * minSum;
    const teammateCount = teamSize - 1;
    const unusedAfterCaptain: number[] = [];
    for (let i = captain + 1; i < playerCount; i += 1) {
      if (!used[i]) unusedAfterCaptain.push(i);
    }
    if (unusedAfterCaptain.length < teammateCount) {
      used[captain] = 0;
      return false;
    }

    let strongestWithCaptain = players[captain] ?? 0;
    for (let i = 0; i < teammateCount; i += 1) {
      strongestWithCaptain += players[unusedAfterCaptain[i] ?? 0] ?? 0;
    }
    if (strongestWithCaptain < minSum) {
      used[captain] = 0;
      return false;
    }

    const pick = new Array<number>(teammateCount);
    function choose(start: number, filled: number, sum: number): boolean {
      if (nodes > MAX_PACK_SEARCH_NODES) return false;
      if (filled === teammateCount) {
        if (sum < minSum || sum > maxThisTeam) return false;
        for (const index of pick) used[index] = 1;
        const formed = search(restNeed, captain + 1, remainingSum - sum);
        for (const index of pick) used[index] = 0;
        return formed;
      }
      const slotsLeft = teammateCount - filled;
      for (let i = start; i <= unusedAfterCaptain.length - slotsLeft; i += 1) {
        let maxFinish = sum;
        for (let slot = 0; slot < slotsLeft; slot += 1) {
          maxFinish += players[unusedAfterCaptain[i + slot] ?? 0] ?? 0;
        }
        if (maxFinish < minSum) break;
        const nextSum = sum + (players[unusedAfterCaptain[i] ?? 0] ?? 0);
        let minFinish = nextSum;
        for (let slot = 0; slot < slotsLeft - 1; slot += 1) {
          minFinish += players[unusedAfterCaptain[unusedAfterCaptain.length - 1 - slot] ?? 0] ?? 0;
        }
        if (minFinish > maxThisTeam) continue;
        pick[filled] = unusedAfterCaptain[i] ?? 0;
        if (choose(i + 1, filled + 1, nextSum)) return true;
      }
      return false;
    }

    const formed = choose(0, 0, players[captain] ?? 0);
    used[captain] = 0;
    return formed;
  }

  return search(teamCount, 0, total);
}

type PackFormCache = Map<string, boolean>;

function opposingCanReachThreshold(
  lockedTotalsHalf: number[],
  uncommittedPointsHalfDesc: number[],
  teamSize: number,
  autoEntryCount: number,
  thresholdHalf: number,
  formCache: PackFormCache
): boolean {
  const lockedAtLeast = lockedTotalsHalf.filter((total) => total >= thresholdHalf).length;
  const needFromPool = autoEntryCount - lockedAtLeast;
  if (needFromPool <= 0) return true;
  const cacheKey = `${needFromPool}:${thresholdHalf}`;
  const cached = formCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const formed = canFormTeamsWithMinSum(uncommittedPointsHalfDesc, teamSize, needFromPool, thresholdHalf);
  formCache.set(cacheKey, formed);
  return formed;
}

function guaranteeBarHalf(
  declaredTeams: Array<{ totalPointsHalf: number; status: PlayInTeamStatus }>,
  uncommittedPointsHalfDesc: number[],
  config: PlayInEvaluationConfig,
  formCache: PackFormCache = new Map()
): number | null {
  if (config.autoEntryCount <= 0) return null;

  const lockedTotalsHalf = declaredTeams.map((team) =>
    team.status === 'entered' ? Number.POSITIVE_INFINITY : team.totalPointsHalf
  );
  const enteredCount = lockedTotalsHalf.filter((total) => !Number.isFinite(total)).length;
  if (enteredCount >= config.autoEntryCount) return null;

  const finiteLocked = lockedTotalsHalf.filter((total) => Number.isFinite(total));
  const pool = [...uncommittedPointsHalfDesc].sort((left, right) => right - left);

  let strongestPoolTeam = 0;
  for (let i = 0; i < config.teamSize; i += 1) strongestPoolTeam += pool[i] ?? 0;
  const strongestLocked = finiteLocked.reduce((max, total) => Math.max(max, total), 0);
  const poolForBound = takeTopPadded(pool, config.autoEntryCount * config.teamSize);
  const poolSumBound = Math.floor(teamSum(poolForBound) / Math.max(1, config.autoEntryCount));
  const hi = Math.max(0, Math.min(strongestPoolTeam, poolSumBound), strongestLocked);

  const canReach = (thresholdHalf: number): boolean =>
    opposingCanReachThreshold(
      lockedTotalsHalf,
      pool,
      config.teamSize,
      config.autoEntryCount,
      thresholdHalf,
      formCache
    );

  if (canReach(hi)) return hi;
  let lo = 0;
  let high = hi;
  while (lo < high) {
    const mid = Math.ceil((lo + high + 1) / 2);
    if (canReach(mid)) lo = mid;
    else high = mid - 1;
  }
  return lo;
}

/**
 * Guaranteed-entry threshold: the maximum total T such that `autoEntryCount` opposing
 * teams (already-declared teams, which are locked, plus a worst-case regrouping of the
 * uncommitted pool) can each reach T. A team is guaranteed when its total strictly
 * exceeds this bar. Null when auto-entry spots are already filled by entered teams
 * (or autoEntryCount is zero).
 */
export function guaranteeThresholdHalf(
  activeTeams: Array<{ totalPointsHalf: number; status: PlayInTeamStatus }>,
  uncommittedPointsHalfDesc: number[],
  config: PlayInEvaluationConfig
): number | null {
  return guaranteeBarHalf(activeTeams, uncommittedPointsHalfDesc, config);
}

export function evaluatePlayInLeague(
  config: PlayInEvaluationConfig & { playInSpotCount: number },
  points: PlayInMemberPoints[],
  teams: PlayInTeamForEvaluation[]
): PlayInLeagueEvaluation {
  const cacheKey = playInEvaluationFingerprint(config, points, teams);
  const cached = getCachedPlayInEvaluation(cacheKey);
  if (cached) return cached;
  const evaluation = computePlayInLeagueEvaluation(config, points, teams);
  setCachedPlayInEvaluation(cacheKey, evaluation);
  return evaluation;
}

function computePlayInLeagueEvaluation(
  config: PlayInEvaluationConfig & { playInSpotCount: number },
  points: PlayInMemberPoints[],
  teams: PlayInTeamForEvaluation[]
): PlayInLeagueEvaluation {
  const pointsByMemberId = new Map(points.map((entry) => [entry.memberId, entry]));

  const enriched = teams.map((team) => ({
    team,
    totalPointsHalf: teamTotalPointsHalf(team.memberIds, pointsByMemberId),
    returningMemberCount: teamReturningMemberCount(team.memberIds, pointsByMemberId),
  }));

  const activeEnriched = enriched.filter((entry) => isActiveTeamStatus(entry.team.status));
  const committedMemberIds = new Set(activeEnriched.flatMap((entry) => entry.team.memberIds));
  const uncommittedPointsHalfDesc = points
    .filter((entry) => !committedMemberIds.has(entry.memberId) && entry.pointsHalf > 0)
    .map((entry) => entry.pointsHalf)
    .sort((left, right) => right - left);

  const eligibleActiveCount = activeEnriched.filter(
    (entry) => entry.returningMemberCount >= MIN_RETURNING_MEMBERS
  ).length;
  const returningRuleWaiverActive = eligibleActiveCount < config.autoEntryCount;

  // Projection: rank active teams by points; without the waiver only teams meeting
  // the returning rule compete for auto entry spots.
  const rankingPool = activeEnriched
    .filter((entry) => returningRuleWaiverActive || entry.returningMemberCount >= MIN_RETURNING_MEMBERS)
    .sort((left, right) => right.totalPointsHalf - left.totalPointsHalf);
  const projectedInKeys = new Set(
    rankingPool.slice(0, config.autoEntryCount).map((entry) => entry.team)
  );

  const packFormCache: PackFormCache = new Map();

  const evaluatedTeams: PlayInEvaluatedTeam[] = enriched.map((entry) => {
    const { team, totalPointsHalf, returningMemberCount } = entry;
    const meetsReturningRule = returningMemberCount >= MIN_RETURNING_MEMBERS;

    if (team.status === 'withdrawn' || team.status === 'not_entered' || team.status === 'entered') {
      return {
        entryTeamId: team.entryTeamId,
        totalPointsHalf,
        returningMemberCount,
        meetsReturningRule,
        guaranteed: team.status === 'entered',
        guaranteeThresholdHalf: null,
        projectedStatus: team.status,
      };
    }

    const otherActiveTeams = activeEnriched
      .filter((other) => other !== entry)
      .map((other) => ({ totalPointsHalf: other.totalPointsHalf, status: other.team.status }));
    // The evaluated team's own members are committed to it, so they stay excluded
    // from the uncommitted pool used for worst-case future opponents.
    const teamGuaranteeThresholdHalf = guaranteeBarHalf(
      otherActiveTeams,
      uncommittedPointsHalfDesc,
      config,
      packFormCache,
    );
    // Incomplete teams (fewer than teamSize slots filled) are never guaranteed — payment
    // stays deferred until a full roster meets the threshold.
    const rosterComplete = team.memberIds.length + team.pendingNameCount >= config.teamSize;
    const guaranteed =
      rosterComplete &&
      meetsReturningRule &&
      teamGuaranteeThresholdHalf != null &&
      totalPointsHalf > teamGuaranteeThresholdHalf;

    let projectedStatus: PlayInProjectedStatus;
    if (guaranteed) {
      projectedStatus = 'guaranteed';
    } else if (!meetsReturningRule && !returningRuleWaiverActive) {
      projectedStatus = 'ineligible_single_returner';
    } else if (projectedInKeys.has(team)) {
      projectedStatus = 'projected_in';
    } else {
      projectedStatus = 'projected_playdown';
    }

    return {
      entryTeamId: team.entryTeamId,
      totalPointsHalf,
      returningMemberCount,
      meetsReturningRule,
      guaranteed,
      guaranteeThresholdHalf: teamGuaranteeThresholdHalf,
      projectedStatus,
    };
  });

  const activeForThreshold = activeEnriched.map((entry) => ({
    totalPointsHalf: entry.totalPointsHalf,
    status: entry.team.status,
  }));

  return {
    autoEntryCount: config.autoEntryCount,
    teamSize: config.teamSize,
    playInSpotCount: config.playInSpotCount,
    returningRuleWaiverActive,
    guaranteeThresholdHalf: guaranteeBarHalf(
      activeForThreshold,
      uncommittedPointsHalfDesc,
      config,
      packFormCache,
    ),
    teams: evaluatedTeams,
  };
}

export function playInAutoEntryCount(league: {
  capacity_type: string;
  capacity_value: number;
  play_in_spot_count: number;
}): number {
  const capacityTeams = league.capacity_type === 'team' ? Number(league.capacity_value) || 0 : 0;
  const playInSpots = Number(league.play_in_spot_count) || 0;
  const autoEntryCount = capacityTeams - playInSpots;
  return Number.isFinite(autoEntryCount) ? Math.max(0, autoEntryCount) : 0;
}

export function playInTeamSize(format: string): number {
  return format === 'doubles' ? 2 : 4;
}

// --- Database loading -------------------------------------------------------

export type LeagueEntryPointsRow = {
  id: number;
  leagueId: number;
  memberId: number;
  memberName: string;
  pointsHalf: number;
  countsAsReturning: boolean;
  source: 'manual' | 'standings' | 'playdown';
  notes: string | null;
};

export type LeagueEntryTeamMemberRow = {
  id: number;
  memberId: number | null;
  memberName: string | null;
  pendingName: string | null;
  sourceRegistrationId: number | null;
};

export type LeagueEntryTeamRow = {
  id: number;
  leagueId: number;
  name: string | null;
  status: PlayInTeamStatus;
  createdFromRegistrationId: number | null;
  notes: string | null;
  members: LeagueEntryTeamMemberRow[];
};

function memberDisplayName(row: {
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}): string {
  const fromParts = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return (fromParts || row.name || row.email || 'Unknown member').trim();
}

export async function loadLeagueEntryPoints(leagueId: number): Promise<LeagueEntryPointsRow[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.leagueEntryPoints.id,
      leagueId: schema.leagueEntryPoints.league_id,
      memberId: schema.leagueEntryPoints.member_id,
      pointsHalf: schema.leagueEntryPoints.points_half,
      countsAsReturning: schema.leagueEntryPoints.counts_as_returning,
      source: schema.leagueEntryPoints.source,
      notes: schema.leagueEntryPoints.notes,
      memberName: schema.members.name,
      memberFirstName: schema.members.first_name,
      memberLastName: schema.members.last_name,
      memberEmail: schema.members.email,
    })
    .from(schema.leagueEntryPoints)
    .innerJoin(schema.members, eq(schema.leagueEntryPoints.member_id, schema.members.id))
    .where(eq(schema.leagueEntryPoints.league_id, leagueId));
  return rows.map((row) => ({
    id: Number(row.id),
    leagueId: Number(row.leagueId),
    memberId: Number(row.memberId),
    memberName: memberDisplayName({
      name: row.memberName,
      first_name: row.memberFirstName,
      last_name: row.memberLastName,
      email: row.memberEmail,
    }),
    pointsHalf: Number(row.pointsHalf) || 0,
    countsAsReturning: Boolean(row.countsAsReturning),
    source: row.source,
    notes: row.notes ?? null,
  }));
}

/** Effective member points for evaluation: ledger rows summed per member. */
export function aggregateMemberPoints(rows: LeagueEntryPointsRow[]): PlayInMemberPoints[] {
  const byMember = new Map<number, PlayInMemberPoints>();
  for (const row of rows) {
    const existing = byMember.get(row.memberId);
    if (existing) {
      existing.pointsHalf += row.pointsHalf;
      existing.countsAsReturning = existing.countsAsReturning || row.countsAsReturning;
    } else {
      byMember.set(row.memberId, {
        memberId: row.memberId,
        pointsHalf: row.pointsHalf,
        countsAsReturning: row.countsAsReturning,
      });
    }
  }
  return [...byMember.values()];
}

export async function loadLeagueEntryTeams(leagueId: number): Promise<LeagueEntryTeamRow[]> {
  const { db, schema } = getDrizzleDb();
  const teams = await db
    .select({
      id: schema.leagueEntryTeams.id,
      leagueId: schema.leagueEntryTeams.league_id,
      name: schema.leagueEntryTeams.name,
      status: schema.leagueEntryTeams.status,
      createdFromRegistrationId: schema.leagueEntryTeams.created_from_registration_id,
      notes: schema.leagueEntryTeams.notes,
    })
    .from(schema.leagueEntryTeams)
    .where(eq(schema.leagueEntryTeams.league_id, leagueId));
  if (teams.length === 0) return [];

  const teamIds = teams.map((team) => Number(team.id)).filter((id) => Number.isInteger(id) && id > 0);
  if (teamIds.length === 0) return [];

  const memberRows = await db
    .select({
      id: schema.leagueEntryTeamMembers.id,
      entryTeamId: schema.leagueEntryTeamMembers.entry_team_id,
      memberId: schema.leagueEntryTeamMembers.member_id,
      pendingName: schema.leagueEntryTeamMembers.pending_name,
      sourceRegistrationId: schema.leagueEntryTeamMembers.source_registration_id,
    })
    .from(schema.leagueEntryTeamMembers)
    .where(inArray(schema.leagueEntryTeamMembers.entry_team_id, teamIds));

  const memberIds = [
    ...new Set(
      memberRows
        .map((row) => (row.memberId == null ? null : Number(row.memberId)))
        .filter((id): id is number => id != null && Number.isInteger(id) && id > 0),
    ),
  ];
  const names = new Map<number, string>();
  if (memberIds.length > 0) {
    const members = await db
      .select({
        id: schema.members.id,
        name: schema.members.name,
        first_name: schema.members.first_name,
        last_name: schema.members.last_name,
        email: schema.members.email,
      })
      .from(schema.members)
      .where(inArray(schema.members.id, memberIds));
    for (const member of members) {
      names.set(Number(member.id), memberDisplayName(member));
    }
  }

  return teams.map((team) => ({
    id: Number(team.id),
    leagueId: Number(team.leagueId),
    name: team.name ?? null,
    status: team.status,
    createdFromRegistrationId:
      team.createdFromRegistrationId == null ? null : Number(team.createdFromRegistrationId),
    notes: team.notes ?? null,
    members: memberRows
      .filter((row) => Number(row.entryTeamId) === Number(team.id))
      .map((row) => ({
        id: Number(row.id),
        memberId: row.memberId == null ? null : Number(row.memberId),
        memberName: row.memberId != null ? names.get(Number(row.memberId)) ?? `Member #${row.memberId}` : null,
        pendingName: row.pendingName ?? null,
        sourceRegistrationId: row.sourceRegistrationId == null ? null : Number(row.sourceRegistrationId),
      })),
  }));
}

export function entryTeamToEvaluationInput(team: LeagueEntryTeamRow): PlayInTeamForEvaluation {
  return {
    entryTeamId: team.id,
    memberIds: team.members
      .map((member) => member.memberId)
      .filter((memberId): memberId is number => memberId != null),
    pendingNameCount: team.members.filter((member) => member.memberId == null).length,
    status: team.status,
  };
}

export type PlayInLeagueConfigRow = {
  id: number;
  name: string;
  format: string;
  capacityType: string;
  capacityValue: number;
  playInSpotCount: number;
  isPlayInBased: boolean;
  sessionId: number | null;
};

export async function loadPlayInLeagueConfig(leagueId: number): Promise<PlayInLeagueConfigRow | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      format: schema.leagues.format,
      capacityType: schema.leagues.capacity_type,
      capacityValue: schema.leagues.capacity_value,
      playInSpotCount: schema.leagues.play_in_spot_count,
      isPlayInBased: schema.leagues.is_play_in_based,
      sessionId: schema.leagues.session_id,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    format: row.format,
    capacityType: row.capacityType,
    capacityValue: Number(row.capacityValue) || 0,
    playInSpotCount: Number(row.playInSpotCount) || 0,
    isPlayInBased: Number(row.isPlayInBased) === 1,
    sessionId: row.sessionId == null ? null : Number(row.sessionId),
  };
}

/** Cached load of a play-in league's config, points ledger, and declared teams. */
export async function loadPlayInLeagueSource(leagueId: number): Promise<{
  league: PlayInLeagueConfigRow;
  points: LeagueEntryPointsRow[];
  teams: LeagueEntryTeamRow[];
} | null> {
  const cached = getCachedPlayInSource(leagueId);
  if (cached) return cached;
  const league = await loadPlayInLeagueConfig(leagueId);
  if (!league) return null;
  const [points, teams] = await Promise.all([loadLeagueEntryPoints(leagueId), loadLeagueEntryTeams(leagueId)]);
  const snapshot = { league, points, teams };
  setCachedPlayInSource(leagueId, snapshot);
  return snapshot;
}

/** Full evaluation for a play-in league, loading points and teams from the database. */
export async function evaluatePlayInLeagueFromDb(leagueId: number): Promise<{
  league: PlayInLeagueConfigRow;
  points: LeagueEntryPointsRow[];
  teams: LeagueEntryTeamRow[];
  evaluation: PlayInLeagueEvaluation;
} | null> {
  const source = await loadPlayInLeagueSource(leagueId);
  if (!source) return null;
  const evaluation = evaluatePlayInLeague(
    {
      autoEntryCount: playInAutoEntryCount({
        capacity_type: source.league.capacityType,
        capacity_value: source.league.capacityValue,
        play_in_spot_count: source.league.playInSpotCount,
      }),
      teamSize: playInTeamSize(source.league.format),
      playInSpotCount: source.league.playInSpotCount,
    },
    aggregateMemberPoints(source.points),
    source.teams.map(entryTeamToEvaluationInput)
  );
  return { league: source.league, points: source.points, teams: source.teams, evaluation };
}
