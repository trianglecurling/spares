/**
 * Availability for member ice bookings: which start times on a given club-local day
 * still have a free sheet, and what is already occupying the ice.
 *
 * The same occupancy sources back both the availability grid and the conflict check on
 * create, so the picker can never offer a slot that `POST /ice-bookings` would reject.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { isCalendarAdmin } from '../utils/auth.js';
import { memberIsSocialMember, memberIsSpareOnly } from '../utils/memberMembershipHelpers.js';
import {
  addCalendarDays,
  formatDateInTimeZone,
  localDateTimeToUtcDate,
} from '../utils/timeZone.js';
import {
  fetchDirectCalendarEventsForRange,
  fetchLeagueCalendarEventsForRange,
} from './calendarExpansion.js';
import { getEventTimespansForCalendar } from './eventService.js';
import { fetchIceBookingsAsCalendarEvents } from './iceBookingsCalendar.js';

const MS_MINUTE = 60 * 1000;
const MS_DAY = 24 * 60 * MS_MINUTE;

/** Granularity of offered start times, in minutes. */
export const ICE_SLOT_MINUTES = 30;

/** Members may book through the end of this many calendar days ahead. */
export const ICE_MAX_ADVANCE_DAYS = 7;

export const ICE_DURATION_HOURS = [1, 2] as const;
export type IceDurationHours = (typeof ICE_DURATION_HOURS)[number];

/** Slots that already started are treated as past once they are this far behind. */
const PAST_GRACE_MS = 60_000;

/** Placeholder for occupancy the member is not allowed to see the details of. */
const HIDDEN_EVENT_TITLE = 'Reserved';

export type IceDaySheet = { id: number; name: string };

export type IceDayEvent = {
  id: string;
  typeId: string;
  title: string;
  start: string;
  end: string;
  sheetIds: number[];
};

export type IceSlotUnavailableReason = 'past' | 'member_conflict' | 'sheets_busy';

export type IceDaySlot = {
  start: string;
  end: string;
  availableSheetIds: number[];
  unavailableReason?: IceSlotUnavailableReason;
};

export type IceDayAvailability = {
  date: string;
  durationHours: IceDurationHours;
  slotMinutes: number;
  dayStart: string;
  dayEnd: string;
  sheets: IceDaySheet[];
  events: IceDayEvent[];
  slots: IceDaySlot[];
};

type Occupancy = { eventId?: string; sheetIds: number[]; startMs: number; endMs: number };

type SheetLocated = {
  id: string;
  typeId: string;
  title: string;
  start: string;
  end: string;
  locations?: Array<{ type: string; sheetId?: number }>;
};

function sheetIdsOf(ev: SheetLocated): number[] {
  return (ev.locations ?? [])
    .filter((loc) => loc.type === 'sheet' && loc.sheetId != null)
    .map((loc) => loc.sheetId!);
}

function toDayEvent(ev: SheetLocated, sheetIds: number[]): IceDayEvent {
  return {
    id: ev.id,
    typeId: ev.typeId,
    title: ev.title,
    start: new Date(ev.start).toISOString(),
    end: new Date(ev.end).toISOString(),
    sheetIds,
  };
}

function overlaps(a: { startMs: number; endMs: number }, startMs: number, endMs: number): boolean {
  return a.startMs < endMs && a.endMs > startMs;
}

/** First and last club-local calendar dates (YYYY-MM-DD) a member may book. */
export function getIceBookingDateWindow(now = new Date()): { firstDate: string; lastDate: string } {
  const firstDate = formatDateInTimeZone(now, config.timeZone) ?? now.toISOString().slice(0, 10);
  return { firstDate, lastDate: addCalendarDays(firstDate, ICE_MAX_ADVANCE_DAYS) };
}

/** True when `start` falls on a club-local date the member is allowed to book. */
export function isWithinIceBookingWindow(start: Date, now = new Date()): boolean {
  const startDate = formatDateInTimeZone(start, config.timeZone);
  if (!startDate) return false;
  const { firstDate, lastDate } = getIceBookingDateWindow(now);
  return startDate >= firstDate && startDate <= lastDate;
}

/**
 * Everything that occupies a sheet in the range.
 *
 * `blocking` covers all published occupancy regardless of who may see it; `events` is the
 * subset the member is allowed to read, with anything else reduced to a bare placeholder.
 */
