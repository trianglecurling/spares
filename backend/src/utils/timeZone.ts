/**
 * Convert club-local wall-clock date/time values into UTC instants.
 * League draw times and similar fields are stored without a timezone and mean
 * "local time in config.timeZone" (default America/New_York).
 */

type DateTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second?: string;
};

function extractDateTimeParts(date: Date, timeZone: string, includeSeconds = false): DateTimeParts | null {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' as const } : {}),
    hourCycle: 'h23',
  });

  const parts: Partial<DateTimeParts> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type === 'year') parts.year = part.value;
    if (part.type === 'month') parts.month = part.value;
    if (part.type === 'day') parts.day = part.value;
    if (part.type === 'hour') parts.hour = part.value;
    if (part.type === 'minute') parts.minute = part.value;
    if (part.type === 'second') parts.second = part.value;
  }

  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) {
    return null;
  }
  if (includeSeconds && !parts.second) {
    return null;
  }

  return parts as DateTimeParts;
}

/** Offset of `timeZone` at `date`, in minutes east of UTC (e.g. EDT => -240). */
export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = extractDateTimeParts(date, timeZone, true);
  if (!parts || !parts.second) return 0;

  const asUtcFromParts = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return (asUtcFromParts - date.getTime()) / 60000;
}

/**
 * Interpret `dateStr` (YYYY-MM-DD) + `timeStr` (HH:MM or HH:MM:SS) as wall clock
 * in `timeZone` and return the corresponding UTC Date.
 */
export function localDateTimeToUtcDate(dateStr: string, timeStr: string, timeZone: string): Date {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(timeStr);
  if (!dateMatch || !timeMatch) {
    return new Date(NaN);
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? '0');

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offsetMinutes * 60000);
}

export function localDateTimeToIso(dateStr: string, timeStr: string, timeZone: string): string {
  return localDateTimeToUtcDate(dateStr, timeStr, timeZone).toISOString();
}
