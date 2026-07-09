export type CalendarSheetOption = { id: number; name: string };

export type CalendarRangeCacheEntry<TEvent> = {
  events: TEvent[];
  sheets?: CalendarSheetOption[];
  fetchedAt: number;
};

/** How long a cached range is treated as fresh enough to skip a network refetch. */
export const CALENDAR_RANGE_STALE_MS = 5 * 60 * 1000;

const cacheByKey = new Map<string, CalendarRangeCacheEntry<unknown>>();

export function calendarRangeCacheKey(publicMode: boolean, rangeStart: Date, rangeEnd: Date): string {
  return `${publicMode ? 'public' : 'member'}:${rangeStart.toISOString()}:${rangeEnd.toISOString()}`;
}

export function getCachedCalendarRange<TEvent>(key: string): CalendarRangeCacheEntry<TEvent> | undefined {
  return cacheByKey.get(key) as CalendarRangeCacheEntry<TEvent> | undefined;
}

export function setCachedCalendarRange<TEvent>(
  key: string,
  entry: Omit<CalendarRangeCacheEntry<TEvent>, 'fetchedAt'>
): CalendarRangeCacheEntry<TEvent> {
  const stored: CalendarRangeCacheEntry<TEvent> = { ...entry, fetchedAt: Date.now() };
  cacheByKey.set(key, stored as CalendarRangeCacheEntry<unknown>);
  return stored;
}

export function isCalendarRangeFresh(entry: { fetchedAt: number }, now = Date.now()): boolean {
  return now - entry.fetchedAt < CALENDAR_RANGE_STALE_MS;
}

export function invalidateCalendarEventsCache(): void {
  cacheByKey.clear();
}
