import type {
  TournamentDrawState,
  TournamentGameNode,
  TournamentGameResult,
  TournamentResultType,
} from './tournamentDrawModel';
import { sumEnds } from './tournamentDrawResult';

export const TOURNAMENT_RESULT_TYPE_OPTIONS: Array<{
  value: TournamentResultType;
  label: string;
  description: string;
}> = [
  {
    value: 'pick',
    label: 'Pick winner',
    description: 'Choose which side won without entering scores.',
  },
  {
    value: 'score',
    label: 'Final score',
    description: 'Enter each side’s final total score.',
  },
  {
    value: 'ends',
    label: 'End by end',
    description: 'Enter points scored in each end, then mark the game complete.',
  },
];

export function resultTypeLabel(type: TournamentResultType): string {
  return TOURNAMENT_RESULT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? 'Pick winner';
}

export function resolveDrawResultType(draw: TournamentDrawState): TournamentResultType {
  return draw.resultType === 'score' || draw.resultType === 'ends' || draw.resultType === 'pick'
    ? draw.resultType
    : 'pick';
}

function pickFromScores(a: number, b: number): TournamentGameResult | null {
  if (a > b) return { entryKind: 'pick_winner', winnerSlot: 0 };
  if (b > a) return { entryKind: 'pick_winner', winnerSlot: 1 };
  return null;
}

/**
 * Convert a single game’s stored result when the event’s result type changes.
 * Returns null when the game should be treated as needing a new result.
 * Games with 3+ competitors keep `multi_score` results regardless of result type.
 */
export function convertGameResultForResultType(
  game: TournamentGameNode,
  nextType: TournamentResultType,
): TournamentGameResult | null {
  const result = game.result;
  if (!result) return null;

  if (game.slots.length >= 3) {
    return result.entryKind === 'multi_score' ? result : null;
  }

  if (nextType === 'pick') {
    if (result.entryKind === 'pick_winner') return result;
    if (result.entryKind === 'final_score') {
      return pickFromScores(result.finalScores[0], result.finalScores[1]);
    }
    if (result.entryKind === 'ends' && result.complete !== false) {
      return pickFromScores(sumEnds(result.ends.side0), sumEnds(result.ends.side1));
    }
    return null;
  }

  if (nextType === 'score') {
    if (result.entryKind === 'final_score') return result;
    if (result.entryKind === 'ends' && result.complete !== false) {
      return {
        entryKind: 'final_score',
        finalScores: [sumEnds(result.ends.side0), sumEnds(result.ends.side1)],
      };
    }
    return null;
  }

  // ends
  if (result.entryKind === 'ends') return result;
  return null;
}

/** Set draw.resultType and convert/clear per-game results as needed. */
export function applyDrawResultTypeChange(
  draw: TournamentDrawState,
  nextType: TournamentResultType,
): TournamentDrawState {
  const games: TournamentDrawState['games'] = {};
  for (const [id, game] of Object.entries(draw.games)) {
    const converted = convertGameResultForResultType(game, nextType);
    if (converted) {
      games[id] = { ...game, result: converted };
    } else {
      const { result: _r, ...rest } = game;
      void _r;
      games[id] = rest;
    }
  }
  return { ...draw, resultType: nextType, games };
}

/** Summarize how many games will convert vs clear when changing result type. */
export function summarizeResultTypeChange(
  draw: TournamentDrawState,
  nextType: TournamentResultType,
): { keptOrConverted: number; cleared: number } {
  let keptOrConverted = 0;
  let cleared = 0;
  for (const game of Object.values(draw.games)) {
    if (!game.result) continue;
    if (game.slots.length >= 3) {
      if (game.result.entryKind === 'multi_score') keptOrConverted += 1;
      else cleared += 1;
      continue;
    }
    const before = game.result;
    const after = convertGameResultForResultType(game, nextType);
    if (after == null) cleared += 1;
    else if (
      after.entryKind !== before.entryKind ||
      JSON.stringify(after) !== JSON.stringify(before)
    ) {
      keptOrConverted += 1;
    } else {
      keptOrConverted += 1;
    }
  }
  return { keptOrConverted, cleared };
}
