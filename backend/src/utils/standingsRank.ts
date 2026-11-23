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

export type H2hBadge = {
  result: H2hResult;
  opponentName: string;
  pairIndex: number;
};

export type RankedStandingRow = {
  rank: number;
  teamId: number;
  teamName: string | null;
  tiebreakerValues: number[];
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  h2hResults: H2hBadge[];
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

/**
 * Among tied teams, counts how many teams rank ahead of each team via head-to-head.
 * A team is ahead when it beat the other team directly or through a chain of H2H wins
 * (A beat B, B beat C puts A ahead of C). Teams in an H2H cycle, or with no connecting
 * results, do not rank ahead of each other.
 */
export function countH2hTeamsAhead(
  teamIds: number[],
  gameResults: GameWithResultValues[]
): Map<number, number> {
  const n = teamIds.length;
  const reach: boolean[][] = teamIds.map(() => teamIds.map(() => false));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const h = h2hTwoTeams(teamIds[i]!, teamIds[j]!, gameResults);
      if (h > 0) reach[i]![j] = true;
      else if (h < 0) reach[j]![i] = true;
    }
  }
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      if (!reach[i]![k]) continue;
      for (let j = 0; j < n; j++) {
        if (reach[k]![j]) reach[i]![j] = true;
      }
    }
  }
  const ahead = new Map<number, number>();
  for (let j = 0; j < n; j++) {
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (i !== j && reach[i]![j] && !reach[j]![i]) count++;
    }
    ahead.set(teamIds[j]!, count);
  }
  return ahead;
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
  gameResults: GameWithResultValues[]
): Array<{ row: RankedStandingRow; opponent: RankedStandingRow; result: H2hResult }> {
  const assignments: Array<{ row: RankedStandingRow; opponent: RankedStandingRow; result: H2hResult }> = [];
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i]!;
      const b = group[j]!;
      const h = h2hTwoTeams(a.teamId, b.teamId, gameResults);
      if (h === 0) continue;
      assignments.push({ row: a, opponent: b, result: h > 0 ? 'win' : 'loss' });
      assignments.push({ row: b, opponent: a, result: h > 0 ? 'loss' : 'win' });
    }
  }
  return assignments;
}

function attachH2hLabels(
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

  const assignments = [...byTieKey.values()].flatMap((group) => collectH2hAssignments(group, gameResults));
  const pairOrder: string[] = [];
  for (const assignment of assignments) {
    const key = pairKey(assignment.row.teamId, assignment.opponent.teamId);
    if (!pairOrder.includes(key)) pairOrder.push(key);
  }

  for (const assignment of assignments) {
    const key = pairKey(assignment.row.teamId, assignment.opponent.teamId);
    assignment.row.h2hResults.push({
      result: assignment.result,
      opponentName: teamDisplayName(assignment.opponent),
      pairIndex: pairOrder.indexOf(key) % 4,
    });
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

  // Orders teams that share a rank; never changes the rank number itself.
  const compareWithinRank = (a: Row, b: Row): number => {
    if (usesPercentageRanking(options)) {
      const points = (b.sums.values[0] ?? 0) - (a.sums.values[0] ?? 0);
      if (points !== 0) return points;
    }
    return a.team.losses - b.team.losses;
  };

  withSums.sort((a, b) => compareRankingKeys(a.sums, b.sums, options) || compareWithinRank(a, b));

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
      const ahead = countH2hTeamsAhead(
        g.map((x) => x.team.teamId),
        gameResults
      );
      const groupRows = g
        .map((row) => ({ row, level: ahead.get(row.team.teamId) ?? 0 }))
        .sort((a, b) => a.level - b.level);
      let levelRank = startRank;
      groupRows.forEach((item, i) => {
        if (i > 0 && item.level !== groupRows[i - 1]!.level) levelRank = startRank + i;
        ordered.push(item.row);
        ranks.push(levelRank);
      });
    } else {
      ordered.push(...g);
      for (let i = 0; i < g.length; i++) ranks.push(startRank);
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
    h2hResults: [],
  }));

  attachH2hLabels(rows, gameResults, options);
  return rows;
}
