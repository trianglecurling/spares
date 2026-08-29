/**
 * Club operating “day”: 4:00am through 3:59am the next calendar morning
 * (half-open window [04:00, next 04:00) in the club time zone).
 */

import {
  addCalendarDays,
  formatDateInTimeZone,
  formatTimeInTimeZone,
  localDateTimeToUtcDate,
} from './timeZone.js';

export const CLUB_OPERATING_DAY_START_HOUR = 4;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isClubOperatingDateString(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

/** Operating date (YYYY-MM-DD) that contains `instant` in `timeZone`. */
export function clubOperatingDateFromInstant(instant: Date, timeZone: string): string | null {
  const dateStr = formatDateInTimeZone(instant, timeZone);
  const timeStr = formatTimeInTimeZone(instant, timeZone);
  if (!dateStr || !timeStr) return null;
  const hour = Number.parseInt(timeStr.slice(0, 2), 10);
  if (!Number.isFinite(hour)) return null;
  if (hour < CLUB_OPERATING_DAY_START_HOUR) {
    return addCalendarDays(dateStr, -1);
  }
  return dateStr;
}

export function clubOperatingDayWindow(
  date: string,
  timeZone: string
): { dayStart: Date; dayEnd: Date } {
  const dayStart = localDateTimeToUtcDate(date, '04:00', timeZone);
  const dayEnd = localDateTimeToUtcDate(addCalendarDays(date, 1), '04:00', timeZone);
  return { dayStart, dayEnd };
}

/** Parse a datetime-local (`YYYY-MM-DDTHH:MM`) as club-local time, or a full ISO instant. */
export function parseFlexibleDateTime(raw: string | null | undefined, timeZone: string): Date | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const localMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/.exec(trimmed);
  if (localMatch) {
    const parsed = localDateTimeToUtcDate(localMatch[1]!, localMatch[2]!, timeZone);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const instant = new Date(trimmed);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

export function toIsoTimestamp(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export function intervalsOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && endA > startB;
}
