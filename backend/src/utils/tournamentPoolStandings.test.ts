import { describe, expect, test } from 'bun:test';
import {
  computeAdvancingSeeds,
  computePhaseStandings,
  migrateDrawPhasesJson,
  resolveSourceDetail,
  type DrawGameShape,
  type PoolDrawShape,
  type PoolStandingsSettings,
  type TournamentPool,
} from './tournamentPoolStandings.js';

type GameSpec = {
  a: number;
  b: number;
  points?: [number | null, number | null];
  tiebreak?: [number | null, number | null];
  block?: string;
};

/** Pools keyed by code; each team is its registration id. Games reference teams by id. */
function buildDraw(
  pools: Record<string, number[]>,
  games: GameSpec[],
  options: {
    settings?: Partial<PoolStandingsSettings>;
    advancing?: NonNullable<PoolDrawShape['phases'][number]['advancing']>;
    blocks?: string[];
  } = {},
): PoolDrawShape {
  const phaseId = 'p1';
  const poolRows: TournamentPool[] = Object.entries(pools).map(([code, ids], order) => ({
    id: `pool-${code}`,
    phaseId,
    name: `Pool ${code}`,
    code,
    order,
    color: '#000',
    entries: ids.map((id) => ({ id: `e${id}`, source: { sourceType: 'registration', registrationId: id } })),
  }));
  const gameRows: Record<string, DrawGameShape> = {};
  games.forEach((g, i) => {
    const id = `g${i}`;
    gameRows[id] = {
      id,
      label: id,
      eventId: phaseId,
      phaseId,
      slots: [
        { sourceType: 'pool_entry', entryId: `e${g.a}` },
        { sourceType: 'pool_entry', entryId: `e${g.b}` },
      ],
      standing: { points: g.points ?? [null, null], tiebreak: g.tiebreak ?? [null, null] },
      ...(g.block ? { schedule: { drawBlockId: g.block } } : {}),
    };
  });
  return {
    phases: [
      {
        id: phaseId,
        name: 'Pool play',
        order: 0,
        kind: 'pool',
        standings: {
          pointsPossiblePerGame: 1,
          rankBy: 'points',
          headToHead: true,
          tiebreakLabel: 'LSD',
          tiebreakLowerIsBetter: true,
          ...options.settings,
        },
        advancing: options.advancing ?? [],
      },
    ],
    pools: poolRows,
    games: gameRows,
    connections: [],
    drawBlocks: (options.blocks ?? []).map((id, order) => ({ id, name: `Draw ${order + 1}`, order })),
  };
}

function poolOrder(draw: PoolDrawShape, code: string): number[][] {
  const s = computePhaseStandings(draw, 'p1')!;
  return s.pools.find((t) => t.pool.code === code)!.tiers;
}

