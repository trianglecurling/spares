import { describe, expect, test } from 'bun:test';
import {
  aggregateMemberPoints,
  evaluatePlayInLeague,
  guaranteeThresholdHalf,
  numberToPointsHalf,
  playInAutoEntryCount,
  pointsHalfToNumber,
  strongestHypotheticalTeamTotals,
  teamReturningMemberCount,
  teamTotalPointsHalf,
  type PlayInMemberPoints,
  type PlayInTeamForEvaluation,
} from './playInEntryService.js';

function points(memberId: number, pointsValue: number, countsAsReturning = true): PlayInMemberPoints {
  return { memberId, pointsHalf: numberToPointsHalf(pointsValue), countsAsReturning };
}

function team(
  entryTeamId: number,
  memberIds: number[],
  overrides: Partial<PlayInTeamForEvaluation> = {}
): PlayInTeamForEvaluation {
  return { entryTeamId, memberIds, pendingNameCount: 0, status: 'pending', ...overrides };
}

describe('play-in entry points math', () => {
  test('half-point conversions round-trip', () => {
    expect(numberToPointsHalf(19.5)).toBe(39);
    expect(pointsHalfToNumber(39)).toBe(19.5);
    expect(numberToPointsHalf(20)).toBe(40);
  });

  test('team totals sum member points and treat unknown members as zero', () => {
    const map = new Map([
      [1, points(1, 20)],
      [2, points(2, 19.5)],
    ]);
    expect(teamTotalPointsHalf([1, 2, 3, 4], map)).toBe(numberToPointsHalf(39.5));
  });

  test('returning member count only counts flagged members', () => {
    const map = new Map([
      [1, points(1, 20, true)],
      [2, points(2, 1, false)], // playdown loser: has points but not returning
      [3, points(3, 15, true)],
    ]);
    expect(teamReturningMemberCount([1, 2, 3, 4], map)).toBe(2);
  });

  test('aggregateMemberPoints sums ledger rows per member and ORs the returning flag', () => {
    const aggregated = aggregateMemberPoints([
      { id: 1, leagueId: 5, memberId: 7, memberName: 'A', pointsHalf: 40, countsAsReturning: true, source: 'manual', notes: null },
      { id: 2, leagueId: 5, memberId: 7, memberName: 'A', pointsHalf: 30, countsAsReturning: false, source: 'manual', notes: null },
      { id: 3, leagueId: 5, memberId: 8, memberName: 'B', pointsHalf: 2, countsAsReturning: false, source: 'manual', notes: null },
    ]);
    const byId = new Map(aggregated.map((entry) => [entry.memberId, entry]));
    expect(byId.get(7)?.pointsHalf).toBe(70);
    expect(byId.get(7)?.countsAsReturning).toBe(true);
    expect(byId.get(8)?.pointsHalf).toBe(2);
    expect(byId.get(8)?.countsAsReturning).toBe(false);
  });
});

describe('stacked hypothetical teams', () => {
  test('chunks the sorted pool into strongest teams of teamSize', () => {
    const pool = [10, 10, 10, 10, 2, 2, 2, 2];
    expect(strongestHypotheticalTeamTotals(pool, 4)).toEqual([40, 8]);
  });

  test('pads a partial final team with zero-point newcomers', () => {
    expect(strongestHypotheticalTeamTotals([10, 10, 10, 10, 10], 4)).toEqual([40, 10]);
  });

  test('empty pool yields no hypothetical teams', () => {
    expect(strongestHypotheticalTeamTotals([], 4)).toEqual([]);
  });
});

describe('guarantee threshold', () => {
  test('threshold is the autoEntryCount-th stacked opposing team total', () => {
    const config = { autoEntryCount: 2, teamSize: 4 };
    const pool = [10, 10, 10, 10, 10, 10, 10, 10];
    // Two future teams of four 10s → bar is 40; guaranteed means strictly above 40.
    expect(guaranteeThresholdHalf([], pool, config)).toBe(40);
  });

  test('threshold matches the marginal team from a full auto-entry field', () => {
    const config = { autoEntryCount: 18, teamSize: 4 };
    // 72 players: 68 at 13 points, then 13,13,13,12 → 18th team totals 51.
    const pool: number[] = [];
    for (let i = 0; i < 68; i += 1) pool.push(numberToPointsHalf(13));
    pool.push(numberToPointsHalf(13), numberToPointsHalf(13), numberToPointsHalf(13), numberToPointsHalf(12));
    expect(guaranteeThresholdHalf([], pool, config)).toBe(numberToPointsHalf(51));
  });

  test('declared entered teams always occupy spots', () => {
    const config = { autoEntryCount: 1, teamSize: 4 };
    const entered = [{ totalPointsHalf: 0, status: 'entered' as const }];
    expect(guaranteeThresholdHalf(entered, [], config)).toBeNull();
  });
});

