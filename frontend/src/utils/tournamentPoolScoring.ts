import type {
  TournamentDrawState,
  TournamentGameNode,
  TournamentGameResult,
  TournamentGameStanding,
} from './tournamentDrawModel';
import { isPoolPhaseGame, poolSettings } from './tournamentDrawPhases';
import { twoSidedOutcome } from '../../../backend/src/utils/tournamentPoolStandings';

export function pointsPossibleForGame(draw: TournamentDrawState, game: TournamentGameNode): number {
  return poolSettings(draw.phases.find((p) => p.id === game.phaseId)).pointsPossiblePerGame;
}

/** Points implied by a finished result: win = points possible, tie = half each, loss = 0. */
export function pointsFromResult(
  pointsPossible: number,
  result: TournamentGameResult | null | undefined,
): [number, number] | null {
  const outcome = twoSidedOutcome({ result: result ?? undefined });
  if (outcome === 0) return [pointsPossible, 0];
  if (outcome === 1) return [0, pointsPossible];
  if (outcome === 'tie') return [pointsPossible / 2, pointsPossible / 2];
  return null;
}

function emptyStanding(game: TournamentGameNode): TournamentGameStanding {
  return { points: [null, null], tiebreak: game.standing?.tiebreak ?? [null, null] };
}

/**
 * New standing for a pool game whose result is changing, or undefined to leave it alone.
 * Points follow the result unless the scorekeeper already typed different points.
 * When a game is worth at most 1 point, there is no points field, so a win is 1 and a loss is 0.
 */
export function standingAfterResultChange(
  draw: TournamentDrawState,
  game: TournamentGameNode,
  nextResult: TournamentGameResult | null,
  opts?: { force?: boolean },
): TournamentGameStanding | undefined {
  if (!isPoolPhaseGame(draw, game) || game.slots.length !== 2) return undefined;
  const possible = pointsPossibleForGame(draw, game);
  const current = game.standing?.points;
  const previous = pointsFromResult(possible, game.result);
  const followsResult =
    opts?.force ||
    possible === 1 ||
    current == null ||
    current[0] == null ||
    current[1] == null ||
    (previous != null && current[0] === previous[0] && current[1] === previous[1]);
  if (!followsResult) return undefined;
  const points = pointsFromResult(possible, nextResult);
  return { ...emptyStanding(game), points: points ?? [null, null] };
}

export function tieStanding(draw: TournamentDrawState, game: TournamentGameNode): TournamentGameStanding {
  const half = pointsPossibleForGame(draw, game) / 2;
  return { ...emptyStanding(game), points: [half, half] };
}

export function setGameStanding(
  d: TournamentDrawState,
  gameId: string,
  standing: TournamentGameStanding | null,
): TournamentDrawState {
  const g = d.games[gameId];
  if (!g) return d;
  if (standing == null) {
    const { standing: _s, ...rest } = g;
    void _s;
    return { ...d, games: { ...d.games, [gameId]: rest } };
  }
  return { ...d, games: { ...d.games, [gameId]: { ...g, standing } } };
}
