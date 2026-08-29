import { describe, expect, test } from 'bun:test';
import type { TournamentDrawState, TournamentGameNode } from './eventTournamentDrawSchema.js';
import {
  resolveRegistrationIdForGameSlot,
  slotIndexForPlaceAfterResult,
  stoneColorForSlot,
} from './tournamentSlotResolution.js';

function emptyDraw(games: Record<string, TournamentGameNode>): TournamentDrawState {
  return {
    version: 1,
    setup: { eventCount: 1, events: [{ id: 'A', name: 'A', code: 'A', order: 0, color: '#000' }] },
    canvas: { zoom: 1, panX: 0, panY: 0 },
    games,
    connections: [],
    drawBlocks: [],
    sheets: [{ clubSheetId: 1, name: 'A', order: 0, stoneColor1: 'red', stoneColor2: 'yellow' }],
    textNodes: [],
  };
}

function twoSlotGame(
  id: string,
  slots: TournamentGameNode['slots'],
  extras: Partial<TournamentGameNode> = {}
): TournamentGameNode {
  return {
    id,
    eventId: 'A',
    label: id,
    depth: 0,
    verticalOrder: 0,
    slots,
    ...extras,
  };
}

describe('slotIndexForPlaceAfterResult', () => {
  test('maps pick_winner onto winner and loser slots', () => {
    const game = twoSlotGame('G1', [{ sourceType: 'tbd' }, { sourceType: 'tbd' }], {
      result: { entryKind: 'pick_winner', winnerSlot: 1 },
    });
    expect(slotIndexForPlaceAfterResult(game, 1)).toBe(1);
    expect(slotIndexForPlaceAfterResult(game, 2)).toBe(0);
  });
});

describe('resolveRegistrationIdForGameSlot', () => {
  test('reads a seeded registration slot', () => {
    const draw = emptyDraw({
      G1: twoSlotGame('G1', [
        { sourceType: 'registration', registrationId: 11 },
        { sourceType: 'registration', registrationId: 22 },
      ]),
    });
    expect(resolveRegistrationIdForGameSlot(draw, draw.games.G1!, 0)).toBe(11);
    expect(resolveRegistrationIdForGameSlot(draw, draw.games.G1!, 1)).toBe(22);
  });

  test('follows game_place after a recorded result', () => {
    const draw = emptyDraw({
      G1: twoSlotGame(
        'G1',
        [
          { sourceType: 'registration', registrationId: 11 },
          { sourceType: 'registration', registrationId: 22 },
        ],
        { result: { entryKind: 'pick_winner', winnerSlot: 0 } }
      ),
      G2: twoSlotGame('G2', [
        { sourceType: 'game_place', gameId: 'G1', place: 1 },
        { sourceType: 'registration', registrationId: 33 },
      ]),
    });
    expect(resolveRegistrationIdForGameSlot(draw, draw.games.G2!, 0)).toBe(11);
  });

  test('follows incoming feeder connections when the slot itself is TBD', () => {
    const draw: TournamentDrawState = {
      ...emptyDraw({
        G1: twoSlotGame(
          'G1',
          [
            { sourceType: 'registration', registrationId: 11 },
            { sourceType: 'registration', registrationId: 22 },
          ],
          { result: { entryKind: 'pick_winner', winnerSlot: 1 } }
        ),
        G2: twoSlotGame('G2', [{ sourceType: 'tbd' }, { sourceType: 'tbd' }]),
      }),
      connections: [
        {
          id: 'c1',
          fromGameId: 'G1',
          place: 1,
          toGameId: 'G2',
          terminalType: 'game',
        },
      ],
    };
    expect(resolveRegistrationIdForGameSlot(draw, draw.games.G2!, 0)).toBe(22);
  });
});

describe('stoneColorForSlot', () => {
  test('assigns sheet colors from rockColor1Slot', () => {
    const draw = emptyDraw({
      G1: twoSlotGame(
        'G1',
        [{ sourceType: 'tbd' }, { sourceType: 'tbd' }],
        {
          rockColor1Slot: 1,
          schedule: { sheetId: 1 },
        }
      ),
    });
    expect(stoneColorForSlot(draw, draw.games.G1!, 1)).toBe('red');
    expect(stoneColorForSlot(draw, draw.games.G1!, 0)).toBe('yellow');
  });
});