describe('pool standings ranking', () => {
  test('ranks by points with W/L scoring', () => {
    const draw = buildDraw({ A: [1, 2, 3] }, [
      { a: 1, b: 2, points: [1, 0] },
      { a: 1, b: 3, points: [1, 0] },
      { a: 2, b: 3, points: [1, 0] },
    ]);
    expect(poolOrder(draw, 'A')).toEqual([[1], [2], [3]]);
    expect(computePhaseStandings(draw, 'p1')!.final).toBe(true);
  });

  test('percentage ranking handles unequal games played', () => {
    // Team 1: 2-1 (67%), team 4: 1-0 (100%) via a cross-pool game.
    const draw = buildDraw(
      { A: [1, 2, 3], B: [4, 5] },
      [
        { a: 1, b: 2, points: [1, 0] },
        { a: 1, b: 3, points: [1, 0] },
        { a: 1, b: 4, points: [0, 1] },
      ],
      { settings: { rankBy: 'percentage' } },
    );
    const s = computePhaseStandings(draw, 'p1')!;
    expect(s.overall.tiers[0]).toEqual([4]);
    expect(s.overall.tiers[1]).toEqual([1]);
  });

  test('two-way tie uses head-to-head before tiebreak', () => {
    const draw = buildDraw({ A: [1, 2, 3] }, [
      { a: 1, b: 2, points: [0, 1], tiebreak: [10, 50] },
      { a: 1, b: 3, points: [1, 0], tiebreak: [10, 50] },
      { a: 2, b: 3, points: [0, 1], tiebreak: [50, 50] },
      // 1: 1-1, 2: 1-1, 3: 1-1 → three-way tie; make it two-way by adding one more game
      { a: 3, b: 1, points: [0, 1], tiebreak: [50, 10] },
    ]);
    // 1: 2 pts, 2: 1, 3: 1 → 2 vs 3 tied; 3 beat 2 head-to-head despite worse tiebreak.
    expect(poolOrder(draw, 'A')).toEqual([[1], [3], [2]]);
  });

  test('three-way tie skips head-to-head and uses summed tiebreak (lower is better)', () => {
    const draw = buildDraw({ A: [1, 2, 3] }, [
      { a: 1, b: 2, points: [1, 0], tiebreak: [30, 10] },
      { a: 2, b: 3, points: [1, 0], tiebreak: [10, 5] },
      { a: 3, b: 1, points: [1, 0], tiebreak: [5, 30] },
    ]);
    // Sums: 1 = 60, 2 = 20, 3 = 10.
    expect(poolOrder(draw, 'A')).toEqual([[3], [2], [1]]);
  });

  test('tiebreak direction can be higher-is-better', () => {
    const draw = buildDraw(
      { A: [1, 2, 3] },
      [
        { a: 1, b: 2, points: [1, 0], tiebreak: [30, 10] },
        { a: 2, b: 3, points: [1, 0], tiebreak: [10, 5] },
        { a: 3, b: 1, points: [1, 0], tiebreak: [5, 30] },
      ],
      { settings: { tiebreakLowerIsBetter: false } },
    );
    expect(poolOrder(draw, 'A')).toEqual([[1], [2], [3]]);
  });

  test('three-way tie split by tiebreak re-applies head-to-head to a remaining pair', () => {
    const draw = buildDraw({ A: [1, 2, 3] }, [
      { a: 1, b: 2, points: [1, 0], tiebreak: [20, 20] },
      { a: 2, b: 3, points: [1, 0], tiebreak: [20, 5] },
      { a: 3, b: 1, points: [1, 0], tiebreak: [5, 20] },
    ]);
    // Sums: 1 = 40, 2 = 40, 3 = 10 → 3 first; 1 beat 2 head-to-head.
    expect(poolOrder(draw, 'A')).toEqual([[3], [1], [2]]);
  });

  test('unbroken ties stay tied', () => {
    const draw = buildDraw({ A: [1, 2, 3] }, [
      { a: 1, b: 2, points: [1, 0], tiebreak: [10, 10] },
      { a: 2, b: 3, points: [1, 0], tiebreak: [10, 10] },
      { a: 3, b: 1, points: [1, 0], tiebreak: [10, 10] },
    ]);
    expect(poolOrder(draw, 'A')).toEqual([[1, 2, 3]]);
  });

  test('not final while a game has no points', () => {
    const draw = buildDraw({ A: [1, 2], B: [3, 4] }, [
      { a: 1, b: 2, points: [1, 0] },
      { a: 3, b: 4 },
    ]);
    const s = computePhaseStandings(draw, 'p1')!;
    expect(s.pools[0]!.final).toBe(true);
    expect(s.pools[1]!.final).toBe(false);
    expect(s.final).toBe(false);
    const poolA1 = resolveSourceDetail(draw, { sourceType: 'standing', phaseId: 'p1', poolId: 'pool-A', rank: 1 });
    expect(poolA1.registrationId).toBe(1);
    const overall1 = resolveSourceDetail(draw, { sourceType: 'standing', phaseId: 'p1', rank: 1 });
    expect(overall1.registrationId).toBeNull();
    expect(overall1.projectedRegistrationId).toBe(1);
  });
});

