import type { TournamentFormat } from './tournamentDisplay';

export type EndScorePoints = { side0: number; side1: number };

export const DOUBLES_REGULATION_ENDS = 8;

function isBlankEnd(entry: EndScorePoints): boolean {
  return entry.side0 === 0 && entry.side1 === 0;
}

/**
 * Next-end hammer after a non-blank end (scoring team gives up hammer).
 * Does not depend on who held hammer this end.
 */
export function hammerAfterNonBlankEnd(entry: EndScorePoints): 0 | 1 | null {
  if (isBlankEnd(entry)) return null;
  if (entry.side0 > 0) return 1;
  if (entry.side1 > 0) return 0;
  return null;
}

/** Next-end hammer after one completed end’s result. */
export function nextHammerAfterEnd(
  hammerThisEnd: 0 | 1,
  entry: EndScorePoints,
  format: TournamentFormat,
): 0 | 1 {
  if (isBlankEnd(entry)) {
    // Doubles: blank switches hammer. Fours: blank keeps hammer.
    if (format === 'doubles') return hammerThisEnd === 0 ? 1 : 0;
    return hammerThisEnd;
  }
  return hammerAfterNonBlankEnd(entry) ?? hammerThisEnd;
}

/**
 * Who has hammer (last stone) for endIndex (0-based).
 * Needs consecutive filled ends before `endIndex`.
 * When LSFE is unset, hammer can still be deduced once a prior non-blank end exists
 * (that result alone determines who throws last on the following end).
 */
export function hammerSlotForEnd(
  endIndex: number,
  firstEndHammerSlot: 0 | 1 | null,
  entries: Array<EndScorePoints | null>,
  format: TournamentFormat,
): 0 | 1 | null {
  if (endIndex < 0) return null;
  if (endIndex === 0) {
    return firstEndHammerSlot === 0 || firstEndHammerSlot === 1 ? firstEndHammerSlot : null;
  }

  for (let i = 0; i < endIndex; i++) {
    if (entries[i] == null) return null;
  }

  if (firstEndHammerSlot === 0 || firstEndHammerSlot === 1) {
    let hammer: 0 | 1 = firstEndHammerSlot;
    for (let i = 0; i < endIndex; i++) {
      hammer = nextHammerAfterEnd(hammer, entries[i]!, format);
    }
    return hammer;
  }

  // LSFE unset: walk forward from the latest non-blank end before endIndex.
  let lastNonBlank = -1;
  for (let i = endIndex - 1; i >= 0; i--) {
    if (!isBlankEnd(entries[i]!)) {
      lastNonBlank = i;
      break;
    }
  }
  if (lastNonBlank < 0) return null;

  let hammer = hammerAfterNonBlankEnd(entries[lastNonBlank]!);
  if (hammer == null) return null;
  for (let i = lastNonBlank + 1; i < endIndex; i++) {
    hammer = nextHammerAfterEnd(hammer, entries[i]!, format);
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
  if (format !== 'doubles') return [];
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
