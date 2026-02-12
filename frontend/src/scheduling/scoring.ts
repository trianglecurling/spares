import type { GeneratedGame, ScheduleByeRequest, TeamStats } from './types';

// ─── Weight constants ───────────────────────────────────────────────────────
// Higher weight = heavier penalty for violations.
// Constraints #1 (complete round robin) and #2 (once-per-week) are hard.
// Constraints #3 and #4 (draw compactness / fill) are handled structurally
// in assignSlots.ts via two-tier assignment + fill-level balancing.
// Remaining constraints are weighted soft constraints:

export const WEIGHT_DRAW_FILL_BALANCE = 15_000; // #4: even fill across active draws
export const WEIGHT_BYE_PRIORITY_1 = 10_000;    // #5: top bye request (priority 1)
export const WEIGHT_DRAW_TIME_BALANCE = 5_000;  // #6: draw time balance
export const WEIGHT_BYE_PRIORITY_2 = 1_000;     // #7: 2nd choice bye (priority 2)
export const WEIGHT_SHEET_BALANCE = 500;         // #8: sheet balance
export const WEIGHT_BYE_PRIORITY_LOW = 100;      // #9: additional byes (priority 3+)
export const WEIGHT_POSITION_BALANCE = 50;       // #10: team 1/2 balance

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
  byeRequestsByDate: Map<string, ScheduleByeRequest[]>,
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
export function buildByeMap(
  byeRequests: ScheduleByeRequest[],
): Map<string, ScheduleByeRequest[]> {
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
  byeRequestsByDate: Map<string, ScheduleByeRequest[]>,
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
): number {
  let score = 0;

  // Bye penalties
  for (const game of games) {
    score += byePenalty(game, byeRequestsByDate);
  }

  // Per-team balance penalties
  const stats = computeTeamStats(games, teamIds, byeRequestsByDate);
  for (const ts of stats) {
    // Draw time balance: variance of games-per-draw-time
    const drawTimeValues = Object.values(ts.drawTimeCounts);
    if (drawTimeValues.length > 0) {
      score += variance(drawTimeValues) * WEIGHT_DRAW_TIME_BALANCE;
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
 * Compute draw-compactness penalty for a schedule.
 * Constraint #3: draws used should be ceil(totalGames / numSheets).
 * Constraint #4: ≤1 empty sheet per draw, total empties < numSheets.
 */
export function compactnessScore(
  games: GeneratedGame[],
  drawCapacities: Map<string, number>,
  numSheets: number,
): number {
  if (games.length === 0) return 0;

  const targetDrawCount = Math.ceil(games.length / numSheets);
  const drawGameCounts = new Map<string, number>();
  for (const g of games) {
    const dk = `${g.gameDate}|${g.gameTime}`;
    drawGameCounts.set(dk, (drawGameCounts.get(dk) ?? 0) + 1);
  }

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
