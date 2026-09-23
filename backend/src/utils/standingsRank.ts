import type { GameWithResultValues, StandingSums } from './gameRecord.js';

export type RankBy = 'total' | 'percentage';

export type RankingOptions = {
  headToHeadFirst: boolean;
  pointsPossiblePerGame: number | null;
  rankBy: RankBy;
};

export type StandingTeamInput = {
  teamId: number;
  teamName: string | null;
  values: number[];
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
};

export type H2hResult = 'win' | 'loss';

export type RankedStandingRow = {
  rank: number;
  teamId: number;
  teamName: string | null;
  tiebreakerValues: number[];
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  h2hResult: H2hResult | null;
  h2hOpponentName: string | null;
  h2hPairIndex: number | null;
};

/**
 * Compare two tiebreaker value arrays. Higher values rank better.
 * Returns negative if a ranks ahead of b, positive if b ranks ahead, 0 if equal.
 */
export function compareTiebreakerValues(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (va !== vb) return vb - va;
  }
  return 0;
}

export function usesPercentageRanking(options: RankingOptions): boolean {
  return options.rankBy === 'percentage' && (options.pointsPossiblePerGame ?? 0) > 0;
}

function comparePrimaryPercentage(
  a: { values: number[]; gamesPlayed: number },
  b: { values: number[]; gamesPlayed: number },
  pointsPossiblePerGame: number
): number {
  const aPoints = a.values[0] ?? 0;
  const bPoints = b.values[0] ?? 0;
  const aPossible = a.gamesPlayed * pointsPossiblePerGame;
  const bPossible = b.gamesPlayed * pointsPossiblePerGame;
  if (aPossible === 0 && bPossible === 0) return 0;
  if (aPossible === 0) return 1;
  if (bPossible === 0) return -1;
  const aNum = aPoints * bPossible;
  const bNum = bPoints * aPossible;
  if (aNum !== bNum) return bNum - aNum;
  return 0;
}

export function compareRankingKeys(
  a: { values: number[]; gamesPlayed: number },
  b: { values: number[]; gamesPlayed: number },
  options: RankingOptions
): number {
  if (usesPercentageRanking(options) && options.pointsPossiblePerGame != null) {
    return comparePrimaryPercentage(a, b, options.pointsPossiblePerGame);
  }
  return compareTiebreakerValues(a.values, b.values);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function rankingGroupKey(
  sums: { values: number[]; gamesPlayed: number },
  options: RankingOptions
): string {
  if (usesPercentageRanking(options) && options.pointsPossiblePerGame != null) {
    const points = sums.values[0] ?? 0;
    const possible = sums.gamesPlayed * options.pointsPossiblePerGame;
    if (possible === 0) return '0/0';
    const divisor = gcd(points, possible);
    return `${points / divisor}/${possible / divisor}`;
  }
  return sums.values.join(',');
}

function h2hLabelTieKey(
  sums: { values: number[]; gamesPlayed: number },
  options: RankingOptions
): string {
  const points = sums.values[0] ?? 0;
  if (usesPercentageRanking(options) && options.pointsPossiblePerGame != null) {
    const possible = sums.gamesPlayed * options.pointsPossiblePerGame;
    if (possible === 0) return '0/0';
    const divisor = gcd(points, possible);
    return `${points / divisor}/${possible / divisor}`;
  }
  return String(points);
}

/**
 * Head-to-head between two teams across all recorded games between them.
 * Positive if teamA ranks ahead of teamB, negative if B ranks ahead, 0 if none or tied.
 */
export function h2hTwoTeams(teamA: number, teamB: number, gameResults: GameWithResultValues[]): number {
  const idA = Number(teamA);
  const idB = Number(teamB);
  let aValues: number[] = [];
  let bValues: number[] = [];
  let found = false;
  for (const game of gameResults) {
    const team1Id = Number(game.team1_id);
    const team2Id = Number(game.team2_id);
    const aIsTeam1 = team1Id === idA && team2Id === idB;
    const aIsTeam2 = team1Id === idB && team2Id === idA;
    if (!aIsTeam1 && !aIsTeam2) continue;
    found = true;
    const aGameValues = aIsTeam1 ? game.team1_values : game.team2_values;
    const bGameValues = aIsTeam1 ? game.team2_values : game.team1_values;
    const len = Math.max(aValues.length, bValues.length, aGameValues.length, bGameValues.length);
    for (let i = 0; i < len; i++) {
      while (aValues.length <= i) aValues.push(0);
      while (bValues.length <= i) bValues.push(0);
      aValues[i] = (aValues[i] ?? 0) + (aGameValues[i] ?? 0);
      bValues[i] = (bValues[i] ?? 0) + (bGameValues[i] ?? 0);
    }
  }
  if (!found) return 0;
  const cmp = compareTiebreakerValues(aValues, bValues);
  if (cmp === 0) return 0;
  return -cmp;
}

export function countH2hWins(
  teamIds: number[],
  gameResults: GameWithResultValues[]
): Map<number, number> {
  const wins = new Map<number, number>();
  for (const id of teamIds) wins.set(id, 0);
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      const a = teamIds[i]!;
      const b = teamIds[j]!;
      const h = h2hTwoTeams(a, b, gameResults);
      if (h > 0) wins.set(a, (wins.get(a) ?? 0) + 1);
      else if (h < 0) wins.set(b, (wins.get(b) ?? 0) + 1);
    }
  }
  return wins;
}

