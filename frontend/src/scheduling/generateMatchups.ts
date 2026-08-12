import type {
  Matchup,
  ScheduleByeRequest,
  ScheduleDrawSlot,
  ScheduleStrategy,
  ScheduleTeam,
} from './types';
import { buildStrategyPhaseMap } from './scoring';

/**
 * A round is a set of matchups where no team appears more than once.
 * Rounds are the natural output of round-robin generation and serve as
 * the scheduling unit when assigning games to draw slots.
 */
export interface MatchupRound {
  matchups: Matchup[];
}

export interface StrategyCapacityPreview {
  strategyLocalId: string;
  priority: number;
  /** Games after capacity capping. */
  gameCount: number;
  /** Available sheet slots across the strategy's selected draws. */
  slotCapacity: number;
  /** Games that would be generated without capacity capping. */
  uncappedGameCount: number;
  /** True when generation was reduced to fit slot capacity. */
  capped: boolean;
}

function normalizeDrawTime(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return time.trim().slice(0, 5);
  return `${String(Number.parseInt(match[1], 10)).padStart(2, '0')}:${match[2]}`;
}

// ─── Circle method for round-robin ─────────────────────────────────────────

/**
 * Generate a full single round-robin for the given team IDs using the
 * circle (polygon) method. Returns N-1 rounds (N if odd, after adding a
 * BYE sentinel) each containing floor(N/2) matchups. Matchups paired with
 * the BYE sentinel (-1) are omitted.
 */
function circleRoundRobin(teamIds: number[]): MatchupRound[] {
  if (teamIds.length < 2) return [];

  // If odd number of teams, add a virtual BYE team
  const ids = [...teamIds];
  const hasVirtualBye = ids.length % 2 !== 0;
  if (hasVirtualBye) {
    ids.push(-1); // BYE sentinel
  }

  const n = ids.length;
  const rounds: MatchupRound[] = [];

  // Fix position 0, rotate positions 1..n-1
  const fixed = ids[0];
  const rotating = ids.slice(1);

  for (let r = 0; r < n - 1; r++) {
    const matchups: Matchup[] = [];

    // Pair fixed team with the team at the "top" of the rotating list
    const opponent = rotating[0];
    if (fixed !== -1 && opponent !== -1) {
      matchups.push({ team1Id: fixed, team2Id: opponent, strategyLocalId: '' });
    }

    // Pair remaining teams from opposite ends of the rotating list
    for (let i = 1; i < n / 2; i++) {
      const a = rotating[i];
      const b = rotating[n - 1 - i];
      if (a !== -1 && b !== -1) {
        matchups.push({ team1Id: a, team2Id: b, strategyLocalId: '' });
      }
    }

    rounds.push({ matchups });

    // Rotate: move last element to the front
    rotating.unshift(rotating.pop()!);
  }

  return rounds;
}

// ─── Capacity helpers ───────────────────────────────────────────────────────

/** Available sheet count per draw key ("date|time"). */
export function buildSheetCapacityByDrawKey(drawSlots: ScheduleDrawSlot[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const ds of drawSlots) {
    const time = normalizeDrawTime(ds.time);
    const key = `${ds.date}|${time}`;
    map.set(key, (map.get(key) ?? 0) + ds.sheets.filter((s) => s.isAvailable).length);
  }
  return map;
}

/** Total sheet slots a strategy may use. */
export function strategySlotCapacity(
  strategy: ScheduleStrategy,
  sheetsByDrawKey: Map<string, number>
): number {
  let slots = 0;
  for (const key of strategy.drawSlotKeys) {
    const [date, time] = key.split('|');
    if (!date || !time) {
      slots += sheetsByDrawKey.get(key) ?? 0;
      continue;
    }
    const normalized = `${date}|${normalizeDrawTime(time)}`;
    slots += sheetsByDrawKey.get(normalized) ?? sheetsByDrawKey.get(key) ?? 0;
  }
  return slots;
}

function countMatchups(rounds: MatchupRound[]): number {
  return rounds.reduce((sum, r) => sum + r.matchups.length, 0);
}

function unorderedPairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface TeamByePressure {
  p1Count: number;
  p2Count: number;
  lowerWeight: number;
}