async function loadIceOccupancy(
  rangeStart: Date,
  rangeEnd: Date,
  member: Member
): Promise<{ blocking: Occupancy[]; events: IceDayEvent[] }> {
  const startIso = rangeStart.toISOString();
  const endIso = rangeEnd.toISOString();
  // Spare-only members cannot read ice-members-only events, but those events still hold the ice.
  const restrictedVisibility = memberIsSpareOnly(member);

  const [direct, league, iceBookings, allEventItems, visibleEventItems] = await Promise.all([
    fetchDirectCalendarEventsForRange(rangeStart, rangeEnd),
    fetchLeagueCalendarEventsForRange(rangeStart, rangeEnd),
    fetchIceBookingsAsCalendarEvents(
      rangeStart,
      rangeEnd,
      isCalendarAdmin(member) ? 'admin' : 'member'
    ),
    getEventTimespansForCalendar(startIso, endIso),
    restrictedVisibility
      ? getEventTimespansForCalendar(startIso, endIso, ['public', 'active_members'])
      : Promise.resolve(null),
  ]);

  const visibleEventIds = visibleEventItems ? new Set(visibleEventItems.map((ev) => ev.id)) : null;
  const blocking: Occupancy[] = [];
  const events: IceDayEvent[] = [];

  const collect = (ev: SheetLocated, visible: boolean) => {
    const sheetIds = sheetIdsOf(ev);
    if (sheetIds.length === 0) return;
    const startMs = new Date(ev.start).getTime();
    const endMs = new Date(ev.end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
    blocking.push({ eventId: ev.id, sheetIds, startMs, endMs });
    events.push(
      visible
        ? toDayEvent(ev, sheetIds)
        : toDayEvent({ ...ev, title: HIDDEN_EVENT_TITLE, typeId: 'other' }, sheetIds)
    );
  };

  for (const ev of direct) collect(ev, true);
  for (const ev of league) collect(ev, true);
  for (const ev of iceBookings) collect(ev, true);
  for (const ev of allEventItems) collect(ev, visibleEventIds ? visibleEventIds.has(ev.id) : true);

  return { blocking, events };
}

async function loadMemberBookings(
  memberId: number,
  rangeStart: Date,
  rangeEnd: Date
): Promise<Array<{ startMs: number; endMs: number }>> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      startDt: schema.iceBookings.start_dt,
      endDt: schema.iceBookings.end_dt,
    })
    .from(schema.iceBookings)
    .where(
      and(
        eq(schema.iceBookings.member_id, memberId),
        sql`${schema.iceBookings.start_dt} < ${rangeEnd.toISOString()}`,
        sql`${schema.iceBookings.end_dt} > ${rangeStart.toISOString()}`
      )
    );

  return rows.map((row) => ({
    startMs: new Date(row.startDt).getTime(),
    endMs: new Date(row.endDt).getTime(),
  }));
}

async function loadActiveSheets(): Promise<IceDaySheet[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.sheets.id, name: schema.sheets.name })
    .from(schema.sheets)
    .where(eq(schema.sheets.is_active, 1))
    .orderBy(asc(schema.sheets.sort_order), asc(schema.sheets.name));
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

/**
 * True when a calendar event, league draw, other-member booking, or registrable event
 * occupies `sheetId` during `[start, end)`.
 *
 * Pass `excludeBookingId` when updating an existing booking so it does not conflict with itself.
 */
export async function hasIceSheetConflict(
  sheetId: number,
  start: Date,
  end: Date,
  member: Member,
  options?: { excludeBookingId?: number }
): Promise<boolean> {
  const { blocking } = await loadIceOccupancy(
    new Date(start.getTime() - MS_DAY),
    new Date(end.getTime() + MS_DAY),
    member
  );
  const startMs = start.getTime();
  const endMs = end.getTime();
  const excludeEventId =
    options?.excludeBookingId != null ? `ice-booking:${options.excludeBookingId}` : null;
  return blocking.some(
    (b) =>
      (!excludeEventId || b.eventId !== excludeEventId) &&
      b.sheetIds.includes(sheetId) &&
      overlaps(b, startMs, endMs)
  );
}

/** Offered start times for one club-local day, plus what is already on the ice. */
export async function getIceDayAvailability(params: {
  date: string;
  durationHours: IceDurationHours;
  member: Member;
  now?: Date;
}): Promise<IceDayAvailability> {
  const { date, durationHours, member } = params;
  const now = params.now ?? new Date();

  const dayStart = localDateTimeToUtcDate(date, '00:00', config.timeZone);
  const dayEnd = localDateTimeToUtcDate(addCalendarDays(date, 1), '00:00', config.timeZone);

  const [sheets, occupancy, memberBookings] = await Promise.all([
    loadActiveSheets(),
    loadIceOccupancy(new Date(dayStart.getTime() - MS_DAY), new Date(dayEnd.getTime() + MS_DAY), member),
    loadMemberBookings(member.id, dayStart, dayEnd),
  ]);

  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const durationMs = durationHours * 60 * MS_MINUTE;
  const stepMs = ICE_SLOT_MINUTES * MS_MINUTE;
  const earliestStartMs = now.getTime() - PAST_GRACE_MS;

  const slots: IceDaySlot[] = [];
  for (let startMs = dayStartMs; startMs + durationMs <= dayEndMs; startMs += stepMs) {
    const endMs = startMs + durationMs;
    const availableSheetIds = sheets
      .filter(
        (sheet) =>
          !occupancy.blocking.some(
            (block) => block.sheetIds.includes(sheet.id) && overlaps(block, startMs, endMs)
          )
      )
      .map((sheet) => sheet.id);

    let unavailableReason: IceSlotUnavailableReason | undefined;
    if (startMs < earliestStartMs) {
      unavailableReason = 'past';
    } else if (memberBookings.some((booking) => overlaps(booking, startMs, endMs))) {
      unavailableReason = 'member_conflict';
    } else if (availableSheetIds.length === 0) {
      unavailableReason = 'sheets_busy';
    }

    slots.push({
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      availableSheetIds: unavailableReason ? [] : availableSheetIds,
      ...(unavailableReason ? { unavailableReason } : {}),
    });
  }

  const events = occupancy.events
    .filter((ev) => new Date(ev.start).getTime() < dayEndMs && new Date(ev.end).getTime() > dayStartMs)
    .sort((a, b) => a.start.localeCompare(b.start));

  return {
    date,
    durationHours,
    slotMinutes: ICE_SLOT_MINUTES,
    dayStart: dayStart.toISOString(),
    dayEnd: dayEnd.toISOString(),
    sheets,
    events,
    slots,
  };
}

/** Guard shared by the availability and create routes. */
export function memberCanBookIce(member: Member): boolean {
  return !memberIsSocialMember(member);
}
