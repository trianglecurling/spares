import type { GeneratedGame, ScheduleByeRequest, TeamStats } from './types';

// ─── Weight constants ───────────────────────────────────────────────────────
// Higher weight = heavier penalty for violations.
// Constraints #1 (complete round robin) and #2 (once-per-week) are hard.
// Constraints #3 and #4 (draw compactness / fill) are handled structurally
// in assignSlots.ts via two-tier assignment + fill-level balancing.
// Remaining constraints are weighted soft constraints:

export const WEIGHT_DRAW_FILL_BALANCE = 15_000; // #4: even fill across active draws
export const WEIGHT_BYE_PRIORITY_1 = 10_000; // #5: top bye request (priority 1)
export const WEIGHT_DRAW_TIME_BALANCE = 5_000; // #6: draw time balance
export const WEIGHT_BYE_PRIORITY_2 = 1_000; // #7: 2nd choice bye (priority 2)
/**
 * Soft: team preferred early/late draw but was scheduled on the other.
 * P1/P2 are compared lexicographically by the assignment and SA layers, so
 * this weight only competes with lower-priority balance objectives.
 */
export const WEIGHT_PREFER_DRAW_TIME = 5_000;
/** @deprecated Use WEIGHT_PREFER_DRAW_TIME */
export const WEIGHT_PREFER_LATE = WEIGHT_PREFER_DRAW_TIME;
export const WEIGHT_SHEET_BALANCE = 500; // #8: sheet balance
export const WEIGHT_BYE_PRIORITY_LOW = 100; // #9: additional byes (priority 3+)
export const WEIGHT_POSITION_BALANCE = 50; // #10: team 1/2 balance

// SA compactness weights – constraints #3 & #4 rank above all soft constraints
export const WEIGHT_COMPACTNESS_EXTRA_DRAW = 100_000;
export const WEIGHT_COMPACTNESS_MULTI_EMPTY = 50_000;
export const WEIGHT_COMPACTNESS_EXCESS_EMPTIES = 30_000;

// ─── Bye scoring ────────────────────────────────────────────────────────────

/**
 * Compute a penalty for a single game placement against bye requests.
 * Bye requests are per-date, so any game on a requested bye date incurs a penalty.
 * Returns a non-negative penalty score.
 */
export function byePenalty(
  game: GeneratedGame,
  byeRequestsByDate: Map<string, ScheduleByeRequest[]>
): number {
  const requests = byeRequestsByDate.get(game.gameDate);
  if (!requests) return 0;

  let penalty = 0;
  for (const req of requests) {
    if (req.teamId !== game.team1Id && req.teamId !== game.team2Id) continue;
    if (req.priority === 1) {
      penalty += WEIGHT_BYE_PRIORITY_1;
    } else if (req.priority === 2) {
      penalty += WEIGHT_BYE_PRIORITY_2;
    } else {
      penalty += WEIGHT_BYE_PRIORITY_LOW / req.priority; // diminishing for 3+
    }
  }
  return penalty;
}

export interface ByePriorityCounts {
  p1: number;
  p2: number;
  lower: number;
}

/** Count bye-request conflicts for one game by priority band. */
export function byePriorityCounts(
  game: GeneratedGame,
  byeRequestsByDate: Map<string, ScheduleByeRequest[]>
): ByePriorityCounts {
  const counts: ByePriorityCounts = { p1: 0, p2: 0, lower: 0 };
  const requests = byeRequestsByDate.get(game.gameDate);
  if (!requests) return counts;

  for (const req of requests) {
    if (req.teamId !== game.team1Id && req.teamId !== game.team2Id) continue;
    if (req.priority === 1) counts.p1++;
    else if (req.priority === 2) counts.p2++;
    else counts.lower++;
  }
  return counts;
}

// ─── Balance scoring helpers ────────────────────────────────────────────────

/** Compute variance of an array of numbers. */
function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