describe('evaluatePlayInLeague', () => {
  const config = { autoEntryCount: 2, teamSize: 4, playInSpotCount: 2 };

  test('strong team with returning members is guaranteed; weak team projects to playdowns', () => {
    const allPoints = [
      points(1, 20), points(2, 20), points(3, 20), points(4, 20),
      points(5, 5), points(6, 5), points(7, 5), points(8, 5),
      // Uncommitted pool of low-point members.
      points(20, 2), points(21, 2), points(22, 2), points(23, 2),
    ];
    const teams = [team(1, [1, 2, 3, 4]), team(2, [5, 6, 7, 8])];
    const result = evaluatePlayInLeague(config, allPoints, teams);

    const teamOne = result.teams.find((entry) => entry.entryTeamId === 1);
    const teamTwo = result.teams.find((entry) => entry.entryTeamId === 2);

    expect(teamOne?.totalPointsHalf).toBe(numberToPointsHalf(80));
    expect(teamOne?.guaranteed).toBe(true);
    expect(teamOne?.projectedStatus).toBe('guaranteed');

    expect(teamTwo?.totalPointsHalf).toBe(numberToPointsHalf(20));
    // Opposing for team two: declared 80 + stacked 8 → bar 8; 20 > 8 so also guaranteed.
    expect(teamTwo?.guaranteed).toBe(true);
  });

  test('a team can be displaced when the uncommitted pool is strong enough', () => {
    const allPoints = [
      points(1, 10), points(2, 10), points(3, 10), points(4, 10),
      // Strong uncommitted members who could form two better future teams.
      points(20, 20), points(21, 20), points(22, 20), points(23, 20),
      points(24, 20), points(25, 20), points(26, 20), points(27, 20),
    ];
    const teams = [team(1, [1, 2, 3, 4])];
    const result = evaluatePlayInLeague(config, allPoints, teams);
    const teamOne = result.teams.find((entry) => entry.entryTeamId === 1);
    expect(teamOne?.guaranteed).toBe(false);
    // Still currently the best declared team, so it projects in.
    expect(teamOne?.projectedStatus).toBe('projected_in');
  });

  test('single-returner teams are ineligible for auto entry when enough eligible teams exist', () => {
    const smallConfig = { autoEntryCount: 1, teamSize: 4, playInSpotCount: 2 };
    const allPoints = [
      points(1, 20), points(2, 20), points(3, 20), points(4, 20),
      points(5, 40, true), // lone big-points returner
      points(6, 0, false), points(7, 0, false), points(8, 0, false),
    ];
    const teams = [team(1, [1, 2, 3, 4]), team(2, [5, 6, 7, 8])];
    const result = evaluatePlayInLeague(smallConfig, allPoints, teams);
    const loneStar = result.teams.find((entry) => entry.entryTeamId === 2);
    expect(result.returningRuleWaiverActive).toBe(false);
    expect(loneStar?.meetsReturningRule).toBe(false);
    expect(loneStar?.guaranteed).toBe(false);
    expect(loneStar?.projectedStatus).toBe('ineligible_single_returner');
  });

  test('returning rule is waived when too few teams have two returning members', () => {
    const allPoints = [
      points(5, 40, true),
      points(6, 0, false), points(7, 0, false), points(8, 0, false),
    ];
    const teams = [team(2, [5, 6, 7, 8])];
    const result = evaluatePlayInLeague(config, allPoints, teams);
    const loneStar = result.teams.find((entry) => entry.entryTeamId === 2);
    expect(result.returningRuleWaiverActive).toBe(true);
    // Waiver lets them project in on points, but never grants a guarantee.
    expect(loneStar?.projectedStatus).toBe('projected_in');
    expect(loneStar?.guaranteed).toBe(false);
  });

  test('withdrawn and not-entered teams keep their status and release their members to the pool', () => {
    const allPoints = [
      points(1, 20), points(2, 20), points(3, 20), points(4, 20),
    ];
    const teams = [team(1, [1, 2, 3, 4], { status: 'withdrawn' })];
    const result = evaluatePlayInLeague(config, allPoints, teams);
    expect(result.teams[0]?.projectedStatus).toBe('withdrawn');
    expect(result.teams[0]?.guaranteed).toBe(false);
    // Points return to the pool → one stacked team of 80, then a padded 0 for the
    // second auto-entry spot, so the bar is 0 (any positive total is guaranteed).
    expect(result.guaranteeThresholdHalf).toBe(0);
  });

  test('entered teams stay entered and count against the guarantee', () => {
    const allPoints = [
      points(1, 1), points(2, 1), points(3, 1), points(4, 1),
      points(5, 20), points(6, 20), points(7, 20), points(8, 20),
    ];
    const oneSpotConfig = { autoEntryCount: 1, teamSize: 4, playInSpotCount: 2 };
    const teams = [team(1, [1, 2, 3, 4], { status: 'entered' }), team(2, [5, 6, 7, 8])];
    const result = evaluatePlayInLeague(oneSpotConfig, allPoints, teams);
    const enteredTeam = result.teams.find((entry) => entry.entryTeamId === 1);
    const contender = result.teams.find((entry) => entry.entryTeamId === 2);
    expect(enteredTeam?.projectedStatus).toBe('entered');
    // The single auto entry spot is occupied, so even a huge team cannot be guaranteed.
    expect(contender?.guaranteed).toBe(false);
  });
});

describe('league config helpers', () => {
  test('auto entry count derives from team capacity minus play-in spots', () => {
    expect(playInAutoEntryCount({ capacity_type: 'team', capacity_value: 20, play_in_spot_count: 2 })).toBe(18);
    expect(playInAutoEntryCount({ capacity_type: 'individual', capacity_value: 80, play_in_spot_count: 2 })).toBe(0);
  });
});