/**
 * Among tied teams, apply head-to-head. Returns ordering: first element is highest rank.
 */
export function orderByHeadToHead(teamIds: number[], gameResults: GameWithResultValues[]): number[] {
  if (teamIds.length <= 1) return teamIds;

  const wins = countH2hWins(teamIds, gameResults);
  const sorted = [...teamIds].sort((a, b) => (wins.get(b) ?? 0) - (wins.get(a) ?? 0));
  const maxWins = wins.get(sorted[0]!) ?? 0;
  if (maxWins === 0) return teamIds;

  const first = sorted.filter((id) => (wins.get(id) ?? 0) === maxWins);
  const rest = teamIds.filter((id) => !first.includes(id));
  if (rest.length === 0) return first;
  return [...first, ...orderByHeadToHead(rest, gameResults)];
}

function teamDisplayName(row: RankedStandingRow): string {
  return row.teamName?.trim() ? row.teamName : `Team ${row.teamId}`;
}

export function formatH2hTooltip(result: H2hResult, opponentTeamName: string): string {
  return result === 'win' ? `H2H win vs. ${opponentTeamName}` : `H2H loss vs. ${opponentTeamName}`;
}

function pairKey(teamA: number, teamB: number): string {
  return teamA < teamB ? `${teamA}:${teamB}` : `${teamB}:${teamA}`;
}

function collectH2hAssignments(
  group: RankedStandingRow[],
  allRows: RankedStandingRow[],
  gameResults: GameWithResultValues[]
): Array<{ row: RankedStandingRow; opponent: RankedStandingRow; result: H2hResult }> {
  if (group.length < 2) return [];
  const assignments: Array<{ row: RankedStandingRow; opponent: RankedStandingRow; result: H2hResult }> = [];
  for (const row of group) {
    const opponents = group.filter(
      (other) => other.teamId !== row.teamId && h2hTwoTeams(row.teamId, other.teamId, gameResults) !== 0
    );
    if (opponents.length === 0) continue;
    const rowIndex = allRows.indexOf(row);
    const opponent = opponents
      .slice()
      .sort((a, b) => Math.abs(allRows.indexOf(a) - rowIndex) - Math.abs(allRows.indexOf(b) - rowIndex))[0]!;
    const h = h2hTwoTeams(row.teamId, opponent.teamId, gameResults);
    assignments.push({ row, opponent, result: h > 0 ? 'win' : 'loss' });
  }
  return assignments;
}