function compareMatchupByePressure(
  a: Matchup,
  b: Matchup,
  pressureByTeam: Map<number, TeamByePressure>
): number {
  const aTeams = [a.team1Id, a.team2Id];
  const bTeams = [b.team1Id, b.team2Id];
  const maxP1 = Math.max(
    0,
    ...aTeams.map((teamId) => pressureByTeam.get(teamId)?.p1Count ?? 0),
    ...bTeams.map((teamId) => pressureByTeam.get(teamId)?.p1Count ?? 0)
  );
  for (let level = 1; level <= maxP1; level++) {
    const aCount = aTeams.filter(
      (teamId) => (pressureByTeam.get(teamId)?.p1Count ?? 0) >= level
    ).length;
    const bCount = bTeams.filter(
      (teamId) => (pressureByTeam.get(teamId)?.p1Count ?? 0) >= level
    ).length;
    if (aCount !== bCount) return aCount - bCount;
  }

  const maxP2 = Math.max(
    0,
    ...aTeams.map((teamId) => pressureByTeam.get(teamId)?.p2Count ?? 0),
    ...bTeams.map((teamId) => pressureByTeam.get(teamId)?.p2Count ?? 0)
  );
  for (let level = 1; level <= maxP2; level++) {
    const aCount = aTeams.filter(
      (teamId) => (pressureByTeam.get(teamId)?.p2Count ?? 0) >= level
    ).length;
    const bCount = bTeams.filter(
      (teamId) => (pressureByTeam.get(teamId)?.p2Count ?? 0) >= level
    ).length;
    if (aCount !== bCount) return aCount - bCount;
  }

  const lowerA = aTeams.reduce(
    (sum, teamId) => sum + (pressureByTeam.get(teamId)?.lowerWeight ?? 0),
    0
  );
  const lowerB = bTeams.reduce(
    (sum, teamId) => sum + (pressureByTeam.get(teamId)?.lowerWeight ?? 0),
    0
  );
  return lowerA - lowerB;
}

/**
 * Trim rounds so total matchups ≤ capacity. Prefers whole rounds; the last
 * partial round keeps matchups that best balance games-per-team and
 * opponent exposure (prefer pairs that have met fewer times).
 */
function takeUntilCapacity(
  rounds: MatchupRound[],
  capacity: number,
  byePressureByTeam: Map<number, TeamByePressure> = new Map()
): MatchupRound[] {
  if (capacity <= 0) return [];
  if (countMatchups(rounds) <= capacity) return rounds;

  const result: MatchupRound[] = [];
  let remaining = capacity;
  const gamesPlayed = new Map<number, number>();
  const meetings = new Map<string, number>();

  const bump = (m: Matchup) => {
    gamesPlayed.set(m.team1Id, (gamesPlayed.get(m.team1Id) ?? 0) + 1);
    gamesPlayed.set(m.team2Id, (gamesPlayed.get(m.team2Id) ?? 0) + 1);
    const pk = unorderedPairKey(m.team1Id, m.team2Id);
    meetings.set(pk, (meetings.get(pk) ?? 0) + 1);
  };

  const exposureRank = (a: Matchup, b: Matchup): number => {
    const byeComparison = compareMatchupByePressure(a, b, byePressureByTeam);
    if (byeComparison !== 0) return byeComparison;
    const loadA = (gamesPlayed.get(a.team1Id) ?? 0) + (gamesPlayed.get(a.team2Id) ?? 0);
    const loadB = (gamesPlayed.get(b.team1Id) ?? 0) + (gamesPlayed.get(b.team2Id) ?? 0);
    if (loadA !== loadB) return loadA - loadB;
    const meetA = meetings.get(unorderedPairKey(a.team1Id, a.team2Id)) ?? 0;
    const meetB = meetings.get(unorderedPairKey(b.team1Id, b.team2Id)) ?? 0;
    if (meetA !== meetB) return meetA - meetB;
    return a.team1Id + a.team2Id - (b.team1Id + b.team2Id);
  };

  // When heavily capped, greedily pick across remaining rounds for exposure
  // rather than only consuming circle/bipartite rounds in order.
  const uncapped = countMatchups(rounds);
  const heavilyCapped = remaining < uncapped * 0.5;

  if (heavilyCapped) {
    const pool = rounds.flatMap((r) => r.matchups);
    const chosen: Matchup[] = [];
    const usedInRound = new Set<number>();

    const flushRound = () => {
      if (chosen.length === 0) return;
      result.push({ matchups: [...chosen] });
      chosen.length = 0;
      usedInRound.clear();
    };

    while (remaining > 0) {
      let best: Matchup | null = null;
      for (const m of pool) {
        if (usedInRound.has(m.team1Id) || usedInRound.has(m.team2Id)) continue;
        // Skip already-selected instances: mark by mutating meetings after pick;
        // remove from pool when chosen.
        if (best == null || exposureRank(m, best) < 0) best = m;
      }
      if (best == null) {
        if (chosen.length === 0) break;
        flushRound();
        continue;
      }
      // Remove one occurrence of best from pool
      const idx = pool.findIndex(
        (m) =>
          m.team1Id === best!.team1Id &&
          m.team2Id === best!.team2Id &&
          m.strategyLocalId === best!.strategyLocalId
      );
      if (idx >= 0) pool.splice(idx, 1);
      chosen.push(best);
      usedInRound.add(best.team1Id);
      usedInRound.add(best.team2Id);
      bump(best);
      remaining--;
      // Prefer packing a dense round; flush when no more pairs fit
      let canAddMore = false;
      for (const m of pool) {
        if (!usedInRound.has(m.team1Id) && !usedInRound.has(m.team2Id)) {
          canAddMore = true;
          break;
        }
      }
      if (!canAddMore || remaining === 0) flushRound();
    }

    return result;
  }

  for (const round of rounds) {
    if (remaining <= 0) break;

    if (round.matchups.length <= remaining) {
      result.push(round);
      for (const m of round.matchups) bump(m);
      remaining -= round.matchups.length;
      continue;
    }

    const ranked = [...round.matchups].sort(exposureRank);
    const chosen: Matchup[] = [];
    const used = new Set<number>();
    for (const m of ranked) {
      if (chosen.length >= remaining) break;
      if (used.has(m.team1Id) || used.has(m.team2Id)) continue;
      chosen.push(m);
      used.add(m.team1Id);
      used.add(m.team2Id);
      bump(m);
    }

    if (chosen.length > 0) {
      result.push({ matchups: chosen });
    }
    remaining = 0;
  }

  return result;
}

