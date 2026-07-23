import { eq, and, or, sql, asc, gte, lte, inArray } from 'drizzle-orm';
import { config } from '../config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { expandRecurrenceInTimeZone } from '../utils/calendarRecurrence.js';
import {
  computeLeagueDrawDatesInRange,
  defaultDrawDurationMinutes,
} from '../utils/leagueSchedule.js';
import { localDateTimeToUtcDate } from '../utils/timeZone.js';

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

/** Calendar + league events that appear on the member calendar, expanded into concrete intervals. */
export async function fetchDirectCalendarEventsForRange(
  rangeStart: Date,
  rangeEnd: Date
): Promise<ExpandedDirectCalendarEvent[]> {
  const { db, schema } = getDrizzleDb();

  const rangeStartIso = rangeStart.toISOString();
  const rangeEndIso = rangeEnd.toISOString();
  const rangeStartDate = rangeStartIso.slice(0, 10);
  const rangeEndDate = rangeEndIso.slice(0, 10);

  const calendarEventColumns = {
    id: schema.calendarEvents.id,
    type_id: schema.calendarEvents.type_id,
    title: schema.calendarEvents.title,
    start_dt: schema.calendarEvents.start_dt,
    end_dt: schema.calendarEvents.end_dt,
    all_day: schema.calendarEvents.all_day,
    recurrence_rule: schema.calendarEvents.recurrence_rule,
    parent_event_id: schema.calendarEvents.parent_event_id,
    recurrence_date: schema.calendarEvents.recurrence_date,
    description: schema.calendarEvents.description,
    article_id: schema.calendarEvents.article_id,
    created_by_member_id: schema.calendarEvents.created_by_member_id,
  };

  const [sheetRows, events, overrides] = await Promise.all([
    db
      .select({ id: schema.sheets.id, name: schema.sheets.name })
      .from(schema.sheets)
      .orderBy(schema.sheets.sort_order, schema.sheets.name),
    db
      .select(calendarEventColumns)
      .from(schema.calendarEvents)
      .where(
        and(
          eq(schema.calendarEvents.source, 'direct'),
          sql`${schema.calendarEvents.parent_event_id} IS NULL`,
          sql`${schema.calendarEvents.recurrence_date} IS NULL`,
          sql`${schema.calendarEvents.start_dt} <= ${rangeEndIso}`,
          or(
            sql`${schema.calendarEvents.recurrence_rule} IS NOT NULL`,
            sql`${schema.calendarEvents.end_dt} >= ${rangeStartIso}`
          )
        )
      ),
    db
      .select(calendarEventColumns)
      .from(schema.calendarEvents)
      .where(
        and(
          eq(schema.calendarEvents.source, 'direct'),
          sql`${schema.calendarEvents.parent_event_id} IS NOT NULL`,
          sql`${schema.calendarEvents.recurrence_date} IS NOT NULL`,
          gte(schema.calendarEvents.recurrence_date, rangeStartDate),
          lte(schema.calendarEvents.recurrence_date, rangeEndDate)
        )
      ),
  ]);

  const sheetNameById = new Map(sheetRows.map((s) => [s.id, s.name]));
  const parentIds = events.map((e) => e.id);

  let exceptions: { parent_event_id: number; exception_date: string }[] = [];
  if (parentIds.length > 0) {
    exceptions = await db
      .select({
        parent_event_id: schema.calendarEventExceptions.parent_event_id,
        exception_date: schema.calendarEventExceptions.exception_date,
      })
      .from(schema.calendarEventExceptions)
      .where(inArray(schema.calendarEventExceptions.parent_event_id, parentIds));
  }

  const exceptionSet = new Set(exceptions.map((ex) => `${ex.parent_event_id}:${ex.exception_date}`));
  const overridesByParentDate = new Map(overrides.map((o) => [`${o.parent_event_id}:${o.recurrence_date}`, o]));
  const parentIdSet = new Set(parentIds);

  const locationsByEventId = new Map<number, Array<{ type: string; sheet_id: number | null }>>();
  const eventIds = [...events.map((e) => e.id), ...overrides.map((o) => o.id)];
  if (eventIds.length > 0) {
    const uniqueIds = [...new Set(eventIds)];
    const locRows = await db
      .select({
        event_id: schema.calendarEventLocations.event_id,
        location_type: schema.calendarEventLocations.location_type,
        sheet_id: schema.calendarEventLocations.sheet_id,
      })
      .from(schema.calendarEventLocations)
      .where(inArray(schema.calendarEventLocations.event_id, uniqueIds));

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
      .where(inArray(members.id, uniqueCreatorIds));
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
      .where(inArray(schema.articles.id, uniqueArticleIds));
    for (const a of articleRows) {
      articleById.set(a.id, a);
    }
  }

  const mapLocations = (eventId: number) => {
    const locs = (locationsByEventId.get(eventId) ?? []).map((l) => {
      if (l.type === 'sheet' && l.sheet_id) {
        return { type: 'sheet' as const, sheetId: l.sheet_id, sheetName: sheetNameById.get(l.sheet_id) };
      }
      return { type: l.type as 'warm-room' | 'exterior' | 'offsite' | 'virtual' };
    });
    return locs.length > 0 ? locs : undefined;
  };

  const result: ExpandedDirectCalendarEvent[] = [];

  for (const ev of events) {
    const locs = mapLocations(ev.id);

    if (ev.recurrence_rule) {
      const expanded = expandRecurrenceInTimeZone(
        ev.start_dt,
        ev.end_dt,
        ev.recurrence_rule,
        rangeStart,
        rangeEnd,
        config.timeZone
      );
      for (const inc of expanded) {
        const incDate = inc.recurrenceDate;
        const override = overridesByParentDate.get(`${ev.id}:${incDate}`);
        if (exceptionSet.has(`${ev.id}:${incDate}`) && !override) continue;

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
          locations: locs,
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
        locations: locs,
        source: 'direct',
        createdBy: ev.created_by_member_id != null ? creatorNameById.get(ev.created_by_member_id) : undefined,
        article: ev.article_id != null ? articleById.get(ev.article_id) : undefined,
      });
    }
  }

  for (const ov of overrides) {
    if (ov.parent_event_id && !parentIdSet.has(ov.parent_event_id)) {
      result.push({
        id: toEventId(ov),
        typeId: ov.type_id,
        title: ov.title,
        start: ov.start_dt,
        end: ov.end_dt,
        allDay: ov.all_day === 1,
        description: ov.description ?? undefined,
        locations: mapLocations(ov.id),
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

function toDateOnlyString(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function toTimeOnlyString(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 5);
  return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
}

export async function fetchLeagueCalendarEventsForRange(
  rangeStart: Date,
  rangeEnd: Date
): Promise<ExpandedLeagueCalendarEvent[]> {
  const { db, schema } = getDrizzleDb();

  const rangeStartStr = rangeStart.toISOString().slice(0, 10);
  const rangeEndStr = rangeEnd.toISOString().slice(0, 10);

  const [sheetRows, seasonLeagues, extraDrawLeagueIdRows] = await Promise.all([
    db
      .select({ id: schema.sheets.id, name: schema.sheets.name })
      .from(schema.sheets)
      .where(eq(schema.sheets.is_active, 1))
      .orderBy(schema.sheets.sort_order, schema.sheets.name),
    db
      .select({
        id: schema.leagues.id,
        name: schema.leagues.name,
        day_of_week: schema.leagues.day_of_week,
        format: schema.leagues.format,
        start_date: schema.leagues.start_date,
        end_date: schema.leagues.end_date,
        draw_duration_minutes: schema.leagues.draw_duration_minutes,
      })
      .from(schema.leagues)
      .where(and(lte(schema.leagues.start_date, rangeEndStr), gte(schema.leagues.end_date, rangeStartStr)))
      .orderBy(schema.leagues.day_of_week, schema.leagues.name),
    db
      .select({ league_id: schema.leagueExtraDraws.league_id })
      .from(schema.leagueExtraDraws)
      .where(
        and(
          gte(schema.leagueExtraDraws.draw_date, rangeStartStr),
          lte(schema.leagueExtraDraws.draw_date, rangeEndStr)
        )
      ),
  ]);

  const seasonLeagueIds = new Set(seasonLeagues.map((league) => league.id));
  const missingExtraLeagueIds = Array.from(
    new Set(
      extraDrawLeagueIdRows
        .map((row) => row.league_id)
        .filter((id) => !seasonLeagueIds.has(id))
    )
  );
  const extraOnlyLeagues =
    missingExtraLeagueIds.length === 0
      ? []
      : await db
          .select({
            id: schema.leagues.id,
            name: schema.leagues.name,
            day_of_week: schema.leagues.day_of_week,
            format: schema.leagues.format,
            start_date: schema.leagues.start_date,
            end_date: schema.leagues.end_date,
            draw_duration_minutes: schema.leagues.draw_duration_minutes,
          })
          .from(schema.leagues)
          .where(inArray(schema.leagues.id, missingExtraLeagueIds));

  const leagues = [...seasonLeagues, ...extraOnlyLeagues];

  if (leagues.length === 0) return [];

  const leagueIds = leagues.map((league) => league.id);

  const [drawTimeRows, exceptionRows, extraDrawRows, availabilityRows] = await Promise.all([
    db
      .select({
        league_id: schema.leagueDrawTimes.league_id,
        draw_time: schema.leagueDrawTimes.draw_time,
      })
      .from(schema.leagueDrawTimes)
      .where(inArray(schema.leagueDrawTimes.league_id, leagueIds))
      .orderBy(asc(schema.leagueDrawTimes.league_id), asc(schema.leagueDrawTimes.draw_time)),
    db
      .select({
        league_id: schema.leagueExceptions.league_id,
        exception_date: schema.leagueExceptions.exception_date,
      })
      .from(schema.leagueExceptions)
      .where(inArray(schema.leagueExceptions.league_id, leagueIds)),
    db
      .select({
        league_id: schema.leagueExtraDraws.league_id,
        draw_date: schema.leagueExtraDraws.draw_date,
        draw_time: schema.leagueExtraDraws.draw_time,
      })
      .from(schema.leagueExtraDraws)
      .where(
        and(
          inArray(schema.leagueExtraDraws.league_id, leagueIds),
          gte(schema.leagueExtraDraws.draw_date, rangeStartStr),
          lte(schema.leagueExtraDraws.draw_date, rangeEndStr)
        )
      ),
    // Per-draw sheet availability overrides (same semantics as computeDrawSlots):
    // missing row ⇒ available; is_available === 0 ⇒ unavailable.
    db
      .select({
        league_id: schema.drawSheetAvailability.league_id,
        draw_date: schema.drawSheetAvailability.draw_date,
        draw_time: schema.drawSheetAvailability.draw_time,
        sheet_id: schema.drawSheetAvailability.sheet_id,
        is_available: schema.drawSheetAvailability.is_available,
      })
      .from(schema.drawSheetAvailability)
      .where(
        and(
          inArray(schema.drawSheetAvailability.league_id, leagueIds),
          gte(schema.drawSheetAvailability.draw_date, rangeStartStr),
          lte(schema.drawSheetAvailability.draw_date, rangeEndStr)
        )
      ),
  ]);

  const drawTimesByLeagueId = new Map<number, Array<string | Date>>();
  for (const row of drawTimeRows) {
    const list = drawTimesByLeagueId.get(row.league_id) ?? [];
    list.push(row.draw_time);
    drawTimesByLeagueId.set(row.league_id, list);
  }

  const exceptionsByLeagueId = new Map<number, Set<string>>();
  for (const row of exceptionRows) {
    const set = exceptionsByLeagueId.get(row.league_id) ?? new Set<string>();
    set.add(toDateOnlyString(row.exception_date));
    exceptionsByLeagueId.set(row.league_id, set);
  }

  const extraDrawsByLeagueId = new Map<number, Array<{ date: string; time: string }>>();
  for (const row of extraDrawRows) {
    const list = extraDrawsByLeagueId.get(row.league_id) ?? [];
    list.push({
      date: toDateOnlyString(row.draw_date),
      time: toTimeOnlyString(row.draw_time),
    });
    extraDrawsByLeagueId.set(row.league_id, list);
  }

  const availabilityByDraw = new Map<string, Map<number, boolean>>();
  for (const row of availabilityRows) {
    const key = `${row.league_id}:${toDateOnlyString(row.draw_date)}:${toTimeOnlyString(row.draw_time)}`;
    const sheetMap = availabilityByDraw.get(key) ?? new Map<number, boolean>();
    sheetMap.set(row.sheet_id, row.is_available === 1);
    availabilityByDraw.set(key, sheetMap);
  }

  const result: ExpandedLeagueCalendarEvent[] = [];

  const pushLeagueDrawEvent = (
    league: (typeof leagues)[number],
    dateStr: string,
    timeStr: string,
    durationMinutes: number
  ) => {
    // Draw times are club wall-clock values (config.timeZone), not UTC.
    const startDate = localDateTimeToUtcDate(dateStr, timeStr, config.timeZone);
    if (Number.isNaN(startDate.getTime())) return;
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

    if (endDate <= rangeStart || startDate >= rangeEnd) return;

    const drawKey = `${league.id}:${dateStr}:${timeStr}`;
    const sheetAvailability = availabilityByDraw.get(drawKey) ?? new Map<number, boolean>();
    // Configured sheets for the draw slot: active sheets that are available
    // (default all active sheets when no availability override exists).
    const locations: Array<{ type: 'sheet'; sheetId: number; sheetName?: string }> = sheetRows
      .filter((sheet) => sheetAvailability.get(sheet.id) ?? true)
      .map((sheet) => ({
        type: 'sheet' as const,
        sheetId: sheet.id,
        sheetName: sheet.name,
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
  };

  for (const league of leagues) {
    const drawTimes = drawTimesByLeagueId.get(league.id) ?? [];
    const exceptions = exceptionsByLeagueId.get(league.id) ?? new Set<string>();
    const startDateStr = toDateOnlyString(league.start_date);
    const endDateStr = toDateOnlyString(league.end_date);
    const durationMinutes =
      league.draw_duration_minutes ?? defaultDrawDurationMinutes(league.format);

    const drawDates = computeLeagueDrawDatesInRange(
      startDateStr,
      endDateStr,
      league.day_of_week,
      exceptions,
      rangeStart,
      rangeEnd
    );

    const emittedKeys = new Set<string>();

    for (const dateStr of drawDates) {
      for (const rawTime of drawTimes) {
        const timeStr = toTimeOnlyString(rawTime);
        const key = `${dateStr}|${timeStr}`;
        emittedKeys.add(key);
        pushLeagueDrawEvent(league, dateStr, timeStr, durationMinutes);
      }
    }

    for (const extra of extraDrawsByLeagueId.get(league.id) ?? []) {
      const key = `${extra.date}|${extra.time}`;
      if (emittedKeys.has(key)) continue;
      emittedKeys.add(key);
      pushLeagueDrawEvent(league, extra.date, extra.time, durationMinutes);
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
