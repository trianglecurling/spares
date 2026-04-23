import { EVENT_CALENDAR_TYPE_OPTIONS } from './fiscalSeason';

const TYPE_BADGE_CLASS: Record<string, string> = {
  bonspiel: 'bg-violet-100 text-violet-900 border border-violet-200/80 dark:border-violet-500/30',
  'learn-to-curl': 'bg-teal-100 text-teal-900 border border-teal-200/80 dark:border-teal-500/30',
  juniors: 'bg-amber-100 text-amber-900 border border-amber-200/80 dark:border-amber-500/30',
  other: 'bg-gray-200 text-gray-900 border border-gray-300/80 dark:border-gray-500/30',
};

const CATEGORY_BADGE_CLASSES = [
  'bg-sky-100 text-sky-900 border border-sky-200/80 dark:border-sky-500/30',
  'bg-rose-100 text-rose-900 border border-rose-200/80 dark:border-rose-500/30',
  'bg-indigo-100 text-indigo-900 border border-indigo-200/80 dark:border-indigo-500/30',
  'bg-lime-100 text-lime-900 border border-lime-200/80 dark:border-lime-500/30',
  'bg-cyan-100 text-cyan-900 border border-cyan-200/80 dark:border-cyan-500/30',
] as const;

const EN_DASH = '\u2013';

const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function sameLocalCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 12h clock `h:mm` and `am` | `pm` (lowercase, no space before). */
function clock12Parts(d: Date): { clock: string; ampm: 'am' | 'pm' } {
  const h24 = d.getHours();
  const min = d.getMinutes();
  const ampm: 'am' | 'pm' = h24 < 12 ? 'am' : 'pm';
  let h = h24 % 12;
  if (h === 0) h = 12;
  const clock = `${h}:${String(min).padStart(2, '0')}`;
  return { clock, ampm };
}

/**
 * Multi-day (local) range: repeat month/year only when it changes, e.g.
 * September 25–27, 2026 / September 30–October 3, 2026 / December 31, 2026–January 1, 2027
 */
function formatLocalMultiDayRange(start: Date, end: Date): string {
  const y0 = start.getFullYear();
  const m0 = start.getMonth();
  const d0 = start.getDate();
  const y1 = end.getFullYear();
  const m1 = end.getMonth();
  const d1 = end.getDate();
  const M0 = LONG_MONTHS[m0]!;
  const M1 = LONG_MONTHS[m1]!;

  if (y0 === y1) {
    if (m0 === m1) {
      return `${M0} ${d0}${EN_DASH}${d1}, ${y0}`;
    }
    return `${M0} ${d0}${EN_DASH}${M1} ${d1}, ${y0}`;
  }
  return `${M0} ${d0}, ${y0}${EN_DASH}${M1} ${d1}, ${y1}`;
}

/**
 * Same local day: e.g. April 3, 2026, 4:00–6:00pm or April 8, 2026, 11:00am–2:30pm
 */
function formatSameLocalDayLine(start: Date, end: Date): string {
  const m = start.getMonth();
  const d = start.getDate();
  const y = start.getFullYear();
  const monthName = LONG_MONTHS[m]!;
  const head = `${monthName} ${d}, ${y}, `;
  if (start.getTime() === end.getTime()) {
    const a = clock12Parts(start);
    return `${head}${a.clock}${a.ampm}`;
  }
  const s = clock12Parts(start);
  const e = clock12Parts(end);
  if (s.ampm === e.ampm) {
    return `${head}${s.clock}${EN_DASH}${e.clock}${e.ampm}`;
  }
  return `${head}${s.clock}${s.ampm}${EN_DASH}${e.clock}${e.ampm}`;
}

export function formatEventScheduleBlock(timespans: Array<{ start_dt: string; end_dt: string }>): {
  dateLine: string;
  timeLine: string | null;
} {
  if (!timespans.length) {
    return { dateLine: 'Date TBD', timeLine: null };
  }
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = Number.NEGATIVE_INFINITY;
  for (const t of timespans) {
    const s = new Date(t.start_dt).getTime();
    const e = new Date(t.end_dt).getTime();
    if (Number.isFinite(s)) minMs = Math.min(minMs, s);
    if (Number.isFinite(e)) maxMs = Math.max(maxMs, e);
  }
  if (minMs === Number.POSITIVE_INFINITY) {
    return { dateLine: 'Date TBD', timeLine: null };
  }
  if (maxMs === Number.NEGATIVE_INFINITY) {
    maxMs = minMs;
  }
  const start = new Date(minMs);
  const end = new Date(maxMs);
  if (sameLocalCalendarDay(start, end)) {
    return {
      dateLine: formatSameLocalDayLine(start, end),
      timeLine: null,
    };
  }
  return {
    dateLine: formatLocalMultiDayRange(start, end),
    timeLine: null,
  };
}

export function publicEventTypeLabel(calendarTypeId: string | undefined): string {
  const id = calendarTypeId ?? 'other';
  return EVENT_CALENDAR_TYPE_OPTIONS.find((o) => o.id === id)?.label ?? 'Other';
}

export function publicEventTypeBadgeClass(calendarTypeId: string | undefined): string {
  return TYPE_BADGE_CLASS[calendarTypeId ?? 'other'] ?? TYPE_BADGE_CLASS.other;
}

export function publicCategoryBadgeClass(categoryId: number): string {
  const i = ((categoryId % CATEGORY_BADGE_CLASSES.length) + CATEGORY_BADGE_CLASSES.length) % CATEGORY_BADGE_CLASSES.length;
  return CATEGORY_BADGE_CLASSES[i]!;
}
