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
  title?: string;
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

export function sheetsFreeForInterval(
  sheetIds: number[],
  bookingStart: Date,
  bookingEnd: Date,
  events: SheetSpan[]
): number[] {
  const bookingStartMs = bookingStart.getTime();
  const bookingEndMs = bookingEnd.getTime();
  return sheetIds.filter(
    (sheetId) =>
      !events.some((event) => event.sheetIds.includes(sheetId) && overlaps(event, bookingStartMs, bookingEndMs))
  );
}

function intervalOverlapsMember(
  bookingStartMs: number,
  bookingEndMs: number,
  memberBookings: Array<{ start: Date; end: Date }>
): boolean {
  return memberBookings.some(
    (booking) => booking.start.getTime() < bookingEndMs && booking.end.getTime() > bookingStartMs
  );
}

/**
 * Re-evaluate each start for the duration the member has selected.
 * A fetched slot can still say "busy" for a longer booking after the slider moves;
 * the events on the grid are what the member is looking at.
 * Starts the server marked as already begun stay unavailable.
 */
export function refitSlotsToDuration(
  slots: StartSlotOccupancy[],
  durationMinutes: number,
  sheetIds: number[],
  events: SheetSpan[],
  memberBookings: Array<{ start: Date; end: Date }> = []
): StartSlotOccupancy[] {
  if (sheetIds.length === 0) return slots;
  const durationMs = durationMinutes * 60_000;
  return slots.map((slot) => {
    const end = new Date(slot.start.getTime() + durationMs);
    if (slot.unavailableReason === 'past') {
      return { ...slot, end, availableSheetIds: [], unavailableReason: 'past' };
    }
    if (intervalOverlapsMember(slot.start.getTime(), end.getTime(), memberBookings)) {
      return { ...slot, end, availableSheetIds: [], unavailableReason: 'member_conflict' };
    }
    const availableSheetIds = sheetsFreeForInterval(sheetIds, slot.start, end, events);
    if (availableSheetIds.length === 0) {
      return { ...slot, end, availableSheetIds: [], unavailableReason: 'sheets_busy' };
    }
    return { start: slot.start, end, availableSheetIds };
  });
}

export type ShorterDurationSuggestion = {
  start: Date;
  durationMinutes: number;
  beforeTitle?: string;
};

function earliestLaterEventTitle(fittedEnd: Date, events: SheetSpan[]): string | undefined {
  const endMs = fittedEnd.getTime();
  const next = events
    .filter((event) => event.sheetIds.length > 0 && event.start.getTime() >= endMs)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const title = next?.title?.trim();
  return title || undefined;
}

/**
 * When the selected duration fits nowhere still ahead, the earliest start that
 * can take a shorter booking, and the longest step that fits there.
 */
export function suggestShorterDuration(params: {
  slots: StartSlotOccupancy[];
  durationMinutes: number;
  sheetIds: number[];
  events: SheetSpan[];
  minMinutes: number;
  stepMinutes: number;
  memberBookings?: Array<{ start: Date; end: Date }>;
}): ShorterDurationSuggestion | null {
  const { slots, durationMinutes, sheetIds, events, minMinutes, stepMinutes } = params;
  const memberBookings = params.memberBookings ?? [];
  if (sheetIds.length === 0 || stepMinutes <= 0 || durationMinutes <= minMinutes) return null;

  const ordered = [...slots].sort((a, b) => a.start.getTime() - b.start.getTime());
  const ahead = ordered.filter((slot) => slot.unavailableReason !== 'past');
  const fits = (start: Date, minutes: number) => {
    const end = new Date(start.getTime() + minutes * 60_000);
    if (intervalOverlapsMember(start.getTime(), end.getTime(), memberBookings)) return false;
    return sheetsFreeForInterval(sheetIds, start, end, events).length > 0;
  };

  if (ahead.some((slot) => fits(slot.start, durationMinutes))) return null;

  for (const slot of ahead) {
    let best: number | null = null;
    for (let minutes = minMinutes; minutes <= durationMinutes - stepMinutes; minutes += stepMinutes) {
      if (fits(slot.start, minutes)) best = minutes;
    }
    if (best == null) continue;
    const fittedEnd = new Date(slot.start.getTime() + best * 60_000);
    return {
      start: slot.start,
      durationMinutes: best,
      beforeTitle: earliestLaterEventTitle(fittedEnd, events),
    };
  }
  return null;
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