describe('ranked pools and mid-phase standings', () => {
  test('pools rank by their top team', () => {
    const draw = buildDraw({ A: [1, 2], B: [3, 4] }, [
      { a: 1, b: 2, points: [1, 0], tiebreak: [40, 0] },
      { a: 3, b: 4, points: [1, 0], tiebreak: [10, 0] },
    ]);
    const s = computePhaseStandings(draw, 'p1')!;
    expect(s.poolRanking).toEqual([['pool-B'], ['pool-A']]);
    const r = resolveSourceDetail(draw, { sourceType: 'standing', phaseId: 'p1', poolRank: 1, rank: 2 });
    expect(r.registrationId).toBe(4);
  });

  test('standings after a draw count only games through that draw', () => {
    const draw = buildDraw(
      { A: [1, 2, 3, 4] },
      [
        { a: 1, b: 2, points: [1, 0], tiebreak: [5, 9], block: 'd1' },
        { a: 3, b: 4, points: [1, 0], tiebreak: [8, 9], block: 'd1' },
        { a: 2, b: 4, points: [0, 1], block: 'd2' },
      ],
      { blocks: ['d1', 'd2'] },
    );
    const afterD1 = computePhaseStandings(draw, 'p1', 'd1')!;
    expect(afterD1.final).toBe(true);
    expect(afterD1.pools[0]!.tiers.slice(0, 2)).toEqual([[1], [3]]);
  });

  test('winners-play-winners via standing after draw', () => {
    const draw = buildDraw(
      { A: [1, 2, 3, 4] },
      [
        { a: 1, b: 2, points: [1, 0], tiebreak: [5, 9], block: 'd1' },
        { a: 3, b: 4, points: [1, 0], tiebreak: [8, 9], block: 'd1' },
      ],
      { blocks: ['d1', 'd2'] },
    );
    draw.games.w = {
      id: 'w',
      label: 'W',
      eventId: 'p1',
      phaseId: 'p1',
      slots: [
        { sourceType: 'standing', phaseId: 'p1', poolId: 'pool-A', rank: 1, afterDrawBlockId: 'd1' },
        { sourceType: 'standing', phaseId: 'p1', poolId: 'pool-A', rank: 2, afterDrawBlockId: 'd1' },
      ],
      schedule: { drawBlockId: 'd2' },
    };
    const s = computePhaseStandings(draw, 'p1', 'd1')!;
    expect(s.pools[0]!.tiers.slice(0, 2)).toEqual([[1], [3]]);
    // Full-phase standings are not final because game W has no points yet.
    expect(computePhaseStandings(draw, 'p1')!.final).toBe(false);
  });
});