// ─── Full schedule scoring ──────────────────────────────────────────────────

/**
 * Build a bye-request lookup map keyed by date.
 */
export function buildByeMap(byeRequests: ScheduleByeRequest[]): Map<string, ScheduleByeRequest[]> {
  const map = new Map<string, ScheduleByeRequest[]>();
  for (const req of byeRequests) {
    const list = map.get(req.drawDate) ?? [];
    list.push(req);
    map.set(req.drawDate, list);
  }
  return map;
}

/**
 * Compute per-team statistics from a set of generated games.
 */
export function computeTeamStats(
  games: GeneratedGame[],
  teamIds: number[],
  byeRequestsByDate: Map<string, ScheduleByeRequest[]>
): TeamStats[] {
  const statsMap = new Map<number, TeamStats>();

  for (const id of teamIds) {
    statsMap.set(id, {
      teamId: id,
      asTeam1: 0,
      asTeam2: 0,
      drawTimeCounts: {},
      sheetCounts: {},
      byeConflicts: [],
    });
  }

  for (const game of games) {
    const s1 = statsMap.get(game.team1Id);
    const s2 = statsMap.get(game.team2Id);
    if (s1) {
      s1.asTeam1++;
      s1.drawTimeCounts[game.gameTime] = (s1.drawTimeCounts[game.gameTime] ?? 0) + 1;
      s1.sheetCounts[game.sheetId] = (s1.sheetCounts[game.sheetId] ?? 0) + 1;
    }
    if (s2) {
      s2.asTeam2++;
      s2.drawTimeCounts[game.gameTime] = (s2.drawTimeCounts[game.gameTime] ?? 0) + 1;
      s2.sheetCounts[game.sheetId] = (s2.sheetCounts[game.sheetId] ?? 0) + 1;
    }

    // Check bye conflicts (keyed by date)
    const reqs = byeRequestsByDate.get(game.gameDate);
    if (reqs) {
      for (const req of reqs) {
        if (req.teamId === game.team1Id || req.teamId === game.team2Id) {
          const stats = statsMap.get(req.teamId);
          if (stats) {
            stats.byeConflicts.push({
              drawDate: req.drawDate,
              priority: req.priority,
            });
          }
        }
      }
    }
  }

  return [...statsMap.values()];
}

/**
 * Compute total penalty score for a full schedule.
 */
export function totalScheduleScore(
  games: GeneratedGame[],
  teamIds: number[],
  byeRequestsByDate: Map<string, ScheduleByeRequest[]>,
  options?: {
    preferEarlyTeamIds?: Set<number>;
    preferLateTeamIds?: Set<number>;
    earlyDrawTimeByDate?: Map<string, string>;
    lateDrawTimeByDate?: Map<string, string>;
  }
): number {
  let score = 0;
  const preferEarlyTeamIds = options?.preferEarlyTeamIds ?? new Set<number>();
  const preferLateTeamIds = options?.preferLateTeamIds ?? new Set<number>();

  // Bye penalties
  for (const game of games) {
    score += byePenalty(game, byeRequestsByDate);
    if (options?.earlyDrawTimeByDate && options?.lateDrawTimeByDate) {
      score += preferDrawTimePenalty(
        game,
        preferEarlyTeamIds,
        preferLateTeamIds,
        options.earlyDrawTimeByDate,
        options.lateDrawTimeByDate
      );
    }
  }

  // Per-team balance penalties
  const stats = computeTeamStats(games, teamIds, byeRequestsByDate);
  for (const ts of stats) {
    // Neutral teams are balanced across draw times. Teams with an explicit
    // preference are scored by preferDrawTimePenalty above instead.
    if (!preferEarlyTeamIds.has(ts.teamId) && !preferLateTeamIds.has(ts.teamId)) {
      const drawTimeValues = Object.values(ts.drawTimeCounts);
      if (drawTimeValues.length > 0) {
        score += variance(drawTimeValues) * WEIGHT_DRAW_TIME_BALANCE;
      }
    }

    // Sheet balance: variance of games-per-sheet
    const sheetValues = Object.values(ts.sheetCounts);
    if (sheetValues.length > 0) {
      score += variance(sheetValues) * WEIGHT_SHEET_BALANCE;
    }

    // Position balance: squared difference of Team1 vs Team2 counts
    const posDiff = ts.asTeam1 - ts.asTeam2;
    score += posDiff * posDiff * WEIGHT_POSITION_BALANCE;
  }

  return score;
}

