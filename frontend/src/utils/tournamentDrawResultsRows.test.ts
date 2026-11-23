import { describe, expect, test } from 'bun:test';
import type { TournamentDrawState } from './tournamentDrawModel';
import { drawHasRecordedScores } from './tournamentDrawResultsRows';

function drawWith(games: TournamentDrawState['games']): TournamentDrawState {
  return { games } as TournamentDrawState;
}

describe('drawHasRecordedScores', () => {
  test('is false until a result or standings points are saved', () => {
    expect(drawHasRecordedScores(null)).toBe(false);
    expect(drawHasRecordedScores(undefined)).toBe(false);
    expect(
      drawHasRecordedScores(
        drawWith({
          g1: {
            id: 'g1',
            label: 'G1',
            eventId: 'e',
            phaseId: 'p',
            depth: 0,
            verticalOrder: 0,
            slots: [{ sourceType: 'tbd' }, { sourceType: 'tbd' }],
          },
        }),
      ),
    ).toBe(false);
  });

  test('is true when a game has a result or both standings points', () => {
    expect(
      drawHasRecordedScores(
        drawWith({
          g1: {
            id: 'g1',
            label: 'G1',
            eventId: 'e',
            phaseId: 'p',
            depth: 0,
            verticalOrder: 0,
            slots: [{ sourceType: 'tbd' }, { sourceType: 'tbd' }],
            result: { entryKind: 'final_score', finalScores: [6, 4] },
          },
        }),
      ),
    ).toBe(true);
    expect(
      drawHasRecordedScores(
        drawWith({
          g1: {
            id: 'g1',
            label: 'G1',
            eventId: 'e',
            phaseId: 'p',
            depth: 0,
            verticalOrder: 0,
            slots: [{ sourceType: 'tbd' }, { sourceType: 'tbd' }],
            standing: { points: [1, 0], tiebreak: [null, null] },
          },
        }),
      ),
    ).toBe(true);
  });
});
