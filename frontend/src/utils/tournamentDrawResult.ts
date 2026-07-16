import type { TournamentGameNode, TournamentGameResult } from './tournamentDrawModel';

export type ResolvedGameOutcome = 'slot0' | 'slot1' | 'tie' | null;

/** Derive winner / tie from stored result (two-sided games). */
export function outcomeFromResult(game: TournamentGameNode): ResolvedGameOutcome {
  const r = game.result;
  if (!r) return null;
  if (r.entryKind === 'pick_winner') {
    return r.winnerSlot === 0 ? 'slot0' : 'slot1';
  }
  if (r.entryKind === 'final_score') {
    const [a, b] = r.finalScores;
    if (a > b) return 'slot0';
    if (b > a) return 'slot1';
    return 'tie';
  }
  if (r.entryKind === 'ends') {
    if (r.complete === false) return null;
    const s0 = r.ends.side0.reduce((x, y) => x + y, 0);
    const s1 = r.ends.side1.reduce((x, y) => x + y, 0);
    if (s0 > s1) return 'slot0';
    if (s1 > s0) return 'slot1';
    return 'tie';
  }
  return null;
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
