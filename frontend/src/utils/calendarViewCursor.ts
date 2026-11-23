export type CalendarViewName = 'day' | 'week' | 'month';

export type CalendarViewCursor = {
  date: string;
  view: CalendarViewName;
};

type CursorStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function storageKey(publicMode: boolean): string {
  return publicMode ? 'tbs:calendar-view-cursor:public' : 'tbs:calendar-view-cursor:member';
}

function browserStorage(): CursorStorage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function parseCalendarViewName(value: string | null | undefined): CalendarViewName {
  if (value === 'day' || value === 'week' || value === 'month') return value;
  return 'month';
}

/** True for a real calendar day (`YYYY-MM-DD`), rejecting overflow like 2026-02-31. */
export function isCalendarDateParam(value: string | null | undefined): value is string {
  if (!value) return false;
  const match = DATE_RE.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function readCalendarViewCursor(
  publicMode: boolean,
  storage: CursorStorage | null = browserStorage()
): CalendarViewCursor | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(publicMode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { date?: unknown; view?: unknown };
    if (typeof parsed.date !== 'string' || !isCalendarDateParam(parsed.date)) return null;
    return {
      date: parsed.date,
      view: parseCalendarViewName(typeof parsed.view === 'string' ? parsed.view : null),
    };
  } catch {
    return null;
  }
}

export function writeCalendarViewCursor(
  publicMode: boolean,
  cursor: CalendarViewCursor,
  storage: CursorStorage | null = browserStorage()
): void {
  if (!storage || !isCalendarDateParam(cursor.date)) return;
  try {
    storage.setItem(
      storageKey(publicMode),
      JSON.stringify({
        date: cursor.date,
        view: parseCalendarViewName(cursor.view),
      })
    );
  } catch {
    // Private mode and quota errors should not block navigation.
  }
}

export function calendarLocationSearch(date: string, view: CalendarViewName): string {
  return `date=${date}&view=${parseCalendarViewName(view)}`;
}

/**
 * Where to send someone back to the calendar from the editor.
 * Prefer the date and view on the editor URL. If that date is missing, use the
 * last dated calendar URL in this tab. Otherwise `/calendar`, which is the
 * current month.
 */
export function calendarReturnPath(
  searchParams: { get(name: string): string | null },
  options?: { publicMode?: boolean; storage?: CursorStorage | null }
): string {
  const publicMode = options?.publicMode ?? false;
  const storage = options && 'storage' in options ? options.storage ?? null : browserStorage();
  const fromQuery = searchParams.get('date')?.trim();
  const view = parseCalendarViewName(searchParams.get('view'));
  if (isCalendarDateParam(fromQuery)) {
    return `/calendar?${calendarLocationSearch(fromQuery, view)}`;
  }
  const stored = readCalendarViewCursor(publicMode, storage);
  if (stored) return `/calendar?${calendarLocationSearch(stored.date, stored.view)}`;
  return '/calendar';
}
