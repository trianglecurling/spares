import rrule from 'rrule';
import {
  calendarDaysBetween,
  formatDateInTimeZone,
  formatTimeInTimeZone,
  localDateTimeToIso,
} from './timeZone.js';

const { RRule } = rrule;

export type CalendarRecurrenceInput = {
  rrule: string;
  /** YYYY-MM-DD inclusive series end */
  endDate?: string;
  count?: number;
};

export type ExpandedRecurrenceInstance = {
  start: string;
  end: string;
  /** Club-local calendar date (YYYY-MM-DD) for exception/override matching */
  recurrenceDate: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function addCalendarDays(ymd: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Treat club wall-clock parts as a floating UTC Date for RRule (DST-safe). */
function wallClockToFloatingUtc(dateStr: string, timeStr: string): Date {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(timeStr);
  if (!dateMatch || !timeMatch) return new Date(NaN);
  return new Date(
    Date.UTC(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      Number(timeMatch[1]),
      Number(timeMatch[2]),
      Number(timeMatch[3] ?? '0')
    )
  );
}

function floatingUtcToWallClock(dt: Date): { dateStr: string; timeStr: string } {
  return {
    dateStr: `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`,
    timeStr: `${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}:${pad2(dt.getUTCSeconds())}`,
  };
}

function floatingUntilEndOfDay(ymd: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return new Date(NaN);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59));
}

/**
 * Compose a stored RRULE that includes UNTIL/COUNT when the API sends them
 * as separate fields. The DB only has recurrence_rule text.
 *
 * UNTIL is stored as a floating end-of-day (UTC components = club calendar day)
 * so DST-safe expansion can compare like-for-like.
 */
export function composeRecurrenceRule(recurrence: CalendarRecurrenceInput): string {
  const base = recurrence.rrule.trim();
  if (!base) return base;

  const endDate = recurrence.endDate?.trim();
  const count =
    typeof recurrence.count === 'number' && Number.isFinite(recurrence.count) && recurrence.count > 0
      ? Math.floor(recurrence.count)
      : undefined;

  if (!endDate && count == null) {
    return base;
  }

  try {
    const options = RRule.parseString(base) as {
      until?: Date;
      count?: number;
      dtstart?: Date;
    };
    delete options.dtstart;

    if (endDate) {
      options.until = floatingUntilEndOfDay(endDate);
      delete options.count;
    } else if (count != null) {
      options.count = count;
      delete options.until;
    }

    const composed = RRule.optionsToString(options);
    return composed.replace(/^RRULE:/i, '').trim();
  } catch {
    const parts = [base];
    if (endDate) {
      parts.push(`UNTIL=${endDate.replace(/-/g, '')}T235959Z`);
    } else if (count != null) {
      parts.push(`COUNT=${count}`);
    }
    return parts.join(';');
  }
}

/**
 * Expand a recurrence rule while preserving club wall-clock time across DST.
 *
 * RRule runs on floating local timestamps (UTC components = club local parts);
 * each occurrence is then converted to a real UTC instant via config.timeZone.
 */
export function expandRecurrenceInTimeZone(
  startDt: string,
  endDt: string,
  recurrenceRule: string,
  rangeStart: Date,
  rangeEnd: Date,
  timeZone: string,
  endDate?: string,
  count?: number
): ExpandedRecurrenceInstance[] {
  try {
    const start = new Date(startDt);
    const end = new Date(endDt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

    const startDateStr = formatDateInTimeZone(start, timeZone);
    const startTimeStr = formatTimeInTimeZone(start, timeZone);
    const endDateStr = formatDateInTimeZone(end, timeZone);
    const endTimeStr = formatTimeInTimeZone(end, timeZone);
    if (!startDateStr || !startTimeStr || !endDateStr || !endTimeStr) return [];

    const daySpan = calendarDaysBetween(startDateStr, endDateStr);
    if (Number.isNaN(daySpan)) return [];

    const options = RRule.parseString(recurrenceRule) as {
      until?: Date;
      count?: number;
      dtstart?: Date;
      tzid?: string | null;
    };

    // Expand in floating club-local time; do not use rrule's tzid path.
    delete options.tzid;
    delete options.dtstart;

    const untilYmd = endDate?.trim() || (options.until ? formatDateInTimeZone(options.until, timeZone) : null);
    if (untilYmd) {
      options.until = floatingUntilEndOfDay(untilYmd);
      delete options.count;
    } else if (count != null && count > 0) {
      options.count = Math.floor(count);
      delete options.until;
    } else if (options.until) {
      // Stored UNTIL without a resolvable club-local date — keep floating EOD if possible.
      const floating = floatingUtcToWallClock(options.until);
      options.until = floatingUntilEndOfDay(floating.dateStr);
    }

    const floatingDtstart = wallClockToFloatingUtc(startDateStr, startTimeStr);
    options.dtstart = floatingDtstart;

    const rangeStartLocalDate = formatDateInTimeZone(rangeStart, timeZone);
    const rangeStartLocalTime = formatTimeInTimeZone(rangeStart, timeZone);
    const rangeEndLocalDate = formatDateInTimeZone(rangeEnd, timeZone);
    const rangeEndLocalTime = formatTimeInTimeZone(rangeEnd, timeZone);
    if (!rangeStartLocalDate || !rangeStartLocalTime || !rangeEndLocalDate || !rangeEndLocalTime) {
      return [];
    }

    // Widen floating bounds by a day so near-midnight UTC/local skew still yields candidates.
    const floatingRangeStart = wallClockToFloatingUtc(addCalendarDays(rangeStartLocalDate, -1), rangeStartLocalTime);
    const floatingRangeEnd = wallClockToFloatingUtc(addCalendarDays(rangeEndLocalDate, 1), rangeEndLocalTime);

    const rule = new RRule(options);
    const dates = rule.between(floatingRangeStart, floatingRangeEnd, true);

    const result: ExpandedRecurrenceInstance[] = [];
    for (const dt of dates) {
      const { dateStr } = floatingUtcToWallClock(dt);
      const instanceStart = localDateTimeToIso(dateStr, startTimeStr, timeZone);
      const instanceEndDate = addCalendarDays(dateStr, daySpan);
      const instanceEnd = localDateTimeToIso(instanceEndDate, endTimeStr, timeZone);
      const instStart = new Date(instanceStart);
      const instEnd = new Date(instanceEnd);
      if (Number.isNaN(instStart.getTime()) || Number.isNaN(instEnd.getTime())) continue;
      if (instEnd <= rangeStart || instStart >= rangeEnd) continue;
      result.push({
        start: instanceStart,
        end: instanceEnd,
        recurrenceDate: dateStr,
      });
    }
    return result;
  } catch {
    return [];
  }
}
