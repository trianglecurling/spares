import { describe, expect, test } from 'bun:test';
import { DEFAULT_POOL_STANDINGS_SETTINGS } from '../../../backend/src/utils/tournamentPoolStandings';
import { emptyTournamentDraw } from './tournamentDrawBuilders';
import type { TournamentDrawState, TournamentGameNode } from './tournamentDrawModel';
import { competitorLabelsLine } from './tournamentDrawRouting';

const teamsById = new Map([
  [1, { teamName: 'Alpha', sortOrder: 0 }],
  [2, { teamName: 'Bravo', sortOrder: 1 }],
  [3, { teamName: 'Charlie', sortOrder: 2 }],
]);

function poolGame(
  id: string,
  phaseId: string,
  a: number,
  b: number,
  points?: [number, number],
): TournamentGameNode {
  return {
    id,
    label: id,
    eventId: phaseId,
    phaseId,
    depth: 0,
    verticalOrder: 0,
    slots: [
      { sourceType: 'pool_entry', entryId: `e${a}` },
      { sourceType: 'pool_entry', entryId: `e${b}` },
    ],
    standing: points
      ? { points, tiebreak: [10, 10] }
      : { points: [null, null], tiebreak: [null, null] },
  };
}

function firstRound(
  draw: TournamentDrawState,
  slot: TournamentGameNode['slots'][number],
): string {
  const bracketId = draw.phases.find((p) => p.kind === 'bracket')!.id;
  const eventId = draw.setup.events[0]!.id;
  const game: TournamentGameNode = {
    id: 'r1',
    label: 'A1',
    eventId,
    phaseId: bracketId,
    depth: 0,
    verticalOrder: 0,
    slots: [slot, { sourceType: 'tbd' }],
  };
  return competitorLabelsLine(draw, game, teamsById);
}

function drawWithPools(
  teamIds: number[],
  games: TournamentGameNode[],
): TournamentDrawState {
  const base = emptyTournamentDraw(1);
  const poolId = 'pool';
  const bracket = { ...base.phases[0]!, order: 1 };
  return {
    ...base,
    phases: [
      {
        id: poolId,
        name: 'Pool play',
        order: 0,
        kind: 'pool',
        standings: { ...DEFAULT_POOL_STANDINGS_SETTINGS },
        advancing: [],
      },
      bracket,
    ],
    pools: [
      {
        id: 'pool-A',
        phaseId: poolId,
        name: 'Pool A',
        code: 'A',
        order: 0,
        color: '#000',
        entries: teamIds.map((id) => ({
          id: `e${id}`,
          source: { sourceType: 'registration' as const, registrationId: id },
        })),
      },
    ],
    games: Object.fromEntries(games.map((g) => [g.id, g])),
  };
}

describe('first-round phase inputs on bracket nodes', () => {
  test('shows the team when the standing is a single confirmed team', () => {
    const draw = drawWithPools(
      [1, 2],
      [poolGame('g1', 'pool', 1, 2, [1, 0])],
    );
    expect(firstRound(draw, { sourceType: 'standing', phaseId: 'pool', rank: 1 })).toBe('Alpha v. TBD');
  });

  test('shows the standing description when teams are tied', () => {
    const draw = drawWithPools(
      [1, 2, 3],
      [
        poolGame('g1', 'pool', 1, 2, [1, 0]),
        poolGame('g2', 'pool', 2, 3, [1, 0]),
        poolGame('g3', 'pool', 3, 1, [1, 0]),
      ],
    );
    expect(firstRound(draw, { sourceType: 'standing', phaseId: 'pool', rank: 1 })).toBe('Overall 1st v. TBD');
  });
});
