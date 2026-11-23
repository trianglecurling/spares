import { describe, expect, test } from 'bun:test';
import { tournamentDrawStateSchema, type TournamentDrawState } from './eventTournamentDrawSchema.js';
import { validateTournamentDrawSemantics } from './eventTournamentDrawService.js';
import { resolveRegistrationIdForGameSlot } from './tournamentSlotResolution.js';

/** Pool A (teams 1, 2) in phase `pool`, then a bracket final fed by Q1 vs Q2. */
function poolThenBracket(): TournamentDrawState {
  const raw = {
    version: 1,
    setup: { eventCount: 1, events: [{ id: 'lane-a', name: 'A event', code: 'A', order: 0, color: '#000', phaseId: 'br' }] },
    phases: [
      {
        id: 'pool',
        name: 'Pool play',
        order: 0,
        kind: 'pool',
        standings: { pointsPossiblePerGame: 2, rankBy: 'points', headToHead: true, tiebreakLabel: 'LSD', tiebreakLowerIsBetter: true },
        advancing: [{ id: 's', kind: 'top_per_pool', count: 2 }],
      },
      { id: 'br', name: 'Playoffs', order: 1, kind: 'bracket' },
    ],
    pools: [
      {
        id: 'pa',
        phaseId: 'pool',
        name: 'Pool A',
        code: 'A',
        order: 0,
        color: '#000',
        entries: [
          { id: 'a1', source: { sourceType: 'registration', registrationId: 1 } },
          { id: 'a2', source: { sourceType: 'registration', registrationId: 2 } },
        ],
      },
    ],
    canvas: { zoom: 1, panX: 0, panY: 0 },
    games: {
      p1: {
        id: 'p1',
        eventId: 'pool',
        phaseId: 'pool',
        poolId: 'pa',
        label: 'A1',
        depth: 0,
        verticalOrder: 0,
        slots: [
          { sourceType: 'pool_entry', entryId: 'a1' },
          { sourceType: 'pool_entry', entryId: 'a2' },
        ],
        standing: { points: [0, 2], tiebreak: [null, null] },
      },
      f: {
        id: 'f',
        eventId: 'lane-a',
        phaseId: 'br',
        label: 'F',
        depth: 0,
        verticalOrder: 0,
        slots: [
          { sourceType: 'qualifier', phaseId: 'pool', seed: 1 },
          { sourceType: 'qualifier', phaseId: 'pool', seed: 2 },
        ],
      },
    },
    connections: [],
    drawBlocks: [],
    sheets: [],
    textNodes: [],
  };
  return tournamentDrawStateSchema.parse(raw);
}

describe('pool phase validation', () => {
  test('accepts a pool phase feeding a bracket', () => {
    const draw = poolThenBracket();
    expect(() => validateTournamentDrawSemantics(draw, { confirmedRegistrationIds: new Set([1, 2]) })).not.toThrow();
  });

  test('bracket slots resolve qualifiers once pool play is final', () => {
    const draw = poolThenBracket();
    expect(resolveRegistrationIdForGameSlot(draw, draw.games.f!, 0)).toBe(2);
    expect(resolveRegistrationIdForGameSlot(draw, draw.games.f!, 1)).toBe(1);
  });

  test('rejects points above points possible', () => {
    const draw = poolThenBracket();
    draw.games.p1!.standing = { points: [3, 0], tiebreak: [null, null] };
    expect(() => validateTournamentDrawSemantics(draw)).toThrow(/between 0 and 2/);
  });

  test('rejects a team in two pools of one phase', () => {
    const draw = poolThenBracket();
    draw.pools.push({
      id: 'pb',
      phaseId: 'pool',
      name: 'Pool B',
      code: 'B',
      order: 1,
      color: '#000',
      entries: [{ id: 'b1', source: { sourceType: 'registration', registrationId: 1 } }],
    });
    expect(() => validateTournamentDrawSemantics(draw)).toThrow(/more than one pool/);
  });

  test('rejects qualifiers from a later phase', () => {
    const draw = poolThenBracket();
    draw.phases[0]!.order = 2;
    expect(() => validateTournamentDrawSemantics(draw)).toThrow(/later phase/);
  });

  test('same-phase standings require a specific draw', () => {
    const draw = poolThenBracket();
    draw.games.p1!.slots[0] = { sourceType: 'standing', phaseId: 'pool', poolId: 'pa', rank: 1 };
    expect(() => validateTournamentDrawSemantics(draw)).toThrow(/after a specific draw/);
  });

  test('legacy draws parse into one bracket phase', () => {
    const draw = tournamentDrawStateSchema.parse({
      version: 1,
      setup: { eventCount: 1, events: [{ id: 'lane-a', name: 'A event', code: 'A', order: 0, color: '#000' }] },
      canvas: { zoom: 1, panX: 0, panY: 0 },
      games: {
        g: { id: 'g', eventId: 'lane-a', label: 'A1', depth: 0, verticalOrder: 0, slots: [{ sourceType: 'tbd' }, { sourceType: 'tbd' }] },
      },
      connections: [],
      drawBlocks: [],
      sheets: [],
      textNodes: [],
    });
    expect(draw.phases).toHaveLength(1);
    expect(draw.games.g!.phaseId).toBe(draw.phases[0]!.id);
    expect(() => validateTournamentDrawSemantics(draw)).not.toThrow();
  });
});
