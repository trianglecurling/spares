import { describe, expect, test } from 'bun:test';
import {
  aggregateMemberPoints,
  canFormTeamsWithMinSum,
  evaluatePlayInLeague,
  guaranteeThresholdHalf,
  numberToPointsHalf,
  playInAutoEntryCount,
  pointsHalfToNumber,
  teamReturningMemberCount,
  teamTotalPointsHalf,
  type PlayInMemberPoints,
  type PlayInTeamForEvaluation,
} from './playInEntryService.js';
import {
  invalidatePlayInEvaluationCache,
  playInEvaluationFingerprint,
} from './playInEvaluationCache.js';

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

  test('pointsHalfToNumber stays JSON-safe for non-numeric ledger values', () => {
    expect(pointsHalfToNumber(Number.NaN)).toBe(0);
    expect(pointsHalfToNumber(Number.POSITIVE_INFINITY)).toBe(0);
    expect(pointsHalfToNumber(undefined as unknown as number)).toBe(0);
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

describe('worst-case opposing team packing', () => {
  test('can form two balanced 64-point teams from four 20s and four 12s', () => {
    const pool = [20, 20, 20, 20, 12, 12, 12, 12];
    expect(canFormTeamsWithMinSum(pool, 4, 2, 64)).toBe(true);
    expect(canFormTeamsWithMinSum(pool, 4, 2, 65)).toBe(false);
  });

  test('pads a short pool with zero-point newcomers', () => {
    // Five 10s split across two teams (with three 0-pads) maximin at 20, not a leftover 10.
    expect(canFormTeamsWithMinSum([10, 10, 10, 10, 10], 4, 2, 20)).toBe(true);
    expect(canFormTeamsWithMinSum([10, 10, 10, 10, 10], 4, 2, 21)).toBe(false);
  });

  test('empty pool can only form zero-point teams', () => {
    expect(canFormTeamsWithMinSum([], 4, 2, 0)).toBe(true);
    expect(canFormTeamsWithMinSum([], 4, 2, 1)).toBe(false);
  });

  test('doubles pairing is strongest-with-weakest, not stacked leftovers', () => {
    const pool = [10, 9, 8, 1];
    expect(canFormTeamsWithMinSum(pool, 2, 2, 11)).toBe(true);
    expect(canFormTeamsWithMinSum(pool, 2, 2, 12)).toBe(false);
  });
});

describe('guarantee threshold', () => {
  test('threshold is the maximin opposing team total, not leftover stacking', () => {
    const config = { autoEntryCount: 2, teamSize: 4 };
    const pool = [20, 20, 20, 20, 12, 12, 12, 12];
    // Consecutive stacking would call the 2nd team 48; two mixed 64-point teams can form.
    expect(guaranteeThresholdHalf([], pool, config)).toBe(64);
  });

  test('uniform remaining players still produce the leftover-chunk total', () => {
    const config = { autoEntryCount: 2, teamSize: 4 };
    const pool = [10, 10, 10, 10, 10, 10, 10, 10];
    expect(guaranteeThresholdHalf([], pool, config)).toBe(40);
  });

  test('threshold matches the marginal team from a full auto-entry field', () => {
    const config = { autoEntryCount: 18, teamSize: 4 };
    // 72 players: 71 at 13 points, one at 12 → one team must take the 12, maximin 51.
    const pool: number[] = [];
    for (let i = 0; i < 68; i += 1) pool.push(numberToPointsHalf(13));
    pool.push(numberToPointsHalf(13), numberToPointsHalf(13), numberToPointsHalf(13), numberToPointsHalf(12));
    expect(guaranteeThresholdHalf([], pool, config)).toBe(numberToPointsHalf(51));
  });

  test('a prior-season TLINE table mixes rather than reconstituting last place', () => {
    const config = { autoEntryCount: 18, teamSize: 4 };
    const placePoints = [20, 19.5, 19, 18.5, 18, 17.5, 17, 16.5, 16, 15.5, 15, 14, 13, 12, 11, 10, 8, 6, 4, 2];
    const pool = placePoints.flatMap((points) => Array.from({ length: 4 }, () => numberToPointsHalf(points)));
    // Leftover stacking of players 69–72 would be four 6s (24). Worst-case mixing is 59.
    expect(guaranteeThresholdHalf([], pool, config)).toBe(numberToPointsHalf(59));
  });

  test('a two-session TLINE pool and many declared teams finish quickly', () => {
    const config = { autoEntryCount: 18, teamSize: 4, playInSpotCount: 2 };
    const placePoints = [20, 19.5, 19, 18.5, 18, 17.5, 17, 16.5, 16, 15.5, 15, 14, 13, 12, 11, 10, 8, 6, 4, 2];
    const allPoints: PlayInMemberPoints[] = [];
    let memberId = 1;
    for (const place of placePoints) {
      for (let copy = 0; copy < 4; copy += 1) {
        allPoints.push(points(memberId, place + place));
        memberId += 1;
      }
    }
    const teams = Array.from({ length: 12 }, (_, index) =>
      team(index + 1, [index * 4 + 1, index * 4 + 2, index * 4 + 3, index * 4 + 4])
    );
    const started = Date.now();
    const result = evaluatePlayInLeague(config, allPoints, teams);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result.guaranteeThresholdHalf).toBeGreaterThan(0);
    expect(result.teams).toHaveLength(12);
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
    // Opposing for team two: declared 80 + one pool team of 8 → bar 8; 20 > 8 so also guaranteed.
    expect(teamTwo?.guaranteed).toBe(true);
  });

  test('incomplete rosters are never guaranteed even with high points', () => {
    const allPoints = [
      points(1, 20), points(2, 20), points(3, 20), points(4, 20),
      points(20, 2), points(21, 2), points(22, 2), points(23, 2),
    ];
    const teams = [team(1, [1, 2], { pendingNameCount: 0 })];
    const result = evaluatePlayInLeague(config, allPoints, teams);
    const incomplete = result.teams.find((entry) => entry.entryTeamId === 1);
    expect(incomplete?.guaranteed).toBe(false);
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
    // Points return to the pool: four 20-point curlers can form two 40-point teams
    // with newcomers, so the bar is 40 rather than a leftover 0.
    expect(result.guaranteeThresholdHalf).toBe(numberToPointsHalf(40));
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

  test('auto entry count stays finite when capacity fields are missing', () => {
    expect(
      playInAutoEntryCount({
        capacity_type: 'team',
        capacity_value: undefined as unknown as number,
        play_in_spot_count: undefined as unknown as number,
      }),
    ).toBe(0);
  });
});

describe('play-in evaluation cache', () => {
  const config = { autoEntryCount: 18, teamSize: 4, playInSpotCount: 2 };

  function twoSessionFixture() {
    const placePoints = [20, 19.5, 19, 18.5, 18, 17.5, 17, 16.5, 16, 15.5, 15, 14, 13, 12, 11, 10, 8, 6, 4, 2];
    const allPoints: PlayInMemberPoints[] = [];
    let memberId = 1;
    for (const place of placePoints) {
      for (let copy = 0; copy < 4; copy += 1) {
        allPoints.push(points(memberId, place + place));
        memberId += 1;
      }
    }
    const teams = Array.from({ length: 12 }, (_, index) =>
      team(index + 1, [index * 4 + 1, index * 4 + 2, index * 4 + 3, index * 4 + 4])
    );
    return { allPoints, teams };
  }

  test('identical evaluations reuse a cloned cache hit', () => {
    invalidatePlayInEvaluationCache();
    const { allPoints, teams } = twoSessionFixture();
    const first = evaluatePlayInLeague(config, allPoints, teams);
    const started = Date.now();
    const second = evaluatePlayInLeague(config, allPoints, teams);
    expect(Date.now() - started).toBeLessThan(50);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    second.guaranteeThresholdHalf = 0;
    expect(evaluatePlayInLeague(config, allPoints, teams).guaranteeThresholdHalf).toBe(first.guaranteeThresholdHalf);
  });

  test('invalidate forces a fresh compute that still matches', () => {
    invalidatePlayInEvaluationCache();
    const { allPoints, teams } = twoSessionFixture();
    const first = evaluatePlayInLeague(config, allPoints, teams);
    invalidatePlayInEvaluationCache();
    const afterInvalidate = evaluatePlayInLeague(config, allPoints, teams);
    expect(afterInvalidate).toEqual(first);
  });

  test('fingerprint is stable across team and points order', () => {
    const { allPoints, teams } = twoSessionFixture();
    const reversedTeams = [...teams].reverse();
    const reversedPoints = [...allPoints].reverse();
    expect(playInEvaluationFingerprint(config, reversedPoints, reversedTeams)).toBe(
      playInEvaluationFingerprint(config, allPoints, teams)
    );
  });

  test('a newly declared team misses the previous fingerprint', () => {
    const { allPoints, teams } = twoSessionFixture();
    const withExtraTeam = [...teams, team(99, [49, 50, 51, 52])];
    expect(playInEvaluationFingerprint(config, allPoints, withExtraTeam)).not.toBe(
      playInEvaluationFingerprint(config, allPoints, teams)
    );
  });
});
