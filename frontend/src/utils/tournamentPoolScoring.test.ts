import { describe, expect, test } from 'bun:test';
import { DEFAULT_POOL_STANDINGS_SETTINGS } from '../../../backend/src/utils/tournamentPoolStandings';
import { emptyTournamentDraw } from './tournamentDrawBuilders';
import type { TournamentDrawState, TournamentGameNode } from './tournamentDrawModel';
import { standingAfterResultChange } from './tournamentPoolScoring';

function poolDraw(pointsPossiblePerGame: number, game: TournamentGameNode): TournamentDrawState {
  const base = emptyTournamentDraw(1);
  return {
    ...base,
    phases: [
      {
        id: 'pool',
        name: 'Pool play',
        order: 0,
        kind: 'pool',
        standings: { ...DEFAULT_POOL_STANDINGS_SETTINGS, pointsPossiblePerGame },
        advancing: [],
      },
      { ...base.phases[0]!, order: 1 },
    ],
    games: { [game.id]: game },
  };
}

function game(standingPoints: [number, number] | [null, null]): TournamentGameNode {
  return {
    id: 'g1',
    label: 'G1',
    eventId: 'pool',
    phaseId: 'pool',
    depth: 0,
    verticalOrder: 0,
    slots: [{ sourceType: 'tbd' }, { sourceType: 'tbd' }],
    result: { entryKind: 'pick_winner', winnerSlot: 0 },
    standing: { points: standingPoints, tiebreak: [null, null] },
  };
}

describe('standing points when a win is worth 1', () => {
  test('a new winner replaces a hand-entered score with 1 and 0', () => {
    const draw = poolDraw(1, game([0, 0]));
    const next = standingAfterResultChange(draw, draw.games.g1!, { entryKind: 'pick_winner', winnerSlot: 1 });
    expect(next?.points).toEqual([0, 1]);
  });

  test('a higher points maximum keeps a hand-entered score', () => {
    const draw = poolDraw(2, game([0, 0]));
    const next = standingAfterResultChange(draw, draw.games.g1!, { entryKind: 'pick_winner', winnerSlot: 1 });
    expect(next).toBeUndefined();
  });
});