// ─── Round-robin cycle helper ───────────────────────────────────────────────

/**
 * Generate matchup rounds by repeating a full circle round-robin `cycles` times.
 * `gamesPerTeam` / `cycles` is the number of complete RR cycles:
 *  - 1 = single RR (each pair plays once)
 *  - 2 = double RR (each pair plays twice)
 *  - etc.
 */
function generateRoundRobinCycles(
  teamIds: number[],
  cycles: number,
  strategyLocalId: string
): MatchupRound[] {
  if (teamIds.length < 2 || cycles <= 0) return [];

  const fullRounds = circleRoundRobin(teamIds);
  const result: MatchupRound[] = [];
  for (let c = 0; c < cycles; c++) {
    // Even cycles reverse home/away so double RR balances Team 1 / Team 2.
    const reverseHomeAway = c % 2 === 1;
    for (const round of fullRounds) {
      result.push({
        matchups: round.matchups.map((m) => ({
          team1Id: reverseHomeAway ? m.team2Id : m.team1Id,
          team2Id: reverseHomeAway ? m.team1Id : m.team2Id,
          strategyLocalId,
        })),
      });
    }
  }

  return result;
}

// ─── Intra-division / any pairing ───────────────────────────────────────────

function generateIntraDivisionRounds(
  teams: ScheduleTeam[],
  strategy: ScheduleStrategy
): MatchupRound[] {
  const divisionTeams = teams.filter((t) => t.divisionId === strategy.divisionId);
  return generateRoundRobinCycles(
    divisionTeams.map((t) => t.id),
    strategy.gamesPerTeam,
    strategy.localId
  );
}

function generateAnyPairingRounds(
  teams: ScheduleTeam[],
  strategy: ScheduleStrategy
): MatchupRound[] {
  return generateRoundRobinCycles(
    teams.map((t) => t.id),
    strategy.gamesPerTeam,
    strategy.localId
  );
}

// ─── Cross-division matchup generation ──────────────────────────────────────

/**
 * Proper edge coloring of the complete bipartite graph between two divisions.
 * For equal sizes n, this yields n rounds of n games (full K_{n,n}).
 */
