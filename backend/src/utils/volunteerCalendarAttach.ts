import { parseDirectCalendarFeedId } from '../services/calendarExpansion.js';

export type DirectCalendarEventChoice = {
  id: number;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  isRecurring: boolean;
};

/** Keep one row per series/root event, preferring the earliest occurrence in range. */
export function pickDirectCalendarEventsOverlappingRange(
  events: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    isRecurring?: boolean;
  }>,
  rangeStartIso: string,
  rangeEndIso: string
): DirectCalendarEventChoice[] {
  const byId = new Map<number, DirectCalendarEventChoice>();
  for (const event of events) {
    if (event.start >= rangeEndIso || event.end <= rangeStartIso) continue;
    const parsed = parseDirectCalendarFeedId(event.id);
    if (!parsed) continue;
    const existing = byId.get(parsed.dbId);
    if (!existing || event.start < existing.start) {
      byId.set(parsed.dbId, {
        id: parsed.dbId,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        isRecurring: Boolean(event.isRecurring),
      });
    }
  }
  return [...byId.values()].sort(
    (a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title)
  );
}

export type CalendarOccurrence = {
  start: string;
  end: string;
  recurrenceDate: string;
  allDay: boolean;
};

export function applyCalendarExceptionsAndOverrides(
  instances: Array<{ start: string; end: string; recurrenceDate: string }>,
  allDay: boolean,
  exceptions: Set<string>,
  overrides: Map<string, { start: string; end: string; allDay: boolean }>
): CalendarOccurrence[] {
  const occurrences: CalendarOccurrence[] = [];
  for (const instance of instances) {
    const override = overrides.get(instance.recurrenceDate);
    if (exceptions.has(instance.recurrenceDate) && !override) continue;
    if (override) {
      occurrences.push({
        start: override.start,
        end: override.end,
        recurrenceDate: instance.recurrenceDate,
        allDay: override.allDay,
      });
      continue;
    }
    occurrences.push({
      start: instance.start,
      end: instance.end,
      recurrenceDate: instance.recurrenceDate,
      allDay,
    });
  }
  return occurrences;
}

export function planCalendarSyncedShiftChanges(
  existing: Array<{ id: number; recurrenceDate: string | null }>,
  occurrences: CalendarOccurrence[],
  skipDates: Set<string> = new Set()
): {
  updates: Array<{ id: number; start: string; end: string; recurrenceDate: string }>;
  creates: CalendarOccurrence[];
  deleteIds: number[];
} {
  const kept = occurrences.filter((occurrence) => !skipDates.has(occurrence.recurrenceDate));
  const byDate = new Map(
    existing
      .filter((row) => row.recurrenceDate)
      .map((row) => [row.recurrenceDate as string, row])
  );
  const keepDates = new Set(kept.map((occurrence) => occurrence.recurrenceDate));
  const updates: Array<{ id: number; start: string; end: string; recurrenceDate: string }> = [];
  const creates: CalendarOccurrence[] = [];

  for (const occurrence of kept) {
    const current = byDate.get(occurrence.recurrenceDate);
    if (current) {
      updates.push({
        id: current.id,
        start: occurrence.start,
        end: occurrence.end,
        recurrenceDate: occurrence.recurrenceDate,
      });
    } else {
      creates.push(occurrence);
    }
  }

  const deleteIds = existing
    .filter((row) => !row.recurrenceDate || !keepDates.has(row.recurrenceDate))
    .map((row) => row.id);

  return { updates, creates, deleteIds };
}
