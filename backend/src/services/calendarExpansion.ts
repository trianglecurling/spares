import { eq, and, or, sql, asc, isNotNull, gte, lte } from 'drizzle-orm';
import rrule from 'rrule';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { computeLeagueDrawDatesInRange } from '../utils/leagueSchedule.js';

const { RRule } = rrule;

export type ExpandedDirectCalendarEvent = {
  id: string;
  typeId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  locations?: Array<{ type: string; sheetId?: number; sheetName?: string }>;
  source: string;
  isRecurring?: boolean;
  recurrenceDate?: string;
  recurrenceRrule?: string;
  createdBy?: string;
  article?: { id: number; title: string; slug: string };
};

export type ExpandedLeagueCalendarEvent = {
  id: string;
  typeId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  source: string;
  locations?: Array<{ type: 'sheet'; sheetId: number; sheetName?: string }>;
};

function toEventId(event: { id: number; parent_event_id: number | null; recurrence_date: string | null }): string {
  if (event.recurrence_date && event.parent_event_id) {
    return `direct:${event.parent_event_id}:${event.recurrence_date}`;
  }
  return `direct:${event.id}`;
}

function expandRecurrence(
  startDt: string,
  endDt: string,
  _allDay: number,
  recurrenceRule: string,
  rangeStart: Date,
  rangeEnd: Date,
  endDate?: string,
  count?: number
): Array<{ start: string; end: string }> {
  try {
    const start = new Date(startDt);
    const end = new Date(endDt);
    const durationMs = end.getTime() - start.getTime();

    const options = RRule.parseString(recurrenceRule);
    if (endDate) {
      options.until = new Date(endDate + 'T23:59:59');
    }
    if (count) {
      options.count = count;
    }
    (options as { dtstart?: Date }).dtstart = start;

    const rule = new RRule(options);
    const dates = rule.between(rangeStart, rangeEnd, true);

    return dates.map((dt) => {
      const instanceStart = dt.toISOString();
      const instanceEnd = new Date(dt.getTime() + durationMs).toISOString();
      return { start: instanceStart, end: instanceEnd };
    });
  } catch {
    return [];
  }
}