function bipartiteEdgeColorRounds(
  sideA: number[],
  sideB: number[],
  strategyLocalId: string,
  reverseHomeAway: boolean
): MatchupRound[] {
  if (sideA.length === 0 || sideB.length === 0) return [];

  // Put the larger side on B so each round pairs every A team.
  let A = sideA;
  let B = sideB;
  let swappedSides = false;
  if (A.length > B.length) {
    A = sideB;
    B = sideA;
    swappedSides = true;
  }

  const rounds: MatchupRound[] = [];
  for (let r = 0; r < B.length; r++) {
    const matchups: Matchup[] = [];
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      const b = B[(i + r) % B.length];
      let team1Id = a;
      let team2Id = b;
      if (swappedSides) {
        team1Id = b;
        team2Id = a;
      }
      if (reverseHomeAway) {
        const tmp = team1Id;
        team1Id = team2Id;
        team2Id = tmp;
      }
      matchups.push({ team1Id, team2Id, strategyLocalId });
    }
    rounds.push({ matchups });
  }

  return rounds;
}

/**
 * Organize pairings into rounds with a degree-aware greedy matching.
 * Better packing than a single forward scan for multipartite (3+ divisions).
 */
function organizeIntoRounds(
  pairings: Array<[number, number]>,
  strategyLocalId: string
): MatchupRound[] {
  const rounds: MatchupRound[] = [];
  const remaining = pairings.map(([a, b]) => [a, b] as [number, number]);

  const degree = (edges: Array<[number, number]>, teamId: number): number => {
    let d = 0;
    for (const [a, b] of edges) {
      if (a === teamId || b === teamId) d++;
    }
    return d;
  };

  while (remaining.length > 0) {
    const round: Matchup[] = [];
    const teamsInRound = new Set<number>();

    // Critical vertices (low remaining degree) first → larger matchings.
    remaining.sort((e1, e2) => {
      const c1 = Math.min(degree(remaining, e1[0]), degree(remaining, e1[1]));
      const c2 = Math.min(degree(remaining, e2[0]), degree(remaining, e2[1]));
      if (c1 !== c2) return c1 - c2;
      return e1[0] + e1[1] - (e2[0] + e2[1]);
    });

    const toRemove: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      const [a, b] = remaining[i];
      if (!teamsInRound.has(a) && !teamsInRound.has(b)) {
        round.push({ team1Id: a, team2Id: b, strategyLocalId });
        teamsInRound.add(a);
        teamsInRound.add(b);
        toRemove.push(i);
      }
    }

    for (let i = toRemove.length - 1; i >= 0; i--) {
      remaining.splice(toRemove[i], 1);
    }

    if (round.length > 0) {
      rounds.push({ matchups: round });
    } else {
      break;
    }
  }

  return rounds;
}

/**
 * Generate matchup rounds for a cross-division strategy.
 *
 * `gamesPerTeam` is the number of times each cross-division pair plays when
 * capacity allows the full product. When the strategy's draw slots cannot hold
 * that many games, generation fills up to slot capacity (fill-phase).
 */
function generateCrossDivisionRounds(
  teams: ScheduleTeam[],
  strategy: ScheduleStrategy
): MatchupRound[] {
  const byDivision = new Map<number, number[]>();
  for (const t of teams) {
    const list = byDivision.get(t.divisionId) ?? [];
    list.push(t.id);
    byDivision.set(t.divisionId, list);
  }

  const divisionIds = [...byDivision.keys()].sort((a, b) => a - b);
  if (divisionIds.length < 2) return [];

  const cycles = strategy.gamesPerTeam;
  if (cycles <= 0) return [];

  // Two divisions: proper bipartite edge coloring.
  if (divisionIds.length === 2) {
    const sideA = byDivision.get(divisionIds[0])!;
    const sideB = byDivision.get(divisionIds[1])!;
    const result: MatchupRound[] = [];
    for (let c = 0; c < cycles; c++) {
      result.push(...bipartiteEdgeColorRounds(sideA, sideB, strategy.localId, c % 2 === 1));
    }
    return result;
  }

  // 3+ divisions: all cross edges, degree-aware round packing.
  const allPairings: Array<[number, number]> = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      if (teams[i].divisionId !== teams[j].divisionId) {
        allPairings.push([teams[i].id, teams[j].id]);
      }
    }
  }
  if (allPairings.length === 0) return [];

  const repeatedPairings: Array<[number, number]> = [];
  for (let c = 0; c < cycles; c++) {
    const reverseHomeAway = c % 2 === 1;
    for (const [a, b] of allPairings) {
      repeatedPairings.push(reverseHomeAway ? [b, a] : [a, b]);
    }
  }

  return organizeIntoRounds(repeatedPairings, strategy.localId);
}

