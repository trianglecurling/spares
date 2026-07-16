import type { TournamentFormat } from './tournamentDisplay';

export type EndScorePoints = { side0: number; side1: number };

export const DOUBLES_REGULATION_ENDS = 8;

/** Next-end hammer after one completed end’s result. */
export function nextHammerAfterEnd(
  hammerThisEnd: 0 | 1,
  entry: EndScorePoints,
  format: TournamentFormat,
): 0 | 1 {
  const blank = entry.side0 === 0 && entry.side1 === 0;
  if (blank) {
    // Doubles: blank switches hammer. Fours: blank keeps hammer.
    if (format === 'doubles') return hammerThisEnd === 0 ? 1 : 0;
    return hammerThisEnd;
  }
  // Scoring team gives up hammer.
  if (entry.side0 > 0) return 1;
  if (entry.side1 > 0) return 0;
  return hammerThisEnd;
}

/**
 * Who has hammer (last stone) for endIndex (0-based).
 * Requires firstEndHammerSlot and consecutive filled ends before endIndex.
 */
export function hammerSlotForEnd(
  endIndex: number,
  firstEndHammerSlot: 0 | 1,
  entries: Array<EndScorePoints | null>,
  format: TournamentFormat,
): 0 | 1 | null {
  if (endIndex < 0) return null;
  if (endIndex === 0) return firstEndHammerSlot;
  let hammer: 0 | 1 = firstEndHammerSlot;
  for (let i = 0; i < endIndex; i++) {
    const entry = entries[i];
    if (entry == null) return null;
    hammer = nextHammerAfterEnd(hammer, entry, format);
  }
  return hammer;
}

/** 1-based end numbers (≤ regulation) where `slot` has hammer and hammer is determined. */
export function eligiblePowerPlayEnds(
  slot: 0 | 1,
  firstEndHammerSlot: 0 | 1 | null,
  entries: Array<EndScorePoints | null>,
  format: TournamentFormat,
  regulationEnds: number = DOUBLES_REGULATION_ENDS,
): number[] {
  if (firstEndHammerSlot == null || format !== 'doubles') return [];
  const out: number[] = [];
  for (let i = 0; i < regulationEnds; i++) {
    let known = true;
    for (let j = 0; j < i; j++) {
      if (entries[j] == null) {
        known = false;
        break;
      }
    }
    if (!known) break;
    const hammer = hammerSlotForEnd(i, firstEndHammerSlot, entries, format);
    if (hammer === slot) out.push(i + 1);
  }
  return out;
}
