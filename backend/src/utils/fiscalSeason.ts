/**
 * Public event season bounds using governance fiscal year start (MM-DD each year).
 * Matches semantics in frontend/src/utils/fiscalSeason.ts.
 */

export function parseFiscalYearStartMmdd(mmdd: string | undefined | null): { month: number; day: number } {
  const s = (mmdd ?? '09-01').trim();
  const parts = s.split('-').map((p) => parseInt(p, 10));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    return { month: parts[0], day: parts[1] };
  }
  return { month: 9, day: 1 };
}

export function getSeasonStartYearForUtcDate(d: Date, fiscal: { month: number; day: number }): number {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (m > fiscal.month || (m === fiscal.month && day >= fiscal.day)) {
    return y;
  }
  return y - 1;
}

export function getSeasonUtcRangeIso(
  seasonStartYear: number,
  fiscal: { month: number; day: number },
): { startIso: string; endIsoExclusive: string } {
  const startMs = Date.UTC(seasonStartYear, fiscal.month - 1, fiscal.day, 0, 0, 0, 0);
  const endMs = Date.UTC(seasonStartYear + 1, fiscal.month - 1, fiscal.day, 0, 0, 0, 0);
  return { startIso: new Date(startMs).toISOString(), endIsoExclusive: new Date(endMs).toISOString() };
}

/** All fiscal season start years (e.g. 2025 for 2025-26) that overlap [earliestIso, latestIso] on the calendar. */
export function seasonStartYearsTouchingRangeUtc(
  earliestIso: string,
  latestIso: string,
  fiscal: { month: number; day: number },
): number[] {
  let a = earliestIso;
  let b = latestIso;
  if (a > b) {
    const t = a;
    a = b;
    b = t;
  }
  const d0 = new Date(a);
  const d1 = new Date(b);
  if (Number.isNaN(d0.getTime()) || Number.isNaN(d1.getTime())) {
    return [];
  }
  const yMin = getSeasonStartYearForUtcDate(d0, fiscal);
  const yMax = getSeasonStartYearForUtcDate(d1, fiscal);
  const out: number[] = [];
  for (let y = yMin - 1; y <= yMax + 1; y += 1) {
    const { startIso, endIsoExclusive } = getSeasonUtcRangeIso(y, fiscal);
    if (b > startIso && a < endIsoExclusive) {
      out.push(y);
    }
  }
  return out;
}
