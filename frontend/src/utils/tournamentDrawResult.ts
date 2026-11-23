import type { TournamentGameNode, TournamentGameResult } from './tournamentDrawModel';
import { twoSidedOutcome } from '../../../backend/src/utils/tournamentPoolStandings';

export type ResolvedGameOutcome = 'slot0' | 'slot1' | 'tie' | null;

/** Derive winner / tie from stored result (two-sided games). Pool standings points take precedence. */
export function outcomeFromResult(game: TournamentGameNode): ResolvedGameOutcome {
  const outcome = twoSidedOutcome(game);
  if (outcome === 0) return 'slot0';
  if (outcome === 1) return 'slot1';
  return outcome;
}

/** Slot indices in finish order (1st place first) for multi_score games. */
export function multiScoreRanking(game: TournamentGameNode): Array<{ slotIndex: number; score: number }> | null {
  const r = game.result;
  if (!r || r.entryKind !== 'multi_score') return null;
  const k = game.slots.length;
  if (r.scores.length !== k) return null;
  const rows = r.scores.map((score, slotIndex) => ({ slotIndex, score }));
  rows.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.slotIndex - b.slotIndex));
  return rows;
}

/** Table radios are disabled when the result is score- or ends-based (winner is derived). */
export function resultLocksTableRadios(result: TournamentGameResult | undefined): boolean {
  if (!result) return false;
  if (result.entryKind === 'ends') return result.complete !== false;
  return result.entryKind === 'final_score' || result.entryKind === 'multi_score';
}

export function sumEnds(side: number[]): number {
  return side.reduce((a, b) => a + b, 0);
}