/**
 * Compute draw-compactness penalty for a set of games against a draw universe.
 * Constraint #3: draws used should be ceil(totalGames / numSheets).
 * Constraint #4: ≤1 empty sheet per draw, total empties < numSheets.
 */
/** Compactness from pre-aggregated draw → game counts (for incremental SA). */
export function compactnessScoreFromCounts(
  drawGameCounts: Map<string, number>,
  drawCapacities: Map<string, number>,
  numSheets: number
): number {
  if (drawGameCounts.size === 0) return 0;

  const scheduledInPartition = [...drawGameCounts.values()].reduce((s, n) => s + n, 0);
  const targetDrawCount = Math.ceil(scheduledInPartition / numSheets);

  let score = 0;
  const actualDrawsUsed = drawGameCounts.size;

  if (actualDrawsUsed > targetDrawCount) {
    score += (actualDrawsUsed - targetDrawCount) * WEIGHT_COMPACTNESS_EXTRA_DRAW;
  }

  let totalEmpties = 0;
  let multiEmptyDraws = 0;
  for (const [dk, count] of drawGameCounts) {
    const capacity = drawCapacities.get(dk) ?? numSheets;
    const empties = capacity - count;
    if (empties > 0) totalEmpties += empties;
    if (empties > 1) multiEmptyDraws++;
  }

  score += multiEmptyDraws * WEIGHT_COMPACTNESS_MULTI_EMPTY;
  if (totalEmpties >= numSheets) {
    score += (totalEmpties - numSheets + 1) * WEIGHT_COMPACTNESS_EXCESS_EMPTIES;
  }

  return score;
}

export function compactnessScore(
  games: GeneratedGame[],
  drawCapacities: Map<string, number>,
  numSheets: number,
  /** When set, only these draw keys count toward capacity / empties. */
  allowedDrawKeys?: Set<string>
): number {
  if (games.length === 0) return 0;

  const drawGameCounts = new Map<string, number>();
  for (const g of games) {
    const dk = `${g.gameDate}|${g.gameTime}`;
    if (allowedDrawKeys && !allowedDrawKeys.has(dk)) continue;
    drawGameCounts.set(dk, (drawGameCounts.get(dk) ?? 0) + 1);
  }

  return compactnessScoreFromCounts(drawGameCounts, drawCapacities, numSheets);
}

/**
 * Build connected calendar phases. Strategies belong to the same phase when
 * their allowed draw sets overlap, directly or transitively.
 */
export function buildStrategyPhaseMap(
  strategyAllowedMap: Map<string, Set<string>>
): Map<string, string> {
  const strategyIds = [...strategyAllowedMap.keys()].sort();
  const parent = new Map(strategyIds.map((id) => [id, id]));
  const ownerByDraw = new Map<string, string>();

  const findRoot = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = findRoot(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = findRoot(a);
    const rootB = findRoot(b);
    if (rootA === rootB) return;
    const [first, second] = [rootA, rootB].sort();
    parent.set(second, first);
  };

  for (const strategyId of strategyIds) {
    for (const drawKey of strategyAllowedMap.get(strategyId) ?? []) {
      const owner = ownerByDraw.get(drawKey);
      if (owner) union(strategyId, owner);
      else ownerByDraw.set(drawKey, strategyId);
    }
  }

  return new Map(strategyIds.map((id) => [id, findRoot(id)]));
}

