import { describe, expect, test } from 'bun:test';
import type { GameWithResultValues } from './gameRecord.js';
import {
  compareRankingKeys,
  compareTiebreakerValues,
  h2hTwoTeams,
  rankDivisionTeams,
  type RankingOptions,
  type StandingTeamInput,
} from './standingsRank.js';

function team(
  teamId: number,
  values: number[],
  gamesPlayed: number,
  extra?: Partial<StandingTeamInput>
): StandingTeamInput {
  return {
    teamId,
    teamName: extra?.teamName ?? `Team ${teamId}`,
    values,
    gamesPlayed,
    wins: extra?.wins ?? 0,
    losses: extra?.losses ?? 0,
    ties: extra?.ties ?? 0,
  };
}

function game(
  team1Id: number,
  team2Id: number,
  team1Values: number[],
  team2Values: number[]
): GameWithResultValues {
  return {
    team1_id: team1Id,
    team2_id: team2Id,
    team1_values: team1Values,
    team2_values: team2Values,
  };
}

const totalNoH2h: RankingOptions = {
  headToHeadFirst: false,
  pointsPossiblePerGame: null,
  rankBy: 'total',
};

const totalH2h: RankingOptions = {
  headToHeadFirst: true,
  pointsPossiblePerGame: null,
  rankBy: 'total',
};

describe('compareTiebreakerValues', () => {
  test('ranks higher primary points ahead', () => {
    expect(compareTiebreakerValues([8], [6])).toBeLessThan(0);
    expect(compareTiebreakerValues([6], [8])).toBeGreaterThan(0);
  });

  test('uses later columns when the first values match', () => {
    expect(compareTiebreakerValues([6, 12], [6, 10])).toBeLessThan(0);
  });
});

describe('compareRankingKeys', () => {
  test('ranks by percentage of points possible when enabled', () => {
    const options: RankingOptions = {
      headToHeadFirst: false,
      pointsPossiblePerGame: 2,
      rankBy: 'percentage',
    };
    expect(
      compareRankingKeys({ values: [4], gamesPlayed: 5 }, { values: [6], gamesPlayed: 10 }, options)
    ).toBeLessThan(0);
    expect(
      compareRankingKeys({ values: [8], gamesPlayed: 10 }, { values: [4], gamesPlayed: 5 }, options)
    ).toBe(0);
  });

  test('falls back to total points when percentage ranking is off', () => {
    const options: RankingOptions = {
      headToHeadFirst: false,
      pointsPossiblePerGame: 2,
      rankBy: 'total',
    };
    expect(
      compareRankingKeys({ values: [6], gamesPlayed: 10 }, { values: [4], gamesPlayed: 5 }, options)
    ).toBeLessThan(0);
  });
});

describe('h2hTwoTeams', () => {
  test('uses the combined result of every game between the two teams', () => {
    const games = [game(1, 2, [1], [0]), game(2, 1, [1], [0])];
    expect(h2hTwoTeams(1, 2, games)).toBe(0);
    expect(h2hTwoTeams(1, 2, [game(1, 2, [1], [0]), game(1, 2, [1], [0])])).toBeGreaterThan(0);
  });
});

