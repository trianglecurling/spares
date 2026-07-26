import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql, desc, ne } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { sendApiError } from '../api/errors.js';
import {
  sendIceBookingCancellationEmail,
  sendIceBookingConfirmationEmail,
  sendIceBookingUpdatedEmail,
} from '../services/email.js';
import {
  getIceBookingDateWindow,
  getIceDayAvailability,
  hasIceSheetConflict,
  ICE_MAX_ADVANCE_DAYS,
  isWithinIceBookingWindow,
  memberCanBookIce,
  type IceDurationHours,
} from '../services/iceAvailability.js';
import { isCalendarAdmin } from '../utils/auth.js';

const MS_HOUR = 60 * 60 * 1000;

const durationHoursSchema = z.union([z.literal(1), z.literal(2)]);

const availabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  durationHours: z.coerce.number().pipe(durationHoursSchema),
});

const createBodySchema = z
  .object({
    sheetId: z.number().int().positive(),
    start: z.string().min(1),
    durationHours: durationHoursSchema,
    purpose: z.enum(['practice', 'makeup_game', 'other']),
    purposeOther: z.string().max(500).optional(),
  })
  .refine(
    (b) => {
      if (b.purpose === 'other') return (b.purposeOther ?? '').trim().length > 0;
      return true;
    },
    { message: 'purposeOther is required when purpose is other' }
  );

const adminUpdateBodySchema = z.object({
  sheetId: z.number().int().positive(),
  start: z.string().min(1),
  durationHours: durationHoursSchema,
});

type IceBookingRow = {
  id: number;
  memberId: number;
  memberName: string;
  memberEmail: string | null;
  sheetId: number;
  sheetName: string;
  startDt: string;
  endDt: string;
  purpose: string;
  purposeOther: string | null;
  guestNames: string | null;
};

async function loadIceBookingById(id: number): Promise<IceBookingRow | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({
      id: schema.iceBookings.id,
      memberId: schema.iceBookings.member_id,
      memberName: schema.members.name,
      memberEmail: schema.members.email,
      sheetId: schema.iceBookings.sheet_id,
      sheetName: schema.sheets.name,
      startDt: schema.iceBookings.start_dt,
      endDt: schema.iceBookings.end_dt,
      purpose: schema.iceBookings.purpose,
      purposeOther: schema.iceBookings.purpose_other,
      guestNames: schema.iceBookings.guest_names,
    })
    .from(schema.iceBookings)
    .innerJoin(schema.sheets, eq(schema.iceBookings.sheet_id, schema.sheets.id))
    .innerJoin(schema.members, eq(schema.iceBookings.member_id, schema.members.id))
    .where(eq(schema.iceBookings.id, id))
    .limit(1);
  return row ?? null;
}

function emailDetailsFromRow(row: IceBookingRow) {
  return {
    sheetName: row.sheetName,
    startIso: row.startDt,
    endIso: row.endDt,
    purpose: row.purpose,
    purposeOther: row.purposeOther,
    guestNames: row.guestNames,
  };
}

