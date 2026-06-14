import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import {
  fetchDirectCalendarEventsForRange,
  fetchLeagueCalendarEventsForRange,
  calendarIntervalBlocksSheet,
} from '../services/calendarExpansion.js';
import { sendIceBookingConfirmationEmail } from '../services/email.js';
import { memberIsSocialMember } from '../utils/memberMembershipHelpers.js';

const MS_HOUR = 60 * 60 * 1000;
const MAX_ADVANCE_MS = 7 * 24 * MS_HOUR;

const guestPurposes = ['guests_new', 'guests_experienced'] as const;

const createBodySchema = z
  .object({
    sheetId: z.number().int().positive(),
    start: z.string().min(1),
    durationHours: z.union([z.literal(1), z.literal(2)]),
    purpose: z.enum(['practice', 'makeup_game', 'guests_new', 'guests_experienced', 'other']),
    purposeOther: z.string().max(500).optional(),
    guestNames: z.string().max(2000).optional(),
  })
  .refine(
    (b) => {
      if (b.purpose === 'other') return (b.purposeOther ?? '').trim().length > 0;
      return true;
    },
    { message: 'purposeOther is required when purpose is other' }
  )
  .refine(
    (b) => {
      if (guestPurposes.includes(b.purpose as (typeof guestPurposes)[number])) {
        return (b.guestNames ?? '').trim().length > 0;
      }
      return true;
    },
    { message: 'Guest names are required when bringing guests' }
  );

function bookingWindowForConflictCheck(blockStart: Date, blockEnd: Date): { rangeStart: Date; rangeEnd: Date } {
  return {
    rangeStart: new Date(blockStart.getTime() - MS_HOUR),
    rangeEnd: new Date(blockEnd.getTime() + MS_HOUR),
  };
}

async function hasCalendarConflict(sheetId: number, blockStart: Date, blockEnd: Date): Promise<boolean> {
  const { rangeStart, rangeEnd } = bookingWindowForConflictCheck(blockStart, blockEnd);
  const [direct, league] = await Promise.all([
    fetchDirectCalendarEventsForRange(rangeStart, rangeEnd),
    fetchLeagueCalendarEventsForRange(rangeStart, rangeEnd),
  ]);
  for (const ev of direct) {
    if (calendarIntervalBlocksSheet(ev, sheetId, blockStart, blockEnd)) return true;
  }
  for (const ev of league) {
    if (calendarIntervalBlocksSheet(ev, sheetId, blockStart, blockEnd)) return true;
  }
  return false;
}

