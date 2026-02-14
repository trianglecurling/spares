/**
 * Shared utilities for computing league draw schedules.
 */

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