describe('rankDivisionTeams', () => {
  test('gives different ranks when H2H resolves a two-team points tie', () => {
    const rows = rankDivisionTeams(
      [team(1, [6], 3, { teamName: 'Rocks' }), team(2, [6], 3, { teamName: 'Sweepers' })],
      [game(2, 1, [1], [0])],
      totalH2h
    );
    expect(rows.map((row) => ({ id: row.teamId, rank: row.rank }))).toEqual([
      { id: 2, rank: 1 },
      { id: 1, rank: 2 },
    ]);
    expect(rows[0]?.h2hResult).toBe('win');
    expect(rows[0]?.h2hOpponentName).toBe('Rocks');
    expect(rows[0]?.h2hPairIndex).toBe(0);
    expect(rows[1]?.h2hResult).toBe('loss');
    expect(rows[1]?.h2hOpponentName).toBe('Sweepers');
    expect(rows[1]?.h2hPairIndex).toBe(0);
  });

  test('keeps the same rank when H2H is disabled', () => {
    const rows = rankDivisionTeams(
      [team(1, [6], 3), team(2, [6], 3)],
      [game(2, 1, [1], [0])],
      totalNoH2h
    );
    expect(rows.map((row) => row.rank)).toEqual([1, 1]);
    const byId = new Map(rows.map((row) => [row.teamId, row]));
    expect(byId.get(2)?.h2hResult).toBe('win');
    expect(byId.get(2)?.h2hOpponentName).toBe('Team 1');
    expect(byId.get(2)?.h2hPairIndex).toBe(0);
    expect(byId.get(1)?.h2hResult).toBe('loss');
    expect(byId.get(1)?.h2hOpponentName).toBe('Team 2');
    expect(byId.get(1)?.h2hPairIndex).toBe(0);
  });

  test('keeps the same rank when two teams have not played', () => {
    const rows = rankDivisionTeams([team(1, [6], 3), team(2, [6], 3)], [], totalH2h);
    expect(rows.map((row) => row.rank)).toEqual([1, 1]);
    expect(rows.map((row) => row.h2hResult)).toEqual([null, null]);
  });

  test('labels the adjacent pair that has a decisive H2H in a larger points group', () => {
    const rows = rankDivisionTeams(
      [team(1, [6], 3), team(2, [6], 3), team(3, [6], 3)],
      [game(1, 2, [1], [0])],
      totalH2h
    );
    const byId = new Map(rows.map((row) => [row.teamId, row]));
    expect(byId.get(1)?.h2hResult).toBe('win');
    expect(byId.get(1)?.h2hOpponentName).toBe('Team 2');
    expect(byId.get(1)?.h2hPairIndex).toBe(0);
    expect(byId.get(2)?.h2hResult).toBe('loss');
    expect(byId.get(2)?.h2hOpponentName).toBe('Team 1');
    expect(byId.get(2)?.h2hPairIndex).toBe(0);
    expect(byId.get(3)?.h2hResult).toBeNull();
  });

  test('ranks a team that beat both tied opponents ahead of the remaining pair', () => {
    const rows = rankDivisionTeams(
      [team(1, [4], 3), team(2, [4], 3), team(3, [4], 3)],
      [game(1, 2, [1], [0]), game(1, 3, [1], [0]), game(2, 3, [1], [0])],
      totalH2h
    );
    expect(rows.map((row) => ({ id: row.teamId, rank: row.rank }))).toEqual([
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
      { id: 3, rank: 3 },
    ]);
  });

  test('leaves a circular three-team H2H tied', () => {
    const rows = rankDivisionTeams(
      [team(1, [4], 3), team(2, [4], 3), team(3, [4], 3)],
      [game(1, 2, [1], [0]), game(2, 3, [1], [0]), game(3, 1, [1], [0])],
      totalH2h
    );
    expect(rows.map((row) => row.rank)).toEqual([1, 1, 1]);
  });

  test('ranks by percentage when that setting is on', () => {
    const rows = rankDivisionTeams(
      [team(1, [6], 10), team(2, [4], 5)],
      [],
      { headToHeadFirst: false, pointsPossiblePerGame: 2, rankBy: 'percentage' }
    );
    expect(rows.map((row) => ({ id: row.teamId, rank: row.rank }))).toEqual([
      { id: 2, rank: 1 },
      { id: 1, rank: 2 },
    ]);
  });

  test('uses H2H after a percentage tie', () => {
    const rows = rankDivisionTeams(
      [team(1, [8], 10, { teamName: 'A' }), team(2, [4], 5, { teamName: 'B' })],
      [game(2, 1, [1], [0])],
      { headToHeadFirst: true, pointsPossiblePerGame: 2, rankBy: 'percentage' }
    );
    expect(rows.map((row) => ({ id: row.teamId, rank: row.rank }))).toEqual([
      { id: 2, rank: 1 },
      { id: 1, rank: 2 },
    ]);
    expect(rows[0]?.h2hResult).toBe('win');
    expect(rows[0]?.h2hOpponentName).toBe('A');
    expect(rows[1]?.h2hResult).toBe('loss');
    expect(rows[1]?.h2hOpponentName).toBe('B');
  });

  test('does not label H2H when percentage ranking is on and totals match but percentages do not', () => {
    const rows = rankDivisionTeams(
      [team(1, [8], 10, { teamName: 'A' }), team(2, [8], 8, { teamName: 'B' })],
      [game(2, 1, [1], [0])],
      { headToHeadFirst: true, pointsPossiblePerGame: 2, rankBy: 'percentage' }
    );
    expect(rows.map((row) => ({ id: row.teamId, pctPoints: row.tiebreakerValues[0], result: row.h2hResult }))).toEqual([
      { id: 2, pctPoints: 8, result: null },
      { id: 1, pctPoints: 8, result: null },
    ]);
  });

  test('assigns matching pair indexes to each H2H pair', () => {
    const rows = rankDivisionTeams(
      [team(1, [6], 3), team(2, [6], 3), team(3, [4], 3), team(4, [4], 3)],
      [game(1, 2, [1], [0]), game(4, 3, [1], [0])],
      totalH2h
    );
    const byId = new Map(rows.map((row) => [row.teamId, row]));
    expect(byId.get(1)?.h2hPairIndex).toBe(byId.get(2)?.h2hPairIndex);
    expect(byId.get(3)?.h2hPairIndex).toBe(byId.get(4)?.h2hPairIndex);
    expect(byId.get(1)?.h2hPairIndex).not.toBe(byId.get(3)?.h2hPairIndex);
  });

  test('keeps the same rank on a percentage tie and lists the team with more total points first', () => {
    const rows = rankDivisionTeams(
      [team(1, [4], 5), team(2, [8], 10)],
      [],
      { headToHeadFirst: true, pointsPossiblePerGame: 2, rankBy: 'percentage' }
    );
    expect(rows.map((row) => ({ id: row.teamId, rank: row.rank, points: row.tiebreakerValues[0] }))).toEqual([
      { id: 2, rank: 1, points: 8 },
      { id: 1, rank: 1, points: 4 },
    ]);
  });
});
