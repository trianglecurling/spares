/**
 * Waitlist queue order: a stored frozen prefix plus a live-sorted unfrozen remainder.
 *
 * Rendered order is:
 * 1. The first `frozenEntryCount` entries in stored `position_sort_key` order (staff-locked).
 * 2. Remaining entries sorted by club tenure, then the configured tie-breaker, then a stable
 *    hash of entry id.
 *
 * Lifetime members are inserted into the frozen prefix after the last lifetime member already
 * in that prefix (or at the top when none exist). Staff may still place anyone, including
 * ahead of lifetime members, by editing stored frozen order.
 */

export type WaitlistQueueOrderEntry = {
  id: number;
  positionSortKey: string;
  joinedAtMs: number;
  isLifetimeMember: boolean;
  clubTenureYears: number;
  tieBreakerYears: number;
};

export function compactWaitlistPositionSortKey(index: number, entryId: number): string {
  return `${String(index + 1).padStart(6, '0')}:${entryId}`;
}

export function clampFrozenEntryCount(frozenEntryCount: number, totalEntries: number): number {
  if (!Number.isFinite(frozenEntryCount) || frozenEntryCount <= 0) return 0;
  if (totalEntries <= 0) return 0;
  return Math.min(Math.floor(frozenEntryCount), totalEntries);
}

export function compareStoredWaitlistOrder(
  a: Pick<WaitlistQueueOrderEntry, 'positionSortKey' | 'joinedAtMs' | 'id'>,
  b: Pick<WaitlistQueueOrderEntry, 'positionSortKey' | 'joinedAtMs' | 'id'>,
): number {
  if (a.positionSortKey !== b.positionSortKey) {
    return a.positionSortKey < b.positionSortKey ? -1 : 1;
  }
  if (a.joinedAtMs !== b.joinedAtMs) return a.joinedAtMs - b.joinedAtMs;
  return a.id - b.id;
}

/** Stable across renders; does not reshuffle when the same entries are compared again. */
export function stableWaitlistTieBreak(entryId: number): number {
  let x = Math.imul(entryId ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

export function compareUnfrozenWaitlistEntries(
  a: Pick<WaitlistQueueOrderEntry, 'clubTenureYears' | 'tieBreakerYears' | 'id'>,
  b: Pick<WaitlistQueueOrderEntry, 'clubTenureYears' | 'tieBreakerYears' | 'id'>,
): number {
  if (a.clubTenureYears !== b.clubTenureYears) return b.clubTenureYears - a.clubTenureYears;
  if (a.tieBreakerYears !== b.tieBreakerYears) return b.tieBreakerYears - a.tieBreakerYears;
  const tie = stableWaitlistTieBreak(a.id) - stableWaitlistTieBreak(b.id);
  if (tie !== 0) return tie;
  return a.id - b.id;
}

export function sortWaitlistQueue<T extends WaitlistQueueOrderEntry>(
  entries: T[],
  frozenEntryCount: number,
): T[] {
  const stored = [...entries].sort(compareStoredWaitlistOrder);
  const frozenCount = clampFrozenEntryCount(frozenEntryCount, stored.length);
  const frozen = stored.slice(0, frozenCount);
  const unfrozen = stored.slice(frozenCount).sort(compareUnfrozenWaitlistEntries);
  return [...frozen, ...unfrozen];
}

/** Insert after the last lifetime member in the frozen prefix, or at index 0 when none exist. */
export function lifetimeInsertIndex(frozenEntries: Array<{ isLifetimeMember: boolean }>): number {
  let lastLifetimeIndex = -1;
  for (let index = 0; index < frozenEntries.length; index += 1) {
    if (frozenEntries[index]?.isLifetimeMember) lastLifetimeIndex = index;
  }
  return lastLifetimeIndex + 1;
}

export function nextFrozenEntryCountAfterRemoval(
  frozenEntryCount: number,
  storedIndex: number | null | undefined,
): number {
  if (storedIndex == null || storedIndex < 0) return Math.max(0, frozenEntryCount);
  if (storedIndex >= frozenEntryCount) return Math.max(0, frozenEntryCount);
  return Math.max(0, frozenEntryCount - 1);
}

export function storedIndexById<T extends { id: number }>(
  storedEntries: T[],
  entryId: number,
): number | null {
  const index = storedEntries.findIndex((entry) => entry.id === entryId);
  return index >= 0 ? index : null;
}
