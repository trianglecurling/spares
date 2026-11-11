import { describe, expect, test } from 'bun:test';
import { drawJsonHasRecordedScores } from './tournamentDrawRecordedScores.js';

describe('drawJsonHasRecordedScores', () => {
  test('is false for empty or unreadable draw JSON', () => {
    expect(drawJsonHasRecordedScores(null)).toBe(false);
    expect(drawJsonHasRecordedScores('')).toBe(false);
    expect(drawJsonHasRecordedScores('{')).toBe(false);
    expect(drawJsonHasRecordedScores(JSON.stringify({ games: {} }))).toBe(false);
  });

  test('is true when a game has a winner or standing points', () => {
    expect(
      drawJsonHasRecordedScores(
        JSON.stringify({ games: { a: { result: { entryKind: 'pick_winner', winnerSlot: 0 } } } }),
      ),
    ).toBe(true);
    expect(
      drawJsonHasRecordedScores(JSON.stringify({ games: { a: { standing: { points: [2, 0] } } } })),
    ).toBe(true);
  });

  test('ignores in-progress end-by-end scores', () => {
    expect(
      drawJsonHasRecordedScores(
        JSON.stringify({
          games: {
            a: { result: { entryKind: 'ends', complete: false, ends: { side0: [1], side1: [0] } } },
          },
        }),
      ),
    ).toBe(false);
    expect(
      drawJsonHasRecordedScores(
        JSON.stringify({
          games: { a: { result: { entryKind: 'ends', complete: true, ends: { side0: [], side1: [] } } } },
        }),
      ),
    ).toBe(false);
    expect(
      drawJsonHasRecordedScores(
        JSON.stringify({
          games: { a: { result: { entryKind: 'ends', complete: true, ends: { side0: [1], side1: [0] } } } },
        }),
      ),
    ).toBe(true);
  });
});
