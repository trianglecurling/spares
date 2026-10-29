export type PointerTargetRect = {
  id: string;
  top: number;
  bottom: number;
};

/**
 * Picks the row under a vertical drag, giving each row the gap halfway to its
 * neighbors. A pointer in that gap stays on a row instead of falling through
 * and collapsing the list shift.
 */
export function sortableItemAtPointer(items: readonly PointerTargetRect[], pointerY: number): string | null {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  for (let index = 0; index < sorted.length; index++) {
    const current = sorted[index]!;
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const topBound = previous ? (previous.bottom + current.top) / 2 : Number.NEGATIVE_INFINITY;
    const bottomBound = next ? (current.bottom + next.top) / 2 : Number.POSITIVE_INFINITY;
    if (pointerY >= topBound && pointerY < bottomBound) return current.id;
  }
  return sorted[sorted.length - 1]!.id;
}
