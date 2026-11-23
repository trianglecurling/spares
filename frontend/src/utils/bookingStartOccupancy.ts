/**
 * Which ice-booking start times can take a booking of the chosen length, and the
 * continuous stretches of blocked starts to paint on the day grid.
 *
 * Overlap is half-open: a booking that ends at the same instant an event starts
 * does not conflict.
 */

export type TimeSpan = { start: Date; end: Date };

export type SheetSpan = TimeSpan & {
  sheetIds: number[];
  title?: string;
};

export type BookingSlotUnavailableReason = 'past' | 'member_conflict' | 'sheets_busy';

export type StartSlotOccupancy = TimeSpan & {
  availableSheetIds: number[];
  unavailableReason?: BookingSlotUnavailableReason;
};

export type ShorterDurationSuggestion = {
  start: Date;
  durationMinutes: number;
  beforeTitle?: string;
};

const MS_MINUTE = 60_000;

function overlaps(span: TimeSpan, startMs: number, endMs: number): boolean {
  return span.start.getTime() < endMs && span.end.getTime() > startMs;
}

function byStart(a: TimeSpan, b: TimeSpan): number {
  return a.start.getTime() - b.start.getTime();
}

export function slotIsOpen(slot: StartSlotOccupancy): boolean {
  return !slot.unavailableReason && slot.availableSheetIds.length > 0;
}

/** Where a booking of `minutes` from `start` could go. Past starts are the caller's concern. */
function fitBooking(
  start: Date,
  minutes: number,
  sheetIds: number[],
  events: SheetSpan[],
  memberBookings: TimeSpan[]
): StartSlotOccupancy {
  const startMs = start.getTime();
  const end = new Date(startMs + minutes * MS_MINUTE);
  const endMs = end.getTime();
  if (memberBookings.some((booking) => overlaps(booking, startMs, endMs))) {
    return { start, end, availableSheetIds: [], unavailableReason: 'member_conflict' };
  }
  const availableSheetIds = sheetIds.filter(
    (sheetId) =>
      !events.some((event) => event.sheetIds.includes(sheetId) && overlaps(event, startMs, endMs))
  );
  if (availableSheetIds.length === 0) {
    return { start, end, availableSheetIds, unavailableReason: 'sheets_busy' };
  }
  return { start, end, availableSheetIds };
}

/**
 * Starts on `day` (floating midnight) from `earliestHour` whose booking of
 * `durationMinutes` ends by midnight. Fetched starts can be for a shorter duration
 * than the slider now shows.
 */
export function startsWithinDay<T extends TimeSpan>(
  slots: T[],
  day: Date,
  earliestHour: number,
  durationMinutes: number
): T[] {
  const earliestMs = new Date(day.getFullYear(), day.getMonth(), day.getDate(), earliestHour).getTime();
  const latestMs =
    new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() - durationMinutes * MS_MINUTE;
  return slots.filter((slot) => {
    const startMs = slot.start.getTime();
    return startMs >= earliestMs && startMs <= latestMs;
  });
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
  memberBookings: TimeSpan[] = []
): StartSlotOccupancy[] {
  if (sheetIds.length === 0) return slots;
  return slots.map((slot) =>
    slot.unavailableReason === 'past'
      ? {
          ...slot,
          end: new Date(slot.start.getTime() + durationMinutes * MS_MINUTE),
          availableSheetIds: [],
        }
      : fitBooking(slot.start, durationMinutes, sheetIds, events, memberBookings)
  );
}

function firstEventTitleFrom(time: Date, events: SheetSpan[]): string | undefined {
  const next = events
    .filter((event) => event.sheetIds.length > 0 && event.start.getTime() >= time.getTime())
    .sort(byStart)[0];
  return next?.title?.trim() || undefined;
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
  memberBookings?: TimeSpan[];
}): ShorterDurationSuggestion | null {
  const { slots, durationMinutes, sheetIds, events, minMinutes, stepMinutes } = params;
  const memberBookings = params.memberBookings ?? [];
  if (sheetIds.length === 0 || stepMinutes <= 0 || durationMinutes <= minMinutes) return null;

  const fits = (start: Date, minutes: number) =>
    slotIsOpen(fitBooking(start, minutes, sheetIds, events, memberBookings));
  const ahead = slots.filter((slot) => slot.unavailableReason !== 'past').sort(byStart);
  if (ahead.some((slot) => fits(slot.start, durationMinutes))) return null;

  for (const slot of ahead) {
    for (let minutes = durationMinutes - stepMinutes; minutes >= minMinutes; minutes -= stepMinutes) {
      if (!fits(slot.start, minutes)) continue;
      const end = new Date(slot.start.getTime() + minutes * MS_MINUTE);
      return { start: slot.start, durationMinutes: minutes, beforeTitle: firstEventTitleFrom(end, events) };
    }
  }
  return null;
}

/**
 * Contiguous runs of starts that are not open. Each range runs from the first
 * start through the end of the last start's step, so a lead-in meets the
 * blocking event.
 */
export function blockedStartRanges(slots: StartSlotOccupancy[], stepMinutes: number): TimeSpan[] {
  const stepMs = stepMinutes * MS_MINUTE;
  const ranges: TimeSpan[] = [];
  for (const slot of [...slots].sort(byStart)) {
    if (slotIsOpen(slot)) continue;
    const end = new Date(slot.start.getTime() + stepMs);
    const last = ranges[ranges.length - 1];
    if (last && slot.start.getTime() <= last.end.getTime()) {
      if (end > last.end) last.end = end;
    } else {
      ranges.push({ start: slot.start, end });
    }
  }
  return ranges;
}