function generateStrategyRounds(strategy: ScheduleStrategy, teams: ScheduleTeam[]): MatchupRound[] {
  switch (strategy.pairingMode) {
    case 'intra':
      return generateIntraDivisionRounds(teams, strategy);
    case 'cross':
      return generateCrossDivisionRounds(teams, strategy);
    case 'any':
      return generateAnyPairingRounds(teams, strategy);
  }
}

function generateStrategyRoundsWithCapacity(
  strategy: ScheduleStrategy,
  teams: ScheduleTeam[],
  capacity: number | null,
  byePressureByTeam: Map<number, TeamByePressure> = new Map()
): MatchupRound[] {
  const uncapped = generateStrategyRounds(strategy, teams);
  if (capacity == null) return uncapped;
  return takeUntilCapacity(uncapped, capacity, byePressureByTeam);
}

function buildStrategyByePressure(
  strategy: ScheduleStrategy,
  byeRequests: ScheduleByeRequest[]
): Map<number, TeamByePressure> {
  const strategyDates = new Set(
    strategy.drawSlotKeys.map((key) => key.split('|')[0]).filter((date) => date.length > 0)
  );
  return buildByePressureForDates(strategyDates, byeRequests);
}

function buildByePressureForDates(
  dates: Set<string>,
  byeRequests: ScheduleByeRequest[]
): Map<number, TeamByePressure> {
  const pressure = new Map<number, TeamByePressure>();
  for (const request of byeRequests) {
    if (!dates.has(request.drawDate)) continue;
    const current = pressure.get(request.teamId) ?? {
      p1Count: 0,
      p2Count: 0,
      lowerWeight: 0,
    };
    if (request.priority === 1) current.p1Count++;
    else if (request.priority === 2) current.p2Count++;
    else current.lowerWeight += 100 / request.priority;
    pressure.set(request.teamId, current);
  }
  return pressure;
}

function tagRoundLocalIds(rounds: MatchupRound[]): MatchupRound[] {
  const countsByStrategy = new Map<string, number>();
  return rounds.map((round) => {
    const strategyLocalId = round.matchups[0]?.strategyLocalId ?? 'unknown';
    const roundNumber = countsByStrategy.get(strategyLocalId) ?? 0;
    countsByStrategy.set(strategyLocalId, roundNumber + 1);
    const roundLocalId = `${strategyLocalId}:round-${roundNumber}`;
    return {
      matchups: round.matchups.map((matchup) => ({ ...matchup, roundLocalId })),
    };
  });
}

function capRoundsToSharedPhaseCapacity(
  rounds: MatchupRound[],
  strategies: ScheduleStrategy[],
  sheetsByDrawKey: Map<string, number>,
  byeRequests: ScheduleByeRequest[]
): MatchupRound[] {
  const allowedByStrategy = new Map(
    strategies.map((strategy) => [
      strategy.localId,
      new Set(
        strategy.drawSlotKeys.map((key) => {
          const [date, time] = key.split('|');
          return date && time ? `${date}|${normalizeDrawTime(time)}` : key;
        })
      ),
    ])
  );
  const phaseByStrategy = buildStrategyPhaseMap(allowedByStrategy);
  const allowedByPhase = new Map<string, Set<string>>();
  for (const [strategyLocalId, allowed] of allowedByStrategy) {
    const phaseId = phaseByStrategy.get(strategyLocalId) ?? strategyLocalId;
    const phaseAllowed = allowedByPhase.get(phaseId) ?? new Set<string>();
    for (const key of allowed) phaseAllowed.add(key);
    allowedByPhase.set(phaseId, phaseAllowed);
  }

  const remainingByPhase = new Map<string, number>();
  const byePressureByPhase = new Map<
    string,
    Map<number, TeamByePressure>
  >();
  for (const [phaseId, allowed] of allowedByPhase) {
    let capacity = 0;
    const dates = new Set<string>();
    for (const key of allowed) {
      capacity += sheetsByDrawKey.get(key) ?? 0;
      dates.add(key.split('|')[0]);
    }
    remainingByPhase.set(phaseId, capacity);
    byePressureByPhase.set(
      phaseId,
      buildByePressureForDates(dates, byeRequests)
    );
  }

  const capped: MatchupRound[] = [];
  for (const round of rounds) {
    const strategyLocalId = round.matchups[0]?.strategyLocalId;
    if (!strategyLocalId) continue;
    const phaseId = phaseByStrategy.get(strategyLocalId) ?? strategyLocalId;
    const remaining = remainingByPhase.get(phaseId) ?? 0;
    if (remaining <= 0) continue;
    if (round.matchups.length <= remaining) {
      capped.push(round);
      remainingByPhase.set(phaseId, remaining - round.matchups.length);
      continue;
    }
    const partial = takeUntilCapacity([round], remaining, byePressureByPhase.get(phaseId));
    capped.push(...partial);
    remainingByPhase.set(phaseId, 0);
  }
  return capped;
}

