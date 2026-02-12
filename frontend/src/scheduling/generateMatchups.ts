import type { Matchup, ScheduleStrategy, ScheduleTeam } from './types';

/**
 * A round is a set of matchups where no team appears more than once.
 * Rounds are the natural output of round-robin generation and serve as
 * the scheduling unit when assigning games to draw slots.
 */
export interface MatchupRound {
  matchups: Matchup[];
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

// ─── Intra-division matchup generation ──────────────────────────────────────

/**
 * Generate matchup rounds for an intra-division strategy.
 *
 * `gamesPerTeam` is the number of complete round-robin cycles:
 *  - 1 = single RR (each pair plays once)
 *  - 2 = double RR (each pair plays twice)
 *  - etc.
 */
function generateIntraDivisionRounds(
  teams: ScheduleTeam[],
  strategy: ScheduleStrategy,
): MatchupRound[] {
  const divisionTeams = teams.filter((t) => t.divisionId === strategy.divisionId);
  if (divisionTeams.length < 2) return [];

  const teamIds = divisionTeams.map((t) => t.id);
  const fullRounds = circleRoundRobin(teamIds);
  const cycles = strategy.gamesPerTeam;

  if (cycles <= 0) return [];

  const result: MatchupRound[] = [];
  for (let c = 0; c < cycles; c++) {
    for (const round of fullRounds) {
      result.push({
        matchups: round.matchups.map((m) => ({
          ...m,
          strategyLocalId: strategy.localId,
        })),
      });
    }
  }

  return result;
}

// ─── Cross-division matchup generation ──────────────────────────────────────

/**
 * Generate matchup rounds for a cross-division strategy.
 *
 * `gamesPerTeam` is the number of times each cross-division pair plays:
 *  - 1 = each team plays every opponent from other divisions once
 *  - 2 = each team plays every cross-division opponent twice
 *  - etc.
 */
function generateCrossDivisionRounds(
  teams: ScheduleTeam[],
  strategy: ScheduleStrategy,
): MatchupRound[] {
  const divisionIds = [...new Set(teams.map((t) => t.divisionId))];
  if (divisionIds.length < 2) return [];

  // Build all possible cross-division pairings
  const allPairings: Array<[number, number]> = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      if (teams[i].divisionId !== teams[j].divisionId) {
        allPairings.push([teams[i].id, teams[j].id]);
      }
    }
  }

  if (allPairings.length === 0) return [];

  // Repeat all pairings for each cycle
  const repeatedPairings: Array<[number, number]> = [];
  for (let c = 0; c < strategy.gamesPerTeam; c++) {
    repeatedPairings.push(...allPairings);
  }

  return organizeIntoRounds(repeatedPairings, strategy.localId);
}

/**
 * Organize a flat list of pairings into rounds where no team appears twice.
 * Uses a simple greedy approach.
 */
function organizeIntoRounds(
  pairings: Array<[number, number]>,
  strategyLocalId: string,
): MatchupRound[] {
  const rounds: MatchupRound[] = [];
  const remaining = [...pairings];

  while (remaining.length > 0) {
    const round: Matchup[] = [];
    const teamsInRound = new Set<number>();
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

    // Remove assigned pairings in reverse order to preserve indices
    for (let i = toRemove.length - 1; i >= 0; i--) {
      remaining.splice(toRemove[i], 1);
    }

    if (round.length > 0) {
      rounds.push({ matchups: round });
    } else {
      // Safety: avoid infinite loop if no pairing can be placed
      break;
    }
  }

  return rounds;
}

// ─── Strategy interleaving and main entry ───────────────────────────────────

/**
 * Generate all matchup rounds for the given strategies and teams.
 *
 * Strategies are processed in priority order (lower number first).
 * Strategies sharing the same priority are interleaved: one round is taken
 * from each strategy in turn, spreading game types evenly across the schedule.
 */
export function generateAllMatchups(
  strategies: ScheduleStrategy[],
  teams: ScheduleTeam[],
): MatchupRound[] {
  if (strategies.length === 0 || teams.length < 2) return [];

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

    // Generate rounds for each strategy in this priority group
    const strategyRounds: MatchupRound[][] = group.map((strategy) => {
      if (strategy.isIntraDivision) {
        return generateIntraDivisionRounds(teams, strategy);
      } else {
        return generateCrossDivisionRounds(teams, strategy);
      }
    });

    // Interleave rounds from same-priority strategies
    const interleaved = interleaveRounds(strategyRounds);
    allRounds.push(...interleaved);
  }

  return allRounds;
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
