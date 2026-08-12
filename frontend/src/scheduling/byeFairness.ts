import type { GeneratedGame, ScheduleByeRequest } from './types';

export interface ByeFairnessContext {
  p1RequestCounts: Map<number, number>;
  p2RequestCounts: Map<number, number>;
  p1ConflictCounts: Map<number, number>;
  p2ConflictCounts: Map<number, number>;
}

export interface ByeFairnessCoverage {
  /** Index 0 = teams with at least one honored request, index 1 = at least two, etc. */
  p1: number[];
  p2: number[];
}

export function buildByeRequestCountMap(
  byeRequests: ScheduleByeRequest[],
  priority: number
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const request of byeRequests) {
    if (request.priority !== priority) continue;
    counts.set(request.teamId, (counts.get(request.teamId) ?? 0) + 1);
  }
  return counts;
}

function applyGameConflicts(
  context: ByeFairnessContext,
  game: GeneratedGame,
  byeRequestsByDate: Map<string, ScheduleByeRequest[]>,
  delta: 1 | -1
): void {
  for (const request of byeRequestsByDate.get(game.gameDate) ?? []) {
    if (request.teamId !== game.team1Id && request.teamId !== game.team2Id) continue;
    const target =
      request.priority === 1
        ? context.p1ConflictCounts
        : request.priority === 2
          ? context.p2ConflictCounts
          : null;
    if (!target) continue;
    const next = (target.get(request.teamId) ?? 0) + delta;
    if (next <= 0) target.delete(request.teamId);
    else target.set(request.teamId, next);
  }
}

export function createByeFairnessContext(
  byeRequests: ScheduleByeRequest[],
  games: GeneratedGame[],
  byeRequestsByDate: Map<string, ScheduleByeRequest[]>
): ByeFairnessContext {
  const context: ByeFairnessContext = {
    p1RequestCounts: buildByeRequestCountMap(byeRequests, 1),
    p2RequestCounts: buildByeRequestCountMap(byeRequests, 2),
    p1ConflictCounts: new Map(),
    p2ConflictCounts: new Map(),
  };
  for (const game of games) applyGameConflicts(context, game, byeRequestsByDate, 1);
  return context;
}

export function cloneByeFairnessContext(
  context: ByeFairnessContext
): ByeFairnessContext {
  return {
    p1RequestCounts: context.p1RequestCounts,
    p2RequestCounts: context.p2RequestCounts,
    p1ConflictCounts: new Map(context.p1ConflictCounts),
    p2ConflictCounts: new Map(context.p2ConflictCounts),
  };
}

export function applyByeFairnessGames(
  context: ByeFairnessContext,
  games: GeneratedGame[],
  byeRequestsByDate: Map<string, ScheduleByeRequest[]>,
  delta: 1 | -1
): void {
  for (const game of games) {
    applyGameConflicts(context, game, byeRequestsByDate, delta);
  }
}

export function buildCoverageVector(
  requestCounts: Map<number, number>,
  conflictCounts: Map<number, number>
): number[] {
  const maxRequests = Math.max(0, ...requestCounts.values());
  const coverage = Array.from({ length: maxRequests }, () => 0);
  for (const [teamId, requested] of requestCounts) {
    const honored = Math.max(0, requested - (conflictCounts.get(teamId) ?? 0));
    for (let level = 0; level < honored; level++) coverage[level]++;
  }
  return coverage;
}

export function getByeFairnessCoverage(
  context: ByeFairnessContext
): ByeFairnessCoverage {
  return {
    p1: buildCoverageVector(context.p1RequestCounts, context.p1ConflictCounts),
    p2: buildCoverageVector(context.p2RequestCounts, context.p2ConflictCounts),
  };
}

export function getByeFairnessCoverageAfterGames(
  context: ByeFairnessContext,
  games: GeneratedGame[],
  byeRequestsByDate: Map<string, ScheduleByeRequest[]>
): ByeFairnessCoverage {
  const candidate = cloneByeFairnessContext(context);
  applyByeFairnessGames(candidate, games, byeRequestsByDate, 1);
  return getByeFairnessCoverage(candidate);
}

/**
 * Negative means `a` is fairer/better, positive means `b` is fairer/better.
 * First-request coverage is compared before second-request coverage.
 */
export function compareCoverageVectors(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const aValue = a[index] ?? 0;
    const bValue = b[index] ?? 0;
    if (aValue !== bValue) return bValue - aValue;
  }
  return 0;
}

export function compareByeFairnessCoverage(
  a: ByeFairnessCoverage,
  b: ByeFairnessCoverage
): number {
  const p1Comparison = compareCoverageVectors(a.p1, b.p1);
  if (p1Comparison !== 0) return p1Comparison;
  return compareCoverageVectors(a.p2, b.p2);
}

export function countHonoredRequests(coverage: number[]): number {
  return coverage.reduce((sum, count) => sum + count, 0);
}
