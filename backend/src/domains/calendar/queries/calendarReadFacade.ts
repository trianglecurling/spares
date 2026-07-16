import { asc, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../../../db/drizzle-db.js';
import { fetchDirectCalendarEventsForRange, fetchLeagueCalendarEventsForRange } from '../../../services/calendarExpansion.js';
import { getEventTimespansForCalendar } from '../../../services/eventService.js';
import { isBonspielCalendarType } from '../../../services/eventCalendarTypes.js';
import { fetchIceBookingsAsCalendarEvents } from '../../../services/iceBookingsCalendar.js';
import type { Member } from '../../../types.js';
import { isCalendarAdmin } from '../../../utils/auth.js';
import { memberIsSocialMember, memberIsSpareOnly } from '../../../utils/memberMembershipHelpers.js';

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

  const [direct, ice, eventItems] = await Promise.all([
    fetchDirectCalendarEventsForRange(rangeStart, rangeEnd),
    fetchIceBookingsAsCalendarEvents(rangeStart, rangeEnd, iceViewer),
    getEventTimespansForCalendar(input.start, input.end, visibilityFilter),
  ]);

  return [...direct, ...ice, ...eventItems];
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

export async function getUpcomingBonspiels(now = new Date()) {
  const nowIso = now.toISOString();
  const rangeEnd = new Date(now);
  rangeEnd.setMonth(rangeEnd.getMonth() + 6);
  const rangeEndIso = rangeEnd.toISOString();

  const [directEvents, eventItems] = await Promise.all([
    fetchDirectCalendarEventsForRange(now, rangeEnd),
    getEventTimespansForCalendar(nowIso, rangeEndIso, ['public']),
  ]);

  const bonspiels: PublicUpcomingBonspiel[] = [];

  for (const item of directEvents) {
    if (isBonspielCalendarType(item.typeId) && item.start >= nowIso) {
      bonspiels.push({
        id: item.id,
        title: item.title,
        start: item.start,
        end: item.end,
        allDay: item.allDay,
        eventSlug: null,
      });
    }
  }

  // Events can have several timespans (e.g. one per day); collapse them into a
  // single homepage entry per event spanning the earliest start to latest end.
  const byEventSlug = new Map<string, PublicUpcomingBonspiel>();
  for (const item of eventItems) {
    if (!isBonspielCalendarType(item.typeId) || item.start < nowIso) continue;
    const existing = item.slug ? byEventSlug.get(item.slug) : undefined;
    if (!existing) {
      const entry: PublicUpcomingBonspiel = {
        id: item.id,
        title: item.title,
        start: item.start,
        end: item.end,
        allDay: item.allDay,
        eventSlug: item.slug ?? null,
      };
      if (item.slug) byEventSlug.set(item.slug, entry);
      bonspiels.push(entry);
      continue;
    }
    if (item.start < existing.start) existing.start = item.start;
    if (item.end > existing.end) existing.end = item.end;
  }

  bonspiels.sort((a, b) => a.start.localeCompare(b.start));
  return bonspiels.slice(0, UPCOMING_BONSPIEL_LIMIT);
}
