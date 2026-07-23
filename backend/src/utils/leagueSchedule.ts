/**
 * Shared utilities for computing league draw schedules.
 */

export type LeaguePlayFormat = 'teams' | 'doubles' | 'instructional';

/** Default draw length by play format (teams/instructional: 120, doubles: 90). */
export function defaultDrawDurationMinutes(format: LeaguePlayFormat): number {
  return format === 'doubles' ? 90 : 120;
}

export function normalizeDrawTimeString(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (!match) return trimmed.slice(0, 5);
  const hours = String(Number.parseInt(match[1]!, 10)).padStart(2, '0');
  const minutes = match[2]!;
  return `${hours}:${minutes}`;
}

export type LeagueExtraDrawInput = { date: string; time: string };

/** Deduplicate and normalize extra draw date+time pairs. */
export function normalizeExtraDrawInputs(values: LeagueExtraDrawInput[]): LeagueExtraDrawInput[] {
  const seen = new Set<string>();
  const out: LeagueExtraDrawInput[] = [];
  for (const value of values) {
    const date = value.date?.trim().slice(0, 10) ?? '';
    const time = normalizeDrawTimeString(value.time ?? '');
    if (!date || !time) continue;
    const key = `${date}|${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date, time });
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return out;
}

/** True when date+time already falls on the league's recurring schedule (not an exception). */
export function isRegularLeagueDrawSlot(input: {
  date: string;
  time: string;
  dayOfWeek: number;
  drawTimes: string[];
  startDate: string;
  endDate: string;
  exceptions: Set<string>;
}): boolean {
  const date = input.date.slice(0, 10);
  const time = normalizeDrawTimeString(input.time);
  if (!date || !time) return false;
  if (date < input.startDate || date > input.endDate) return false;
  if (input.exceptions.has(date)) return false;
  if (getDayOfWeek(date) !== input.dayOfWeek) return false;
  const times = new Set(input.drawTimes.map((t) => normalizeDrawTimeString(t)));
  return times.has(time);
}

export function filterNonRegularExtraDraws(
  extraDraws: LeagueExtraDrawInput[],
  schedule: {
    dayOfWeek: number;
    drawTimes: string[];
    startDate: string;
    endDate: string;
    exceptions: string[];
  }
): LeagueExtraDrawInput[] {
  const exceptions = new Set(schedule.exceptions);
  return normalizeExtraDrawInputs(extraDraws).filter(
    (draw) =>
      !isRegularLeagueDrawSlot({
        date: draw.date,
        time: draw.time,
        dayOfWeek: schedule.dayOfWeek,
        drawTimes: schedule.drawTimes,
        startDate: schedule.startDate,
        endDate: schedule.endDate,
        exceptions,
      })
  );
}

function toDateParts(value: string) {
  const [year, month, day] = value.split('-').map((part) => parseInt(part, 10));
  return { year, month, day };
}

function formatDateString(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function addDays(dateStr: string, days: number) {
  const { year, month, day } = toDateParts(dateStr);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function getDayOfWeek(dateStr: string) {
  const { year, month, day } = toDateParts(dateStr);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function toDateStr(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

/**
 * Compute all draw dates for a league within a date range.
 * @param startDateStr League start date (YYYY-MM-DD)
 * @param endDateStr League end date (YYYY-MM-DD)
 * @param dayOfWeek 0=Sun, 6=Sat
 * @param exceptions Set of exception dates (YYYY-MM-DD) when league does not run
 * @param rangeStart Only include dates on or after this (Date or ISO string)
 * @param rangeEnd Only include dates on or before this (Date or ISO string)
 */
export function computeLeagueDrawDatesInRange(
  startDateStr: string,
  endDateStr: string,
  dayOfWeek: number,
  exceptions: Set<string>,
  rangeStart: string | Date,
  rangeEnd: string | Date
): string[] {
  const rangeStartStr = toDateStr(rangeStart);
  const rangeEndStr = toDateStr(rangeEnd);
  if (!startDateStr || !endDateStr) return [];
  if (startDateStr > endDateStr) return [];
  const effectiveStart = startDateStr > rangeStartStr ? startDateStr : rangeStartStr;
  const effectiveEnd = endDateStr < rangeEndStr ? endDateStr : rangeEndStr;
  if (effectiveStart > effectiveEnd) return [];

  const dates: string[] = [];
  const startDay = getDayOfWeek(effectiveStart);
  const daysUntilTarget = (dayOfWeek - startDay + 7) % 7;
  let currentDateStr = addDays(effectiveStart, daysUntilTarget);

  while (currentDateStr <= effectiveEnd) {
    if (!exceptions.has(currentDateStr)) {
      dates.push(currentDateStr);
    }
    currentDateStr = addDays(currentDateStr, 7);
  }
  return dates;
}