describe('advancing teams', () => {
  // A: 5-0-ish strong pool (1 > 2 > 3), B and C weak beyond their winners.
  function threePools() {
    return buildDraw(
      { A: [1, 2, 3], B: [4, 5, 6], C: [7, 8, 9] },
      [
        { a: 1, b: 2, points: [2, 0], tiebreak: [10, 20] },
        { a: 1, b: 3, points: [2, 0], tiebreak: [10, 30] },
        { a: 2, b: 3, points: [2, 0], tiebreak: [20, 30] },
        { a: 4, b: 5, points: [2, 0], tiebreak: [15, 40] },
        { a: 4, b: 6, points: [2, 0], tiebreak: [15, 50] },
        { a: 5, b: 6, points: [1, 1], tiebreak: [40, 50] },
        { a: 7, b: 8, points: [2, 0], tiebreak: [5, 60] },
        { a: 7, b: 9, points: [2, 0], tiebreak: [5, 70] },
        { a: 8, b: 9, points: [1, 1], tiebreak: [60, 70] },
        // Cross-pool: team 3 beats team 9 so team 3 has 2 points.
        { a: 3, b: 9, points: [2, 0], tiebreak: [30, 70] },
      ],
      {
        settings: { pointsPossiblePerGame: 2 },
        advancing: [
          { id: 's1', kind: 'top_per_pool', count: 2 },
          { id: 's2', kind: 'best_remaining', count: 2 },
        ],
      },
    );
  }

  test('top 2 per pool then best remaining 2', () => {
    const seeds = computeAdvancingSeeds(threePools(), 'p1')!;
    expect(seeds).toHaveLength(8);
    // 1st-place teams: 7 (tb 10), 1 (tb 20), 4 (tb 30) — all 4 pts.
    expect(seeds.slice(0, 3).map((s) => s.registrationId)).toEqual([7, 1, 4]);
    // 2nd-place teams: 2 (2 pts), then 5 and 8 (1 pt each; tb 5 = 80, 8 = 120).
    expect(seeds.slice(3, 6).map((s) => s.registrationId)).toEqual([2, 5, 8]);
    // Best remaining: 3 (2 pts) — not overall 7th — then 6 (1 pt, tb 100) over 9 (1 pt, tb 210).
    expect(seeds.slice(6).map((s) => s.registrationId)).toEqual([3, 6]);
    expect(seeds[0]!.description).toBe('Best 1st-place team');
    expect(seeds[6]!.description).toBe('Best remaining #1');
  });

  test('qualifier slot source resolves to the seeded team', () => {
    const draw = threePools();
    expect(resolveSourceDetail(draw, { sourceType: 'qualifier', phaseId: 'p1', seed: 7 }).registrationId).toBe(3);
  });

  test('tie at the cut line blocks only the affected seeds', () => {
    const draw = buildDraw(
      { A: [1, 2, 3] },
      [
        { a: 1, b: 2, points: [1, 0], tiebreak: [1, 5] },
        { a: 1, b: 3, points: [1, 0], tiebreak: [1, 5] },
        { a: 2, b: 3, points: [0, 0], tiebreak: [5, 5] },
      ],
      { advancing: [{ id: 's', kind: 'best_remaining', count: 2 }] },
    );
    const seeds = computeAdvancingSeeds(draw, 'p1')!;
    expect(seeds[0]!.registrationId).toBe(1);
    expect(seeds[1]!.registrationId).toBeNull();
    expect(seeds[1]!.tiedRegistrationIds.sort()).toEqual([2, 3]);
  });

  test('ties below the cut line do not block', () => {
    const draw = buildDraw(
      { A: [1, 2, 3] },
      [
        { a: 1, b: 2, points: [1, 0], tiebreak: [1, 5] },
        { a: 1, b: 3, points: [1, 0], tiebreak: [1, 5] },
        { a: 2, b: 3, points: [0, 0], tiebreak: [5, 5] },
      ],
      { advancing: [{ id: 's', kind: 'pool_place', poolId: 'pool-A', rank: 1 }] },
    );
    expect(computeAdvancingSeeds(draw, 'p1')![0]!.registrationId).toBe(1);
  });
});

describe('migrateDrawPhasesJson', () => {
  test('legacy draws get one bracket phase', () => {
    const out = migrateDrawPhasesJson({
      setup: { eventCount: 1, events: [{ id: 'lane-a', code: 'A' }] },
      games: { g1: { id: 'g1', eventId: 'lane-a' } },
    });
    expect((out.phases as Array<{ kind: string }>).map((p) => p.kind)).toEqual(['bracket']);
    expect((out.setup as { events: Array<{ phaseId: string }> }).events[0]!.phaseId).toBe('phase-bracket');
    expect((out.games as Record<string, { phaseId: string }>).g1!.phaseId).toBe('phase-bracket');
    expect(out.pools).toEqual([]);
  });
});
