import { config } from '../config.js';
import { formatDateInTimeZone } from './timeZone.js';

export type FormattedEventWhen = {
  text: string;
  html: string;
};

type EventTimespanLike = {
  start_dt?: string;
  end_dt?: string;
  startDt?: string;
  endDt?: string;
  sort_order?: number;
  sortOrder?: number;
};

const LONG_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
};

function sameClubCalendarDay(start: Date, end: Date, timeZone: string): boolean {
  const startDay = formatDateInTimeZone(start, timeZone);
  const endDay = formatDateInTimeZone(end, timeZone);
  return Boolean(startDay && startDay === endDay);
}

function formatInClubZone(date: Date, options: Intl.DateTimeFormatOptions, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(date);
}

function formatOneTimespan(startDt: string, endDt: string, timeZone: string): { text: string; html: string } {
  try {
    const start = new Date(startDt);
    const end = new Date(endDt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return { text: startDt, html: startDt };
    }

    const startTime = formatInClubZone(start, TIME_FORMAT, timeZone);
    const endTime = formatInClubZone(end, TIME_FORMAT, timeZone);
    if (sameClubCalendarDay(start, end, timeZone)) {
      const date = formatInClubZone(start, LONG_DATE_FORMAT, timeZone);
      const timeRange = `${startTime} to ${endTime}`;
      return {
        text: `${date}\n${timeRange}`,
        html: `${date}<br>${timeRange}`,
      };
    }

    const startDate = formatInClubZone(start, LONG_DATE_FORMAT, timeZone);
    const endDate = formatInClubZone(end, LONG_DATE_FORMAT, timeZone);
    return {
      text: `Start: ${startDate}, ${startTime}\nEnd: ${endDate}, ${endTime}`,
      html: `Start: ${startDate}, ${startTime}<br>End: ${endDate}, ${endTime}`,
    };
  } catch {
    return { text: startDt, html: startDt };
  }
}

/** Matches public event detail page timespan display (all spans, single- vs multi-day). */
export function formatEventTimespansForDisplay(
  timespans: EventTimespanLike[] | null | undefined,
  timeZone: string = config.timeZone,
): FormattedEventWhen {
  if (!timespans?.length) {
    return { text: 'TBD', html: 'TBD' };
  }

  const normalized = timespans
    .map((ts) => ({
      start: ts.start_dt ?? ts.startDt ?? '',
      end: ts.end_dt ?? ts.endDt ?? ts.start_dt ?? ts.startDt ?? '',
      sortOrder: ts.sort_order ?? ts.sortOrder ?? 0,
    }))
    .filter((ts) => ts.start.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.start.localeCompare(b.start));

  if (normalized.length === 0) {
    return { text: 'TBD', html: 'TBD' };
  }

  const formatted = normalized.map((ts) => formatOneTimespan(ts.start, ts.end, timeZone));
  return {
    text: formatted.map((part) => part.text).join('\n\n'),
    html: formatted.map((part) => part.html).join('<br><br>'),
  };
}

/** First timespan start in club time, e.g. "Tuesday, September 8, 2026 at 10:00 AM". */
export function formatEventStartForDisplay(
  timespans: EventTimespanLike[] | null | undefined,
  timeZone: string = config.timeZone,
): string | null {
  if (!timespans?.length) return null;

  const normalized = timespans
    .map((ts) => ({
      start: ts.start_dt ?? ts.startDt ?? '',
      sortOrder: ts.sort_order ?? ts.sortOrder ?? 0,
    }))
    .filter((ts) => ts.start.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.start.localeCompare(b.start));

  const startDt = normalized[0]?.start;
  if (!startDt) return null;

  try {
    const start = new Date(startDt);
    if (Number.isNaN(start.getTime())) return null;
    const date = formatInClubZone(start, LONG_DATE_FORMAT, timeZone);
    const time = formatInClubZone(start, TIME_FORMAT, timeZone);
    return `${date} at ${time}`;
  } catch {
    return null;
  }
}