/** Calendar + league events that appear on the member calendar, expanded into concrete intervals. */
export async function fetchDirectCalendarEventsForRange(
  rangeStart: Date,
  rangeEnd: Date
): Promise<ExpandedDirectCalendarEvent[]> {
  const { db, schema } = getDrizzleDb();

  const sheetRows = await db
    .select({ id: schema.sheets.id, name: schema.sheets.name })
    .from(schema.sheets)
    .orderBy(schema.sheets.sort_order, schema.sheets.name);
  const sheetNameById = new Map(sheetRows.map((s) => [s.id, s.name]));

  const events = await db
    .select()
    .from(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.source, 'direct'),
        sql`${schema.calendarEvents.parent_event_id} IS NULL`,
        sql`${schema.calendarEvents.recurrence_date} IS NULL`,
        sql`${schema.calendarEvents.start_dt} <= ${rangeEnd.toISOString()}`,
        or(
          sql`${schema.calendarEvents.recurrence_rule} IS NOT NULL`,
          sql`${schema.calendarEvents.end_dt} >= ${rangeStart.toISOString()}`
        )
      )
    );

  const overrides = await db
    .select()
    .from(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.source, 'direct'),
        sql`${schema.calendarEvents.parent_event_id} IS NOT NULL`,
        sql`${schema.calendarEvents.recurrence_date} IS NOT NULL`
      )
    );

  let exceptions: { parent_event_id: number; exception_date: string }[] = [];
  if (events.length > 0) {
    exceptions = await db
      .select()
      .from(schema.calendarEventExceptions)
      .where(
        sql`${schema.calendarEventExceptions.parent_event_id} IN (${sql.join(
          events.map((e) => sql`${e.id}`),
          sql`, `
        )})`
      );
  }

  const exceptionSet = new Set(exceptions.map((ex) => `${ex.parent_event_id}:${ex.exception_date}`));

  const locationsByEventId = new Map<number, Array<{ type: string; sheet_id: number | null }>>();
  const eventIds = [...events.map((e) => e.id), ...overrides.map((o) => o.id)];
  if (eventIds.length > 0) {
    const uniqueIds = [...new Set(eventIds)];
    const locRows = await db
      .select()
      .from(schema.calendarEventLocations)
      .where(sql`${schema.calendarEventLocations.event_id} IN (${sql.join(uniqueIds.map((id) => sql`${id}`), sql`, `)})`);

    for (const loc of locRows) {
      const arr = locationsByEventId.get(loc.event_id) ?? [];
      arr.push({ type: loc.location_type, sheet_id: loc.sheet_id });
      locationsByEventId.set(loc.event_id, arr);
    }
  }

  const creatorIds = [
    ...events.map((e) => e.created_by_member_id).filter((id): id is number => id != null),
    ...overrides.map((o) => o.created_by_member_id).filter((id): id is number => id != null),
  ];
  const uniqueCreatorIds = [...new Set(creatorIds)];
  const creatorNameById = new Map<number, string>();
  if (uniqueCreatorIds.length > 0) {
    const members = schema.members;
    const creatorRows = await db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(sql`${members.id} IN (${sql.join(uniqueCreatorIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const m of creatorRows) {
      creatorNameById.set(m.id, m.name);
    }
  }

  const articleIds = [
    ...events.map((e) => e.article_id).filter((id): id is number => id != null),
    ...overrides.map((o) => o.article_id).filter((id): id is number => id != null),
  ];
  const uniqueArticleIds = [...new Set(articleIds)];
  const articleById = new Map<number, { id: number; title: string; slug: string }>();
  if (uniqueArticleIds.length > 0) {
    const articleRows = await db
      .select({ id: schema.articles.id, title: schema.articles.title, slug: schema.articles.slug })
      .from(schema.articles)
      .where(sql`${schema.articles.id} IN (${sql.join(uniqueArticleIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const a of articleRows) {
      articleById.set(a.id, a);
    }
  }

  const result: ExpandedDirectCalendarEvent[] = [];

  for (const ev of events) {
    const locs = (locationsByEventId.get(ev.id) ?? []).map((l) => {
      if (l.type === 'sheet' && l.sheet_id) {
        return { type: 'sheet' as const, sheetId: l.sheet_id, sheetName: sheetNameById.get(l.sheet_id) };
      }
      return { type: l.type as 'warm-room' | 'exterior' | 'offsite' | 'virtual' };
    });

    if (ev.recurrence_rule) {
      const expanded = expandRecurrence(
        ev.start_dt,
        ev.end_dt,
        ev.all_day,
        ev.recurrence_rule,
        rangeStart,
        rangeEnd
      );
      for (const inc of expanded) {
        const incDate = inc.start.slice(0, 10);
        const override = overrides.find((o) => o.parent_event_id === ev.id && o.recurrence_date === incDate);
        if (exceptionSet.has(`${ev.id}:${incDate}`) && !override) continue;
        const instStart = new Date(inc.start);
        const instEnd = new Date(inc.end);
        if (instEnd <= rangeStart || instStart >= rangeEnd) continue;

        const useEv = override ?? ev;
        const useStart = override ? override.start_dt : inc.start;
        const useEnd = override ? override.end_dt : inc.end;

        result.push({
          id: override ? toEventId(override) : `direct:${ev.id}:${incDate}`,
          typeId: useEv.type_id,
          title: useEv.title,
          start: useStart,
          end: useEnd,
          allDay: useEv.all_day === 1,
          description: useEv.description ?? ev.description ?? undefined,
          locations: locs.length > 0 ? locs : undefined,
          source: 'direct',
          isRecurring: true,
          recurrenceDate: incDate,
          recurrenceRrule: ev.recurrence_rule ?? undefined,
          createdBy:
            (useEv.created_by_member_id ?? ev.created_by_member_id) != null
              ? creatorNameById.get(useEv.created_by_member_id ?? ev.created_by_member_id!)
              : undefined,
          article: useEv.article_id != null ? articleById.get(useEv.article_id) : undefined,
        });
      }
    } else {
      result.push({
        id: toEventId(ev),
        typeId: ev.type_id,
        title: ev.title,
        start: ev.start_dt,
        end: ev.end_dt,
        allDay: ev.all_day === 1,
        description: ev.description ?? undefined,
        locations: locs.length > 0 ? locs : undefined,
        source: 'direct',
        createdBy: ev.created_by_member_id != null ? creatorNameById.get(ev.created_by_member_id) : undefined,
        article: ev.article_id != null ? articleById.get(ev.article_id) : undefined,
      });
    }
  }

  for (const ov of overrides) {
    if (ov.parent_event_id && !events.some((e) => e.id === ov.parent_event_id)) {
      const locs = (locationsByEventId.get(ov.id) ?? []).map((l) => {
        if (l.type === 'sheet' && l.sheet_id) {
          return { type: 'sheet' as const, sheetId: l.sheet_id, sheetName: sheetNameById.get(l.sheet_id) };
        }
        return { type: l.type as 'warm-room' | 'exterior' | 'offsite' | 'virtual' };
      });
      result.push({
        id: toEventId(ov),
        typeId: ov.type_id,
        title: ov.title,
        start: ov.start_dt,
        end: ov.end_dt,
        allDay: ov.all_day === 1,
        description: ov.description ?? undefined,
        locations: locs.length > 0 ? locs : undefined,
        source: 'direct',
        isRecurring: true,
        recurrenceDate: ov.recurrence_date ?? undefined,
        createdBy: ov.created_by_member_id != null ? creatorNameById.get(ov.created_by_member_id) : undefined,
        article: ov.article_id != null ? articleById.get(ov.article_id) : undefined,
      });
    }
  }

  return result;
}

const LEAGUE_DRAW_DURATION_HOURS = 2;

export async function fetchLeagueCalendarEventsForRange(
  rangeStart: Date,
  rangeEnd: Date
): Promise<ExpandedLeagueCalendarEvent[]> {
  const { db, schema } = getDrizzleDb();

  const sheetRows = await db
    .select({ id: schema.sheets.id, name: schema.sheets.name })
    .from(schema.sheets)
    .orderBy(schema.sheets.sort_order, schema.sheets.name);
  const sheetNameById = new Map(sheetRows.map((s) => [s.id, s.name]));

  const leagues = await db.select().from(schema.leagues).orderBy(schema.leagues.day_of_week, schema.leagues.name);

  const rangeStartStr = rangeStart.toISOString().slice(0, 10);
  const rangeEndStr = rangeEnd.toISOString().slice(0, 10);
  const scheduledGamesInRange = await db
    .select({
      league_id: schema.games.league_id,
      game_date: schema.games.game_date,
      game_time: schema.games.game_time,
      sheet_id: schema.games.sheet_id,
      sheet_name: schema.sheets.name,
    })
    .from(schema.games)
    .leftJoin(schema.sheets, eq(schema.games.sheet_id, schema.sheets.id))
    .where(
      and(
        gte(schema.games.game_date, rangeStartStr),
        lte(schema.games.game_date, rangeEndStr),
        isNotNull(schema.games.sheet_id)
      )
    );

  const sheetsByDraw = new Map<string, Array<{ sheetId: number; sheetName?: string }>>();
  for (const row of scheduledGamesInRange) {
    if (row.sheet_id == null || row.game_date == null || row.game_time == null) continue;
    const dateStr =
      typeof row.game_date === 'string'
        ? row.game_date.slice(0, 10)
        : (row.game_date as Date).toISOString().slice(0, 10);
    const timeStr =
      typeof row.game_time === 'string'
        ? row.game_time.slice(0, 5)
        : `${String((row.game_time as Date).getUTCHours()).padStart(2, '0')}:${String((row.game_time as Date).getUTCMinutes()).padStart(2, '0')}`;
    const key = `${row.league_id}:${dateStr}:${timeStr}`;
    const arr = sheetsByDraw.get(key) ?? [];
    if (!arr.some((s) => s.sheetId === row.sheet_id)) {
      arr.push({
        sheetId: row.sheet_id,
        sheetName: row.sheet_name ?? sheetNameById.get(row.sheet_id),
      });
    }
    sheetsByDraw.set(key, arr);
  }

  const result: ExpandedLeagueCalendarEvent[] = [];

  for (const league of leagues) {
    const drawTimes = await db
      .select({ draw_time: schema.leagueDrawTimes.draw_time })
      .from(schema.leagueDrawTimes)
      .where(eq(schema.leagueDrawTimes.league_id, league.id))
      .orderBy(asc(schema.leagueDrawTimes.draw_time));

    const exceptionRows = await db
      .select({ exception_date: schema.leagueExceptions.exception_date })
      .from(schema.leagueExceptions)
      .where(eq(schema.leagueExceptions.league_id, league.id));
    const exceptions = new Set(
      exceptionRows.map((ex) =>
        typeof ex.exception_date === 'string'
          ? ex.exception_date.slice(0, 10)
          : (ex.exception_date as Date).toISOString().slice(0, 10)
      )
    );

    const startDateStr =
      typeof league.start_date === 'string'
        ? league.start_date.slice(0, 10)
        : (league.start_date as Date).toISOString().slice(0, 10);
    const endDateStr =
      typeof league.end_date === 'string'
        ? league.end_date.slice(0, 10)
        : (league.end_date as Date).toISOString().slice(0, 10);

    const drawDates = computeLeagueDrawDatesInRange(
      startDateStr,
      endDateStr,
      league.day_of_week,
      exceptions,
      rangeStart,
      rangeEnd
    );

    for (const dateStr of drawDates) {
      for (const row of drawTimes) {
        const rawTime = row.draw_time;
        const timeStr =
          typeof rawTime === 'string'
            ? rawTime.slice(0, 5)
            : `${String((rawTime as Date).getUTCHours()).padStart(2, '0')}:${String((rawTime as Date).getUTCMinutes()).padStart(2, '0')}`;
        const startIso = `${dateStr}T${timeStr}:00`;
        const startDate = new Date(startIso);
        const endDate = new Date(startDate.getTime() + LEAGUE_DRAW_DURATION_HOURS * 60 * 60 * 1000);

        if (endDate <= rangeStart || startDate >= rangeEnd) continue;

        const drawKey = `${league.id}:${dateStr}:${timeStr}`;
        const sheetRowsForDraw = sheetsByDraw.get(drawKey) ?? [];
        const locations: Array<{ type: 'sheet'; sheetId: number; sheetName?: string }> = sheetRowsForDraw.map((s) => ({
          type: 'sheet' as const,
          sheetId: s.sheetId,
          sheetName: s.sheetName,
        }));

        result.push({
          id: `league:${league.id}:${dateStr}:${timeStr}`,
          typeId: 'leagues',
          title: league.name,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          allDay: false,
          source: 'leagues',
          locations: locations.length > 0 ? locations : undefined,
        });
      }
    }
  }

  return result;
}

/** True if this calendar interval uses the given sheet and overlaps [blockStart, blockEnd). */
export function calendarIntervalBlocksSheet(
  ev: { start: string; end: string; locations?: Array<{ type: string; sheetId?: number }> },
  sheetId: number,
  blockStart: Date,
  blockEnd: Date
): boolean {
  const sheetIds = (ev.locations ?? [])
    .filter((l) => l.type === 'sheet' && l.sheetId != null)
    .map((l) => l.sheetId!);
  if (sheetIds.length === 0 || !sheetIds.includes(sheetId)) return false;
  const es = new Date(ev.start).getTime();
  const ee = new Date(ev.end).getTime();
  const bs = blockStart.getTime();
  const be = blockEnd.getTime();
  return bs < ee && be > es;
}
