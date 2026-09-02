import { and, asc, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../../../db/drizzle-db.js';
import { fetchDirectCalendarEventsForRange, fetchLeagueCalendarEventsForRange, parseDirectCalendarFeedId } from '../../../services/calendarExpansion.js';
import { calendarSignupsByDirectEventId } from '../../../services/volunteeringService.js';
import { getEventTimespansForCalendar } from '../../../services/eventService.js';
import { isBonspielCalendarType, parseCalendarTypeIds } from '../../../services/eventCalendarTypes.js';
import { fetchIceBookingsAsCalendarEvents } from '../../../services/iceBookingsCalendar.js';
import type { Member } from '../../../types.js';
import { isCalendarAdmin } from '../../../utils/auth.js';
import { memberIsSocialMember, memberIsSpareOnly } from '../../../utils/memberMembershipHelpers.js';
import { notArchivedCondition } from '../../../utils/softDelete.js';

const UPCOMING_BONSPIEL_LIMIT = 10;

type CalendarVisibility = 'public' | 'active_members' | 'ice_members';
type IceViewer = 'public' | 'member' | 'admin';

export type PublicUpcomingBonspiel = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  /** Set when the bonspiel comes from the events system; links to `/events/:slug`. */
  eventSlug: string | null;
};

export type CalendarFeedInput = {
  start: string;
  end: string;
  member?: Member;
};

function parseRange(start: string, end: string) {
  const rangeStart = new Date(start);
  const rangeEnd = new Date(end);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
    throw new Error('Invalid date range');
  }
  return { rangeStart, rangeEnd };
}

function getVisibilityFilter(member?: Member): CalendarVisibility[] {
  const visibilityFilter: CalendarVisibility[] = ['public'];
  if (!member) {
    return visibilityFilter;
  }

  visibilityFilter.push('active_members');
  if (!memberIsSpareOnly(member) && !memberIsSocialMember(member)) {
    visibilityFilter.push('ice_members');
  }
  return visibilityFilter;
}

function getIceViewer(member?: Member): IceViewer {
  if (!member) {
    return 'public';
  }
  return isCalendarAdmin(member) ? 'admin' : 'member';
}

export async function getCalendarFeed(input: CalendarFeedInput) {
  const { rangeStart, rangeEnd } = parseRange(input.start, input.end);
  const visibilityFilter = getVisibilityFilter(input.member);
  const iceViewer = getIceViewer(input.member);

  const [direct, ice, eventItems, signupMap] = await Promise.all([
    fetchDirectCalendarEventsForRange(rangeStart, rangeEnd),
    fetchIceBookingsAsCalendarEvents(rangeStart, rangeEnd, iceViewer),
    getEventTimespansForCalendar(input.start, input.end, visibilityFilter),
    calendarSignupsByDirectEventId({ forPublic: !input.member }),
  ]);

  const directWithSignups = direct.map((event) => {
    const parsed = parseDirectCalendarFeedId(event.id);
    const signup = parsed ? signupMap.get(parsed.dbId) : undefined;
    return signup ? { ...event, signup } : event;
  });

  return [...directWithSignups, ...ice, ...eventItems];
}

export async function getLeagueCalendarFeed(start: string, end: string) {
  const { rangeStart, rangeEnd } = parseRange(start, end);
  return fetchLeagueCalendarEventsForRange(rangeStart, rangeEnd);
}

export async function getPublicCalendarBundle(start: string, end: string) {
  const { db, schema } = getDrizzleDb();
  const [events, leagueEvents, sheetRows] = await Promise.all([
    getCalendarFeed({ start, end }),
    getLeagueCalendarFeed(start, end),
    db
      .select({ id: schema.sheets.id, name: schema.sheets.name })
      .from(schema.sheets)
      .where(eq(schema.sheets.is_active, 1))
      .orderBy(asc(schema.sheets.sort_order), asc(schema.sheets.name)),
  ]);

  return {
    events,
    leagueEvents,
    sheets: sheetRows.map((row) => ({ id: row.id, name: row.name })),
  };
}

function toIsoTimestamp(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Upcoming public bonspiels for the homepage.
 * Matches `/events?type=bonspiel` upcoming semantics: published public events whose
 * latest timespan has not ended yet (no 6-month calendar window).
 */
export async function getUpcomingBonspiels(now = new Date()) {
  const { db, schema } = getDrizzleDb();
  const nowMs = now.getTime();

  const rows = await db
    .select({
      eventId: schema.events.id,
      title: schema.events.title,
      slug: schema.events.slug,
      calendarTypeIds: schema.events.calendar_type_ids,
      startDt: schema.eventTimespans.start_dt,
      endDt: schema.eventTimespans.end_dt,
    })
    .from(schema.events)
    .innerJoin(schema.eventTimespans, eq(schema.eventTimespans.event_id, schema.events.id))
    .where(
      and(
        eq(schema.events.published, 1),
        eq(schema.events.visibility, 'public'),
        notArchivedCondition(schema.events.archived_at),
      ),
    );

  const byEventId = new Map<
    number,
    { title: string; slug: string; start: string; end: string }
  >();

  for (const row of rows) {
    if (!isBonspielCalendarType(parseCalendarTypeIds(row.calendarTypeIds))) continue;
    const start = toIsoTimestamp(row.startDt as string | Date);
    const end = toIsoTimestamp(row.endDt as string | Date);
    const existing = byEventId.get(row.eventId);
    if (!existing) {
      byEventId.set(row.eventId, {
        title: row.title,
        slug: row.slug,
        start,
        end,
      });
      continue;
    }
    if (start < existing.start) existing.start = start;
    if (end > existing.end) existing.end = end;
  }

  const bonspiels: PublicUpcomingBonspiel[] = [];
  for (const [eventId, event] of byEventId) {
    // Same rule as frontend isUpcomingEventUtc: still upcoming while latest end >= now.
    if (new Date(event.end).getTime() < nowMs) continue;
    bonspiels.push({
      id: `event:${eventId}`,
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: false,
      eventSlug: event.slug,
    });
  }

  bonspiels.sort((a, b) => a.start.localeCompare(b.start));
  const hasMore = bonspiels.length > UPCOMING_BONSPIEL_LIMIT;
  return {
    items: bonspiels.slice(0, UPCOMING_BONSPIEL_LIMIT),
    hasMore,
  };
}
