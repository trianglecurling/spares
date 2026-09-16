import { describe, expect, test } from 'bun:test';
import { accumulateStandingSums, outcomeFromFirstTiebreaker, tallyTeamRecord } from './gameRecord.js';

describe('outcomeFromFirstTiebreaker', () => {
  test('returns null when neither team has a recorded result', () => {
    expect(outcomeFromFirstTiebreaker([], [])).toBeNull();
  });

  test('counts a recorded 0–0 as a tie', () => {
    expect(outcomeFromFirstTiebreaker([0], [0])).toBe('tie');
  });

  test('counts a win and a loss from the first tiebreaker', () => {
    expect(outcomeFromFirstTiebreaker([8], [4])).toBe('win');
    expect(outcomeFromFirstTiebreaker([4], [8])).toBe('loss');
  });
});

describe('tallyTeamRecord', () => {
  test('ignores scheduled games that have no results', () => {
    const games = [
      { id: 1, team1_id: 10, team2_id: 20 },
      { id: 2, team1_id: 10, team2_id: 30 },
      { id: 3, team1_id: 40, team2_id: 10 },
    ];

    expect(tallyTeamRecord(10, games, new Map())).toEqual({
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      ties: 0,
    });
  });

  test('counts only games with recorded results', () => {
    const games = [
      { id: 1, team1_id: 10, team2_id: 20 },
      { id: 2, team1_id: 10, team2_id: 30 },
      { id: 3, team1_id: 40, team2_id: 10 },
    ];
    const resultsByGame = new Map<number, Map<number, number[]>>([
      [1, new Map([[10, [7]], [20, [5]]])],
      [3, new Map([[40, [6]], [10, [6]]])],
    ]);

    expect(tallyTeamRecord(10, games, resultsByGame)).toEqual({
      gamesPlayed: 2,
      wins: 1,
      losses: 0,
      ties: 1,
    });
  });
});

describe('accumulateStandingSums', () => {
  test('does not count games that have no recorded results', () => {
    const sums = accumulateStandingSums([
      { team1_id: 10, team2_id: 20, team1_values: [], team2_values: [] },
      { team1_id: 10, team2_id: 30, team1_values: [7], team2_values: [5] },
      { team1_id: 10, team2_id: 40, team1_values: [], team2_values: [] },
    ]);

    expect(sums.get(10)).toEqual({ values: [7], gamesPlayed: 1 });
    expect(sums.get(20)).toBeUndefined();
    expect(sums.get(30)).toEqual({ values: [5], gamesPlayed: 1 });
    expect(sums.get(40)).toBeUndefined();
  });

  test('increments games played for both teams when a result exists', () => {
    const sums = accumulateStandingSums([
      { team1_id: 10, team2_id: 20, team1_values: [1], team2_values: [0] },
      { team1_id: 10, team2_id: 30, team1_values: [0], team2_values: [1] },
    ]);

    expect(sums.get(10)).toEqual({ values: [1], gamesPlayed: 2 });
    expect(sums.get(20)).toEqual({ values: [0], gamesPlayed: 1 });
    expect(sums.get(30)).toEqual({ values: [1], gamesPlayed: 1 });
  });
});