export async function iceBookingRoutes(fastify: FastifyInstance) {
  fastify.get('/ice-bookings/availability', async (request, reply) => {
    const member = request.member as Member | undefined;
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    if (!memberCanBookIce(member)) {
      return sendApiError(reply, 403, 'Social members cannot book ice time');
    }

    const parsed = availabilityQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendApiError(reply, 400, 'Invalid request', parsed.error.issues);
    }

    const { firstDate, lastDate } = getIceBookingDateWindow();
    if (parsed.data.date < firstDate || parsed.data.date > lastDate) {
      return sendApiError(
        reply,
        400,
        `Ice time can only be booked between ${firstDate} and ${lastDate}`
      );
    }

    return getIceDayAvailability({
      date: parsed.data.date,
      durationHours: parsed.data.durationHours as IceDurationHours,
      member,
    });
  });

  fastify.get('/ice-bookings', async (request, reply) => {
    const member = request.member as Member | undefined;
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    if (!memberCanBookIce(member)) {
      return sendApiError(reply, 403, 'Social members cannot book ice time');
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
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    if (!memberCanBookIce(member)) {
      return sendApiError(reply, 403, 'Social members cannot book ice time');
    }

    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(
        reply,
        400,
        parsed.error.issues[0]?.message ?? 'Invalid request',
        parsed.error.issues
      );
    }
    const body = parsed.data;

    const start = new Date(body.start);
    if (Number.isNaN(start.getTime())) {
      return sendApiError(reply, 400, 'Invalid start time');
    }

    const end = new Date(start.getTime() + body.durationHours * MS_HOUR);

    if (start.getTime() < Date.now() - 60_000) {
      return sendApiError(reply, 400, 'Booking must be in the future');
    }
    if (!isWithinIceBookingWindow(start)) {
      return sendApiError(
        reply,
        400,
        `Ice time can only be booked up to ${ICE_MAX_ADVANCE_DAYS} days in advance`
      );
    }

    const { db, schema } = getDrizzleDb();

    const sheetRows = await db
      .select({ id: schema.sheets.id, name: schema.sheets.name, active: schema.sheets.is_active })
      .from(schema.sheets)
      .where(eq(schema.sheets.id, body.sheetId))
      .limit(1);
    const sheet = sheetRows[0];
    if (!sheet || sheet.active === 0) {
      return sendApiError(reply, 400, 'Invalid or inactive sheet');
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
      return sendApiError(
        reply,
        409,
        'You already have a booking that overlaps this time. Cancel it first or choose another time.'
      );
    }

    if (await hasIceSheetConflict(body.sheetId, start, end, member)) {
      return sendApiError(
        reply,
        409,
        'That sheet is no longer free for all of this time. Pick another time or sheet.'
      );
    }

    const purposeOtherTrimmed =
      body.purpose === 'other' ? (body.purposeOther ?? '').trim() : null;

    const [inserted] = await db
      .insert(schema.iceBookings)
      .values({
        member_id: member.id,
        sheet_id: body.sheetId,
        start_dt: startIso,
        end_dt: endIso,
        purpose: body.purpose,
        purpose_other: purposeOtherTrimmed,
        guest_names: null,
      })
      .returning({
        id: schema.iceBookings.id,
        start_dt: schema.iceBookings.start_dt,
        end_dt: schema.iceBookings.end_dt,
      });

    if (!inserted) {
      return sendApiError(reply, 500, 'Failed to create booking');
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
          guestNames: null,
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
    };
  });

  /** Calendar admins: change sheet and/or date/time for any member booking. */
  fastify.patch<{ Params: { id: string } }>('/ice-bookings/:id', async (request, reply) => {
    const member = request.member as Member | undefined;
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    if (!isCalendarAdmin(member)) {
      return sendApiError(reply, 403, 'Calendar admin access required');
    }

    const id = parseInt(request.params.id, 10);
    if (Number.isNaN(id)) {
      return sendApiError(reply, 400, 'Invalid id');
    }

    const parsed = adminUpdateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(
        reply,
        400,
        parsed.error.issues[0]?.message ?? 'Invalid request',
        parsed.error.issues
      );
    }
    const body = parsed.data;

    const existing = await loadIceBookingById(id);
    if (!existing) {
      return sendApiError(reply, 404, 'Booking not found');
    }

    const start = new Date(body.start);
    if (Number.isNaN(start.getTime())) {
      return sendApiError(reply, 400, 'Invalid start time');
    }
    const end = new Date(start.getTime() + body.durationHours * MS_HOUR);
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const { db, schema } = getDrizzleDb();
    const sheetRows = await db
      .select({ id: schema.sheets.id, name: schema.sheets.name, active: schema.sheets.is_active })
      .from(schema.sheets)
      .where(eq(schema.sheets.id, body.sheetId))
      .limit(1);
    const sheet = sheetRows[0];
    if (!sheet || sheet.active === 0) {
      return sendApiError(reply, 400, 'Invalid or inactive sheet');
    }

    const ownerOverlap = await db
      .select({ id: schema.iceBookings.id })
      .from(schema.iceBookings)
      .where(
        and(
          eq(schema.iceBookings.member_id, existing.memberId),
          ne(schema.iceBookings.id, id),
          sql`${schema.iceBookings.start_dt} < ${endIso}`,
          sql`${schema.iceBookings.end_dt} > ${startIso}`
        )
      )
      .limit(1);
    if (ownerOverlap.length > 0) {
      return sendApiError(
        reply,
        409,
        'That member already has another ice booking overlapping this time.'
      );
    }

    if (await hasIceSheetConflict(body.sheetId, start, end, member, { excludeBookingId: id })) {
      return sendApiError(
        reply,
        409,
        'That sheet is not free for all of this time. Pick another time or sheet.'
      );
    }

    const unchanged =
      existing.sheetId === body.sheetId &&
      existing.startDt === startIso &&
      existing.endDt === endIso;
    if (unchanged) {
      return {
        id: existing.id,
        sheetId: existing.sheetId,
        sheetName: existing.sheetName,
        start: existing.startDt,
        end: existing.endDt,
        purpose: existing.purpose,
        purposeOther: existing.purposeOther ?? undefined,
        guestNames: existing.guestNames ?? undefined,
        memberId: existing.memberId,
        memberName: existing.memberName,
      };
    }

    await db
      .update(schema.iceBookings)
      .set({
        sheet_id: body.sheetId,
        start_dt: startIso,
        end_dt: endIso,
      })
      .where(eq(schema.iceBookings.id, id));

    const nextDetails = {
      sheetName: sheet.name,
      startIso,
      endIso,
      purpose: existing.purpose,
      purposeOther: existing.purposeOther,
      guestNames: existing.guestNames,
    };

    if (existing.memberEmail) {
      sendIceBookingUpdatedEmail(existing.memberEmail, existing.memberName, {
        previous: emailDetailsFromRow(existing),
        next: nextDetails,
      }).catch((err) => console.error('Ice booking update email failed:', err));
    }

    return {
      id,
      sheetId: body.sheetId,
      sheetName: sheet.name,
      start: startIso,
      end: endIso,
      purpose: existing.purpose,
      purposeOther: existing.purposeOther ?? undefined,
      guestNames: existing.guestNames ?? undefined,
      memberId: existing.memberId,
      memberName: existing.memberName,
    };
  });

  fastify.delete<{ Params: { id: string } }>('/ice-bookings/:id', async (request, reply) => {
    const member = request.member as Member | undefined;
    if (!member) return sendApiError(reply, 401, 'Unauthorized');

    const id = parseInt(request.params.id, 10);
    if (Number.isNaN(id)) {
      return sendApiError(reply, 400, 'Invalid id');
    }

    const asStaff = isCalendarAdmin(member);
    if (!asStaff && !memberCanBookIce(member)) {
      return sendApiError(reply, 403, 'Social members cannot manage ice bookings');
    }

    const existing = await loadIceBookingById(id);
    if (!existing) {
      return sendApiError(reply, 404, 'Booking not found');
    }
    if (!asStaff && existing.memberId !== member.id) {
      return sendApiError(reply, 404, 'Booking not found');
    }

    const { db, schema } = getDrizzleDb();
    await db.delete(schema.iceBookings).where(eq(schema.iceBookings.id, id));

    if (existing.memberEmail) {
      sendIceBookingCancellationEmail(
        existing.memberEmail,
        existing.memberName,
        emailDetailsFromRow(existing),
        { canceledByStaff: asStaff && existing.memberId !== member.id }
      ).catch((err) => console.error('Ice booking cancellation email failed:', err));
    }

    return { success: true };
  });
}
