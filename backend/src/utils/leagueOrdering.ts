import { inArray, sql } from 'drizzle-orm';
import type { getDrizzleDb } from '../db/drizzle-db.js';

type DrizzleBundle = ReturnType<typeof getDrizzleDb>;

export function normalizeDrawTimeForSort(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

export type LeagueDayDrawSortKey = {
  id: number;
  name: string;
  dayOfWeek: number;
};

/** Order leagues by calendar day-of-week, then earliest configured draw time, then name. */
export function compareLeaguesByDayThenFirstDraw(
  a: LeagueDayDrawSortKey,
  b: LeagueDayDrawSortKey,
  firstDrawByLeagueId: Map<number, string>
): number {
  const dowDiff = a.dayOfWeek - b.dayOfWeek;
  if (dowDiff !== 0) return dowDiff;

  const ta = firstDrawByLeagueId.get(a.id);
  const tb = firstDrawByLeagueId.get(b.id);
  const hasA = ta !== undefined && ta !== '';
  const hasB = tb !== undefined && tb !== '';
  if (hasA && hasB && ta !== tb) {
    return ta.localeCompare(tb);
  }
  if (hasA !== hasB) {
    return hasA ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

export function pickLeagueWithLatestStartDate<T extends { startDate: string; id: number }>(
  leagues: T[]
): T | null {
  if (leagues.length === 0) return null;
  return leagues.reduce((latest, league) => {
    const dateCmp = league.startDate.localeCompare(latest.startDate);
    if (dateCmp > 0) return league;
    if (dateCmp < 0) return latest;
    return league.id > latest.id ? league : latest;
  });
}

export async function loadFirstDrawTimeByLeagueId(
  db: DrizzleBundle['db'],
  schema: DrizzleBundle['schema'],
  leagueIds?: number[]
): Promise<Map<number, string>> {
  const query = db
    .select({
      league_id: schema.leagueDrawTimes.league_id,
      first_draw: sql<string>`min(${schema.leagueDrawTimes.draw_time})`,
    })
    .from(schema.leagueDrawTimes);

  const rows =
    leagueIds != null && leagueIds.length > 0
      ? await query.where(inArray(schema.leagueDrawTimes.league_id, leagueIds)).groupBy(schema.leagueDrawTimes.league_id)
      : await query.groupBy(schema.leagueDrawTimes.league_id);

  const firstDrawByLeagueId = new Map<number, string>();
  for (const row of rows) {
    firstDrawByLeagueId.set(row.league_id, normalizeDrawTimeForSort(row.first_draw));
  }
  return firstDrawByLeagueId;
}

export async function sortLeaguesByDayOfWeekThenFirstDrawTime<
  T extends { id: number; name: string; day_of_week: number },
>(db: DrizzleBundle['db'], schema: DrizzleBundle['schema'], leaguesUnsorted: T[]): Promise<T[]> {
  if (leaguesUnsorted.length === 0) return leaguesUnsorted;

  const firstDrawByLeagueId = await loadFirstDrawTimeByLeagueId(
    db,
    schema,
    leaguesUnsorted.map((league) => league.id)
  );

  return [...leaguesUnsorted].sort((a, b) =>
    compareLeaguesByDayThenFirstDraw(
      { id: a.id, name: a.name, dayOfWeek: a.day_of_week },
      { id: b.id, name: b.name, dayOfWeek: b.day_of_week },
      firstDrawByLeagueId
    )
  );
}