export async function iceBookingRoutes(fastify: FastifyInstance) {
  fastify.get('/ice-bookings', async (request, reply) => {
    const member = request.member as Member | undefined;
    if (!member) return reply.code(401).send({ error: 'Unauthorized' });
    if (memberIsSocialMember(member)) {
      return reply.code(403).send({ error: 'Social members cannot book ice time' });
    }

    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select({
        id: schema.iceBookings.id,
        sheetId: schema.iceBookings.sheet_id,
        sheetName: schema.sheets.name,
        startDt: schema.iceBookings.start_dt,
        endDt: schema.iceBookings.end_dt,
        purpose: schema.iceBookings.purpose,
        purposeOther: schema.iceBookings.purpose_other,
        guestNames: schema.iceBookings.guest_names,
        createdAt: schema.iceBookings.created_at,
      })
      .from(schema.iceBookings)
      .innerJoin(schema.sheets, eq(schema.iceBookings.sheet_id, schema.sheets.id))
      .where(eq(schema.iceBookings.member_id, member.id))
      .orderBy(desc(schema.iceBookings.start_dt));

    return rows.map((r) => ({
      id: r.id,
      sheetId: r.sheetId,
      sheetName: r.sheetName,
      start: r.startDt,
      end: r.endDt,
      purpose: r.purpose,
      purposeOther: r.purposeOther ?? undefined,
      guestNames: r.guestNames ?? undefined,
      createdAt: r.createdAt,
    }));
  });

  fastify.post('/ice-bookings', async (request, reply) => {
    const member = request.member as Member | undefined;
    if (!member) return reply.code(401).send({ error: 'Unauthorized' });
    if (memberIsSocialMember(member)) {
      return reply.code(403).send({ error: 'Social members cannot book ice time' });
    }

    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    }
    const body = parsed.data;

    const start = new Date(body.start);
    if (Number.isNaN(start.getTime())) {
      return reply.code(400).send({ error: 'Invalid start time' });
    }

    const end = new Date(start.getTime() + body.durationHours * MS_HOUR);
    const expectedMs = body.durationHours * MS_HOUR;
    if (Math.abs(end.getTime() - start.getTime() - expectedMs) > 2000) {
      return reply.code(400).send({ error: 'Invalid booking duration' });
    }

    const now = Date.now();
    if (start.getTime() < now - 60_000) {
      return reply.code(400).send({ error: 'Booking must be in the future' });
    }
    if (start.getTime() > now + MAX_ADVANCE_MS) {
      return reply.code(400).send({ error: 'Ice time can only be booked up to 7 days in advance' });
    }

    const { db, schema } = getDrizzleDb();

    const sheetRows = await db
      .select({ id: schema.sheets.id, name: schema.sheets.name, active: schema.sheets.is_active })
      .from(schema.sheets)
      .where(eq(schema.sheets.id, body.sheetId))
      .limit(1);
    const sheet = sheetRows[0];
    if (!sheet || sheet.active === 0) {
      return reply.code(400).send({ error: 'Invalid or inactive sheet' });
    }

    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const memberOverlap = await db
      .select({ id: schema.iceBookings.id })
      .from(schema.iceBookings)
      .where(
        and(
          eq(schema.iceBookings.member_id, member.id),
          sql`${schema.iceBookings.start_dt} < ${endIso}`,
          sql`${schema.iceBookings.end_dt} > ${startIso}`
        )
      )
      .limit(1);
    if (memberOverlap.length > 0) {
      return reply
        .code(409)
        .send({ error: 'You already have a booking that overlaps this time. Cancel it first or choose another time.' });
    }

    const sheetOverlap = await db
      .select({ id: schema.iceBookings.id })
      .from(schema.iceBookings)
      .where(
        and(
          eq(schema.iceBookings.sheet_id, body.sheetId),
          sql`${schema.iceBookings.start_dt} < ${endIso}`,
          sql`${schema.iceBookings.end_dt} > ${startIso}`
        )
      )
      .limit(1);
    if (sheetOverlap.length > 0) {
      return reply.code(409).send({ error: 'That sheet is already booked for part of this time.' });
    }

    if (await hasCalendarConflict(body.sheetId, start, end)) {
      return reply
        .code(409)
        .send({ error: 'This sheet has a calendar event during all or part of the requested time.' });
    }

    const purposeOtherTrimmed =
      body.purpose === 'other' ? (body.purposeOther ?? '').trim() : null;
    const guestNamesTrimmed =
      body.purpose === 'guests_new' || body.purpose === 'guests_experienced'
        ? (body.guestNames ?? '').trim()
        : null;

    const [inserted] = await db
      .insert(schema.iceBookings)
      .values({
        member_id: member.id,
        sheet_id: body.sheetId,
        start_dt: startIso,
        end_dt: endIso,
        purpose: body.purpose,
        purpose_other: purposeOtherTrimmed,
        guest_names: guestNamesTrimmed,
      })
      .returning({
        id: schema.iceBookings.id,
        start_dt: schema.iceBookings.start_dt,
        end_dt: schema.iceBookings.end_dt,
      });

    if (!inserted) {
      return reply.code(500).send({ error: 'Failed to create booking' });
    }

    if (member.email) {
      sendIceBookingConfirmationEmail(
        member.email,
        member.name,
        {
          sheetName: sheet.name,
          startIso: inserted.start_dt,
          endIso: inserted.end_dt,
          purpose: body.purpose,
          purposeOther: purposeOtherTrimmed,
          guestNames: guestNamesTrimmed,
        }
      ).catch((err) => console.error('Ice booking confirmation email failed:', err));
    }

    return {
      id: inserted.id,
      sheetId: body.sheetId,
      sheetName: sheet.name,
      start: inserted.start_dt,
      end: inserted.end_dt,
      purpose: body.purpose,
      purposeOther: purposeOtherTrimmed ?? undefined,
      guestNames: guestNamesTrimmed ?? undefined,
    };
  });

  fastify.delete<{ Params: { id: string } }>('/ice-bookings/:id', async (request, reply) => {
    const member = request.member as Member | undefined;
    if (!member) return reply.code(401).send({ error: 'Unauthorized' });
    if (memberIsSocialMember(member)) {
      return reply.code(403).send({ error: 'Social members cannot manage ice bookings' });
    }

    const id = parseInt(request.params.id, 10);
    if (Number.isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid id' });
    }

    const { db, schema } = getDrizzleDb();
    const deleted = await db
      .delete(schema.iceBookings)
      .where(and(eq(schema.iceBookings.id, id), eq(schema.iceBookings.member_id, member.id)))
      .returning({ id: schema.iceBookings.id });

    if (deleted.length === 0) {
      return reply.code(404).send({ error: 'Booking not found' });
    }

    return { success: true };
  });
}