// ─── Strategy interleaving and main entry ───────────────────────────────────

/**
 * Generate all matchup rounds for the given strategies and teams.
 *
 * Strategies are processed in priority order (lower number first).
 * Strategies sharing the same priority are interleaved: one round is taken
 * from each strategy in turn, spreading game types evenly across the schedule.
 *
 * When `drawSlots` is provided, each strategy is capped to its selected sheet
 * capacity (fill-phase): full RR/cross when it fits, otherwise as many games
 * as the draws can hold.
 */
export function generateAllMatchups(
  strategies: ScheduleStrategy[],
  teams: ScheduleTeam[],
  drawSlots?: ScheduleDrawSlot[],
  byeRequests: ScheduleByeRequest[] = []
): MatchupRound[] {
  if (strategies.length === 0 || teams.length < 2) return [];

  const sheetsByDrawKey = drawSlots != null ? buildSheetCapacityByDrawKey(drawSlots) : null;

  // Group strategies by priority
  const priorityGroups = new Map<number, ScheduleStrategy[]>();
  for (const s of strategies) {
    const group = priorityGroups.get(s.priority) ?? [];
    group.push(s);
    priorityGroups.set(s.priority, group);
  }

  // Process groups in ascending priority order
  const sortedPriorities = [...priorityGroups.keys()].sort((a, b) => a - b);

  const allRounds: MatchupRound[] = [];

  for (const priority of sortedPriorities) {
    const group = priorityGroups.get(priority)!;

    const strategyRounds: MatchupRound[][] = group.map((strategy) => {
      const capacity =
        sheetsByDrawKey != null ? strategySlotCapacity(strategy, sheetsByDrawKey) : null;
      return generateStrategyRoundsWithCapacity(
        strategy,
        teams,
        capacity,
        buildStrategyByePressure(strategy, byeRequests)
      );
    });

    const interleaved = interleaveRounds(strategyRounds);
    allRounds.push(...interleaved);
  }

  const capacitySafeRounds =
    sheetsByDrawKey == null
      ? allRounds
      : capRoundsToSharedPhaseCapacity(allRounds, strategies, sheetsByDrawKey, byeRequests);
  return tagRoundLocalIds(capacitySafeRounds);
}

/**
 * Preview per-strategy game counts vs slot capacity (for UI before generate).
 */
export function previewStrategyCapacities(
  strategies: ScheduleStrategy[],
  teams: ScheduleTeam[],
  drawSlots: ScheduleDrawSlot[]
): StrategyCapacityPreview[] {
  if (strategies.length === 0) return [];

  const sheetsByDrawKey = buildSheetCapacityByDrawKey(drawSlots);

  return strategies
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((strategy) => {
      const slotCapacity = strategySlotCapacity(strategy, sheetsByDrawKey);
      const uncapped = generateStrategyRounds(strategy, teams);
      const uncappedGameCount = countMatchups(uncapped);
      const cappedRounds = takeUntilCapacity(uncapped, slotCapacity);
      const gameCount = countMatchups(cappedRounds);
      return {
        strategyLocalId: strategy.localId,
        priority: strategy.priority,
        gameCount,
        slotCapacity,
        uncappedGameCount,
        capped: uncappedGameCount > gameCount,
      };
    });
}

/**
 * Interleave rounds from multiple strategy round lists. Takes one round
 * from each list in turn until all lists are exhausted.
 */
function interleaveRounds(roundLists: MatchupRound[][]): MatchupRound[] {
  const result: MatchupRound[] = [];
  const maxLen = Math.max(0, ...roundLists.map((r) => r.length));

  for (let i = 0; i < maxLen; i++) {
    for (const list of roundLists) {
      if (i < list.length) {
        result.push(list[i]);
      }
    }
  }

  return result;
}
