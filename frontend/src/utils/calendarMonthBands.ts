/**
 * Month-view band packing: multi-day overlays keep a stable bandIndex for the
 * week, which can leave holes on later days. Single-day chips must fill those
 * holes instead of always stacking below a top-N reservation.
 */

export type MonthDayPackedSlot<T> =
  | { type: 'spacer' }
  | { type: 'event'; event: T };

/** How many of the first `slotCount` band rows are free for in-cell events. */
export function countFreeMonthDaySlots(
  occupiedBandIndices: readonly number[],
  slotCount: number
): number {
  if (slotCount <= 0) return 0;
  const occupied = new Set(occupiedBandIndices);
  let free = 0;
  for (let i = 0; i < slotCount; i++) {
    if (!occupied.has(i)) free++;
  }
  return free;
}

/**
 * Place `events` into unoccupied band rows, inserting spacers where a
 * multi-day overlay already occupies that index.
 */
export function packMonthDayEventSlots<T>(
  occupiedBandIndices: readonly number[],
  events: readonly T[]
): Array<MonthDayPackedSlot<T>> {
  if (events.length === 0) return [];
  const occupied = new Set(occupiedBandIndices);
  const slots: Array<MonthDayPackedSlot<T>> = [];
  let eventIndex = 0;
  let band = 0;
  while (eventIndex < events.length) {
    if (occupied.has(band)) {
      slots.push({ type: 'spacer' });
    } else {
      slots.push({ type: 'event', event: events[eventIndex]! });
      eventIndex++;
    }
    band++;
  }
  return slots;
}
