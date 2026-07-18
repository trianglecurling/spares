/**
 * Fiscal / curling season bounds using governance "fiscal year start" (MM-DD each year).
 * Season "2025-26" runs from fiscal start in 2025 through the instant before fiscal start in 2026.
 */

export { EVENT_CALENDAR_TYPE_OPTIONS } from './eventCalendarTypes';

export function parseFiscalYearStartMmdd(mmdd: string | undefined | null): { month: number; day: number } {
  const s = (mmdd ?? '09-01').trim();
  const parts = s.split('-').map((p) => parseInt(p, 10));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    return { month: parts[0], day: parts[1] };
  }
  return { month: 9, day: 1 };
}

/** Calendar year the season *starts* in (e.g. Sept 1 FY → a date in Oct 2025 has start year 2025). */
export function getSeasonStartYearForUtcDate(
  d: Date,
  fiscal: { month: number; day: number },
): number {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (m > fiscal.month || (m === fiscal.month && day >= fiscal.day)) {
    return y;
  }
  return y - 1;
}

export function formatTwoYearSeasonLabel(seasonStartYear: number): string {
  const y2 = seasonStartYear + 1;
  const second = y2 % 100;
  return `${seasonStartYear}-${second.toString().padStart(2, '0')}`;
}

/** [start, end) in ISO UTC; overlap test: latestEnd > start && earliestStart < end */
export function getSeasonUtcRangeIso(
  seasonStartYear: number,
  fiscal: { month: number; day: number },
): { startIso: string; endIsoExclusive: string } {
  const startMs = Date.UTC(seasonStartYear, fiscal.month - 1, fiscal.day, 0, 0, 0, 0);
  const endMs = Date.UTC(seasonStartYear + 1, fiscal.month - 1, fiscal.day, 0, 0, 0, 0);
  return { startIso: new Date(startMs).toISOString(), endIsoExclusive: new Date(endMs).toISOString() };
}

export function eventOverlapsRangeUtc(
  timespans: Array<{ start_dt: string; end_dt: string }> | undefined,
  rangeStartIso: string,
  rangeEndIsoExclusive: string,
): boolean {
  if (!timespans || timespans.length === 0) return false;
  const earliest = timespans.reduce(
    (min, ts) => (ts.start_dt < min ? ts.start_dt : min),
    timespans[0].start_dt,
  );
  const latest = timespans.reduce(
    (max, ts) => (ts.end_dt > max ? ts.end_dt : max),
    timespans[0].end_dt,
  );
  return latest > rangeStartIso && earliest < rangeEndIsoExclusive;
}

export function isUpcomingEventUtc(
  timespans: Array<{ start_dt: string; end_dt: string }> | undefined,
  nowMs: number,
): boolean {
  if (!timespans || timespans.length === 0) return true;
  const latestEnd = timespans.reduce(
    (max, ts) => (ts.end_dt > max ? ts.end_dt : max),
    timespans[0].end_dt,
  );
  return new Date(latestEnd).getTime() >= nowMs;
}

export function getEarliestStartMs(
  timespans: Array<{ start_dt: string; end_dt: string }> | undefined,
): number {
  if (!timespans || timespans.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(
    ...timespans.map((ts) => {
      const t = new Date(ts.start_dt).getTime();
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    }),
  );
}
