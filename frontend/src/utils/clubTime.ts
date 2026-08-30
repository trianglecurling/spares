/**
 * Club-local time. Every wall-clock value in the product is interpreted and
 * displayed in this zone (from TIME_ZONE / public-config), never the device zone.
 * Recurring times stay on the same local hour across DST.
 */

export const DEFAULT_CLUB_TIME_ZONE = 'America/New_York';

type DateTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second?: string;
};

let resolvedClubTimeZone = DEFAULT_CLUB_TIME_ZONE;

export function getClubTimeZone(): string {
  return resolvedClubTimeZone;
}

export function setClubTimeZone(timeZone: string | null | undefined): void {
  const trimmed = timeZone?.trim();
  resolvedClubTimeZone = trimmed || DEFAULT_CLUB_TIME_ZONE;
}

function extractDateTimeParts(date: Date, timeZone: string, includeSeconds = false): DateTimeParts | null {
  if (Number.isNaN(date.getTime())) return null;
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
 * in `timeZone` and return the corresponding UTC Date. Uses a two-pass offset
 * so DST transitions resolve to the offset that actually applies at that instant.
 */
export function localDateTimeToUtcDate(
  dateStr: string,
  timeStr: string,
  timeZone: string = getClubTimeZone()
): Date {
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
  let offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone);
  let instant = utcGuess - offsetMinutes * 60000;
  offsetMinutes = getTimeZoneOffsetMinutes(new Date(instant), timeZone);
  instant = utcGuess - offsetMinutes * 60000;
  return new Date(instant);
}

export function localDateTimeToIso(
  dateStr: string,
  timeStr: string,
  timeZone: string = getClubTimeZone()
): string {
  return localDateTimeToUtcDate(dateStr, timeStr, timeZone).toISOString();
}

/** Calendar date (YYYY-MM-DD) of an instant in `timeZone`. */
export function formatDateInTimeZone(date: Date, timeZone: string = getClubTimeZone()): string | null {
  const parts = extractDateTimeParts(date, timeZone);
  if (!parts) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Wall-clock time (HH:MM:SS) of an instant in `timeZone`. */
export function formatTimeInTimeZone(date: Date, timeZone: string = getClubTimeZone()): string | null {
  const parts = extractDateTimeParts(date, timeZone, true);
  if (!parts || !parts.second) return null;
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

export function addCalendarDays(ymd: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Date whose local Y/M/D/H/M/S match club wall-clock. Use only for calendar
 * grid math (date-fns startOfDay/format/getHours). Never call toISOString()
 * on the result — convert back with floatingDateToIso.
 */
export function instantToFloatingDate(iso: string | Date, timeZone: string = getClubTimeZone()): Date {
  const date = iso instanceof Date ? iso : new Date(iso);
  const parts = extractDateTimeParts(date, timeZone, true);
  if (!parts || !parts.second) return date;
  return new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
}

export function floatingDateToIso(date: Date, timeZone: string = getClubTimeZone()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return localDateTimeToIso(dateStr, timeStr, timeZone);
}

/** Club-local calendar date of `instant` as a midnight floating Date. */
export function clubCalendarDate(instant: Date = new Date(), timeZone: string = getClubTimeZone()): Date {
  const ymd = formatDateInTimeZone(instant, timeZone);
  if (!ymd) return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function parseClubDateParam(value: string | null | undefined, timeZone: string = getClubTimeZone()): Date {
  const match = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return clubCalendarDate(new Date(), timeZone);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** ISO timestamp -> `YYYY-MM-DDTHH:mm` for datetime-local inputs (club wall clock). */
export function isoToDateTimeLocal(iso: string | null | undefined, timeZone: string = getClubTimeZone()): string {
  if (!iso) return '';
  const date = new Date(iso);
  const parts = extractDateTimeParts(date, timeZone);
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** datetime-local `YYYY-MM-DDTHH:mm` -> UTC ISO, treating the value as club wall clock. */
export function dateTimeLocalToIso(value: string | null | undefined, timeZone: string = getClubTimeZone()): string {
  if (!value) return '';
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? '' : fallback.toISOString();
  }
  const seconds = match[3] ? `:${match[3]}` : ':00';
  return localDateTimeToIso(match[1], `${match[2]}${seconds}`, timeZone);
}

export function dateTimeLocalToIsoOrNull(
  value: string | null | undefined,
  timeZone: string = getClubTimeZone()
): string | null {
  const iso = dateTimeLocalToIso(value, timeZone);
  return iso || null;
}

export function addMinutesToDateTimeLocal(
  startLocal: string,
  minutes: number,
  timeZone: string = getClubTimeZone()
): string {
  const iso = dateTimeLocalToIso(startLocal, timeZone);
  if (!iso) return '';
  const shifted = new Date(new Date(iso).getTime() + minutes * 60 * 1000);
  return isoToDateTimeLocal(shifted.toISOString(), timeZone);
}

export function formatClubDateTime(
  value: string | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  timeZone: string = getClubTimeZone()
): string {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
    ...options,
  }).format(date);
}

export function formatClubDate(
  value: string | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  timeZone: string = getClubTimeZone()
): string {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
    ...options,
  }).format(date);
}

export function formatClubTime(
  value: string | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  timeZone: string = getClubTimeZone()
): string {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    ...options,
  }).format(date);
}

export function formatClubTimeZoneName(
  instant: Date = new Date(),
  timeZone: string = getClubTimeZone()
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(instant);
  return parts.find((part) => part.type === 'timeZoneName')?.value || timeZone;
}

export function clubTimeZoneHint(timeZone: string = getClubTimeZone()): string {
  const abbrev = formatClubTimeZoneName(new Date(), timeZone);
  return abbrev && abbrev !== timeZone
    ? `Times are in ${abbrev} (${timeZone}).`
    : `Times are in ${timeZone}.`;
}
