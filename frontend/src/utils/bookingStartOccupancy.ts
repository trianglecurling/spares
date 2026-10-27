/**
 * Which ice-booking start times cannot be used, and the continuous stretches of
 * those starts to paint on the day grid.
 *
 * A start is blocked when the server says so, or when the booking would overlap
 * something on every sheet. Overlap is half-open: a booking that ends at the
 * same instant an event starts does not conflict.
 */

export type SheetSpan = {
  start: Date;
  end: Date;
  sheetIds: number[];
};

export type StartSlotOccupancy = {
  start: Date;
  end: Date;
  availableSheetIds: number[];
  unavailableReason?: string;
};

function overlaps(event: SheetSpan, bookingStartMs: number, bookingEndMs: number): boolean {
  return event.start.getTime() < bookingEndMs && event.end.getTime() > bookingStartMs;
}

/** True when every sheet is occupied for the whole booking. */
export function startLeavesNoSheet(
  sheetIds: number[],
  bookingStart: Date,
  bookingEnd: Date,
  events: SheetSpan[]
): boolean {
  if (sheetIds.length === 0) return false;
  const bookingStartMs = bookingStart.getTime();
  const bookingEndMs = bookingEnd.getTime();
  return sheetIds.every((sheetId) =>
    events.some((event) => event.sheetIds.includes(sheetId) && overlaps(event, bookingStartMs, bookingEndMs))
  );
}

export function startSlotIsBlocked(
  slot: StartSlotOccupancy,
  sheetIds: number[],
  events: SheetSpan[]
): boolean {
  if (slot.unavailableReason || slot.availableSheetIds.length === 0) return true;
  return startLeavesNoSheet(sheetIds, slot.start, slot.end, events);
}

/**
 * Contiguous blocked starts. Each range runs from the first start through the
 * end of the last start's step, so a lead-in meets the blocking event.
 */
export function blockedStartRanges(
  slots: StartSlotOccupancy[],
  stepMinutes: number,
  sheetIds: number[],
  events: SheetSpan[]
): Array<{ start: Date; end: Date }> {
  const stepMs = stepMinutes * 60_000;
  const ordered = [...slots].sort((a, b) => a.start.getTime() - b.start.getTime());
  const ranges: Array<{ start: Date; end: Date }> = [];
  for (const slot of ordered) {
    if (!startSlotIsBlocked(slot, sheetIds, events)) continue;
    const end = new Date(slot.start.getTime() + stepMs);
    const last = ranges[ranges.length - 1];
    // 1ms slack: a step computed from slot timestamps can land a millisecond short.
    if (last && slot.start.getTime() <= last.end.getTime() + 1) {
      if (end.getTime() > last.end.getTime()) last.end = end;
    } else {
      ranges.push({ start: new Date(slot.start.getTime()), end });
    }
  }
  return ranges;
}

/** Abutting blocked ranges become one rectangle so the hatch is a single paint. */
export function hatchBands(
  ranges: Array<{ start: Date; end: Date }>,
  topFor: (value: Date) => number
): Array<{ top: number; height: number }> {
  const bands: Array<{ top: number; height: number }> = [];
  const ordered = ranges
    .map((range) => {
      const top = topFor(range.start);
      return { top, height: topFor(range.end) - top };
    })
    .filter((band) => band.height > 0)
    .sort((a, b) => a.top - b.top);
  for (const band of ordered) {
    const last = bands[bands.length - 1];
    if (last && band.top <= last.top + last.height + 1) {
      last.height = Math.max(last.top + last.height, band.top + band.height) - last.top;
    } else {
      bands.push({ top: band.top, height: band.height });
    }
  }
  return bands;
}