function attachTwoTeamH2hLabels(
  rows: RankedStandingRow[],
  gameResults: GameWithResultValues[],
  options: RankingOptions
): void {
  const byTieKey = new Map<string, RankedStandingRow[]>();
  for (const row of rows) {
    const key = h2hLabelTieKey(
      { values: row.tiebreakerValues, gamesPlayed: row.gamesPlayed },
      options
    );
    const group = byTieKey.get(key) ?? [];
    group.push(row);
    byTieKey.set(key, group);
  }

  const assignments = [...byTieKey.values()].flatMap((group) =>
    collectH2hAssignments(group, rows, gameResults)
  );
  const pairOrder: string[] = [];
  for (const assignment of assignments) {
    const key = pairKey(assignment.row.teamId, assignment.opponent.teamId);
    if (!pairOrder.includes(key)) pairOrder.push(key);
  }

  for (const assignment of assignments) {
    const key = pairKey(assignment.row.teamId, assignment.opponent.teamId);
    assignment.row.h2hResult = assignment.result;
    assignment.row.h2hOpponentName = teamDisplayName(assignment.opponent);
    assignment.row.h2hPairIndex = pairOrder.indexOf(key) % 4;
  }
}

export function rankDivisionTeams(
  teams: StandingTeamInput[],
  gameResults: GameWithResultValues[],
  options: RankingOptions
): RankedStandingRow[] {
  type Row = { team: StandingTeamInput; sums: StandingSums };
  const withSums: Row[] = teams.map((team) => ({
    team,
    sums: { values: team.values, gamesPlayed: team.gamesPlayed },
  }));

  const compareTotalPoints = (a: Row, b: Row): number =>
    (b.sums.values[0] ?? 0) - (a.sums.values[0] ?? 0);

  withSums.sort((a, b) => {
    const cmp = compareRankingKeys(a.sums, b.sums, options);
    if (cmp !== 0) return cmp;
    if (options.headToHeadFirst) {
      const ordered = orderByHeadToHead([a.team.teamId, b.team.teamId], gameResults);
      const h2hCmp = ordered.indexOf(a.team.teamId) - ordered.indexOf(b.team.teamId);
      if (h2hCmp !== 0) return h2hCmp;
    }
    if (usesPercentageRanking(options)) return compareTotalPoints(a, b);
    return 0;
  });

  const groups: Row[][] = [];
  let prevKey: string | null = null;
  let group: Row[] = [];
  for (const row of withSums) {
    const key = rankingGroupKey(row.sums, options);
    if (key !== prevKey) {
      if (group.length > 0) groups.push(group);
      group = [row];
      prevKey = key;
    } else {
      group.push(row);
    }
  }
  if (group.length > 0) groups.push(group);

  const ordered: Row[] = [];
  const ranks: number[] = [];
  let nextIndex = 0;
  for (const g of groups) {
    const startRank = nextIndex + 1;
    if (options.headToHeadFirst && g.length > 1) {
      const ids = g.map((x) => x.team.teamId);
      const wins = countH2hWins(ids, gameResults);
      const h2hOrdered = orderByHeadToHead(ids, gameResults);
      const byId = new Map(g.map((x) => [x.team.teamId, x]));
      const groupRows = h2hOrdered
        .map((id) => {
          const row = byId.get(id);
          if (!row) return null;
          const moreWins = ids.filter((other) => (wins.get(other) ?? 0) > (wins.get(id) ?? 0)).length;
          return { row, rank: startRank + moreWins };
        })
        .filter((item): item is { row: Row; rank: number } => item != null);
      if (usesPercentageRanking(options)) {
        groupRows.sort((a, b) => a.rank - b.rank || compareTotalPoints(a.row, b.row));
      }
      for (const item of groupRows) {
        ordered.push(item.row);
        ranks.push(item.rank);
      }
    } else {
      const groupRows = usesPercentageRanking(options) ? [...g].sort(compareTotalPoints) : g;
      ordered.push(...groupRows);
      for (let i = 0; i < groupRows.length; i++) ranks.push(startRank);
    }
    nextIndex += g.length;
  }

  const rows: RankedStandingRow[] = ordered.map((x, idx) => ({
    rank: ranks[idx] ?? idx + 1,
    teamId: x.team.teamId,
    teamName: x.team.teamName,
    tiebreakerValues: x.sums.values,
    gamesPlayed: x.sums.gamesPlayed,
    wins: x.team.wins,
    losses: x.team.losses,
    ties: x.team.ties,
    h2hResult: null,
    h2hOpponentName: null,
    h2hPairIndex: null,
  }));

  attachTwoTeamH2hLabels(rows, gameResults, options);
  return rows;
}