/**
 * Compactness scored independently per calendar phase. Strategies that share
 * draw slots contribute to one phase score, so they do not fight over which
 * strategy is allowed to occupy an otherwise-active draw.
 */
export function partitionCompactnessScore(
  games: GeneratedGame[],
  drawCapacities: Map<string, number>,
  numSheets: number,
  strategyAllowedMap: Map<string, Set<string>>
): number {
  if (games.length === 0 || strategyAllowedMap.size === 0) {
    return compactnessScore(games, drawCapacities, numSheets);
  }

  const strategyPhaseMap = buildStrategyPhaseMap(strategyAllowedMap);
  const gamesByPhase = new Map<string, GeneratedGame[]>();
  const allowedByPhase = new Map<string, Set<string>>();

  for (const [strategyLocalId, allowed] of strategyAllowedMap) {
    const phaseId = strategyPhaseMap.get(strategyLocalId) ?? strategyLocalId;
    const phaseAllowed = allowedByPhase.get(phaseId) ?? new Set<string>();
    for (const drawKey of allowed) phaseAllowed.add(drawKey);
    allowedByPhase.set(phaseId, phaseAllowed);
  }
  for (const game of games) {
    const phaseId = strategyPhaseMap.get(game.strategyLocalId) ?? game.strategyLocalId;
    const phaseGames = gamesByPhase.get(phaseId) ?? [];
    phaseGames.push(game);
    gamesByPhase.set(phaseId, phaseGames);
  }

  let score = 0;
  for (const [phaseId, allowed] of allowedByPhase) {
    score += compactnessScore(gamesByPhase.get(phaseId) ?? [], drawCapacities, numSheets, allowed);
  }
  return score;
}

/**
 * Build maps of date → earliest and latest draw time on that date.
 */
export function buildEarlyLateDrawTimesByDate(drawKeys: Iterable<string>): {
  earlyByDate: Map<string, string>;
  lateByDate: Map<string, string>;
} {
  const earlyByDate = new Map<string, string>();
  const lateByDate = new Map<string, string>();
  for (const key of drawKeys) {
    const [date, time] = key.split('|');
    if (!date || !time) continue;
    const early = earlyByDate.get(date);
    if (early == null || time < early) earlyByDate.set(date, time);
    const late = lateByDate.get(date);
    if (late == null || time > late) lateByDate.set(date, time);
  }
  return { earlyByDate, lateByDate };
}

/**
 * Soft penalty when prefer-early / prefer-late teams are on the wrong draw that day.
 * Only applies when that date has both an earlier and a later draw option.
 */
export function preferDrawTimePenalty(
  game: GeneratedGame,
  preferEarlyTeamIds: Set<number>,
  preferLateTeamIds: Set<number>,
  earlyDrawTimeByDate: Map<string, string>,
  lateDrawTimeByDate: Map<string, string>
): number {
  if (preferEarlyTeamIds.size === 0 && preferLateTeamIds.size === 0) return 0;
  const earlyTime = earlyDrawTimeByDate.get(game.gameDate);
  const lateTime = lateDrawTimeByDate.get(game.gameDate);
  if (earlyTime == null || lateTime == null || earlyTime === lateTime) return 0;

  const gameTime = game.gameTime.length >= 5 ? game.gameTime.slice(0, 5) : game.gameTime;
  const early = earlyTime.length >= 5 ? earlyTime.slice(0, 5) : earlyTime;
  const late = lateTime.length >= 5 ? lateTime.slice(0, 5) : lateTime;

  let penalty = 0;
  for (const teamId of [game.team1Id, game.team2Id]) {
    if (preferLateTeamIds.has(teamId) && gameTime !== late) {
      penalty += WEIGHT_PREFER_DRAW_TIME;
    }
    if (preferEarlyTeamIds.has(teamId) && gameTime !== early) {
      penalty += WEIGHT_PREFER_DRAW_TIME;
    }
  }
  return penalty;
}
