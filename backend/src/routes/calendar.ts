import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isCalendarAdmin } from '../utils/auth.js';
import {
  fetchDirectCalendarEventsForRange,
  fetchLeagueCalendarEventsForRange,
} from '../services/calendarExpansion.js';
import { fetchIceBookingsAsCalendarEvents } from '../services/iceBookingsCalendar.js';
import type { Member } from '../types.js';

type LocationType = 'sheet' | 'warm-room' | 'exterior' | 'offsite' | 'virtual';

function toLocationRows(
  eventId: number,
  locations: z.infer<typeof createEventBodySchema>['locations']
): Array<{ event_id: number; location_type: LocationType; sheet_id: number | null }> {
  if (!locations || locations.length === 0) return [];
  return locations.map((loc) => {
    if (loc.type === 'sheet') {
      return { event_id: eventId, location_type: 'sheet' as const, sheet_id: loc.sheetId };
    }
    return { event_id: eventId, location_type: loc.type, sheet_id: null };
  });
}

const locationSchema = z.union([
  z.object({ type: z.literal('sheet'), sheetId: z.number(), sheetName: z.string().optional() }),
  z.object({ type: z.literal('warm-room') }),
  z.object({ type: z.literal('exterior') }),
  z.object({ type: z.literal('offsite') }),
  z.object({ type: z.literal('virtual') }),
]);

const createEventBodySchema = z.object({
  typeId: z.string(),
  title: z.string().min(1),
  start: z.string(), // ISO datetime
  end: z.string(),
  allDay: z.boolean(),
  description: z.string().optional(),
  articleId: z.number().int().positive().nullable().optional(),
  locations: z.array(locationSchema).optional(),
  recurrence: z
    .object({
      rrule: z.string(), // e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR"
      endDate: z.string().optional(), // YYYY-MM-DD
      count: z.number().optional(),
    })
    .optional(),
});

const updateEventBodySchema = createEventBodySchema.partial();

export async function calendarRoutes(fastify: FastifyInstance) {
  // GET /calendar/events?start=...&end=...
  fastify.get(
    '/calendar/events',
    {
      schema: {
        tags: ['calendar'],
        querystring: {
          type: 'object',
          required: ['start', 'end'],
          properties: {
            start: { type: 'string', description: 'ISO date or datetime' },
            end: { type: 'string', description: 'ISO date or datetime' },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query as { start: string; end: string };
      const rangeStart = new Date(q.start);
      const rangeEnd = new Date(q.end);
      const member = request.member as Member | undefined;
      const iceViewer = member && isCalendarAdmin(member) ? 'admin' : 'member';
      const [direct, ice] = await Promise.all([
        fetchDirectCalendarEventsForRange(rangeStart, rangeEnd),
        fetchIceBookingsAsCalendarEvents(rangeStart, rangeEnd, iceViewer),
      ]);
      return [...direct, ...ice];
    }
  );

  // GET /calendar/league-events?start=...&end=...
  // Returns league draw schedule as calendar events (read-only, source: 'leagues')
  fastify.get(
    '/calendar/league-events',
    {
      schema: {
        tags: ['calendar'],
        querystring: {
          type: 'object',
          required: ['start', 'end'],
          properties: {
            start: { type: 'string', description: 'ISO date or datetime' },
            end: { type: 'string', description: 'ISO date or datetime' },
          },
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const q = request.query as { start: string; end: string };
      const rangeStart = new Date(q.start);
      const rangeEnd = new Date(q.end);
      return fetchLeagueCalendarEventsForRange(rangeStart, rangeEnd);
    }
  );

  // POST /calendar/events
  fastify.post(
    '/calendar/events',
    {
      schema: {
        tags: ['calendar'],
        body: {
          type: 'object',
          required: ['typeId', 'title', 'start', 'end', 'allDay'],
          properties: {
            typeId: { type: 'string' },
            title: { type: 'string' },
            start: { type: 'string' },
            end: { type: 'string' },
            allDay: { type: 'boolean' },
            description: { type: 'string' },
            locations: { type: 'array' },
            recurrence: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      const member = request.member as Member | undefined;
      if (!member || !isCalendarAdmin(member)) {
        return reply.code(403).send({ error: 'Calendar admin access required' });
      }

      const body = createEventBodySchema.parse(request.body);

      const { db, schema } = getDrizzleDb();

      const recurrenceRule = body.recurrence?.rrule ?? null;
      const recurrenceEndDate = body.recurrence?.endDate ?? null;
      const recurrenceCount = body.recurrence?.count ?? null;

      const [inserted] = await db
        .insert(schema.calendarEvents)
        .values({
          source: 'direct',
          type_id: body.typeId,
          title: body.title,
          start_dt: body.start,
          end_dt: body.end,
          all_day: body.allDay ? 1 : 0,
          description: body.description ?? null,
          article_id: body.articleId ?? null,
          recurrence_rule: recurrenceRule,
          created_by_member_id: member.id,
        })
        .returning({ id: schema.calendarEvents.id });

      if (!inserted) {
        return reply.code(500).send({ error: 'Failed to create event' });
      }

      const eventId = inserted.id;

      const locValues = toLocationRows(eventId, body.locations);
      if (locValues.length > 0) {
        await db.insert(schema.calendarEventLocations).values(locValues);
      }

      return { id: `direct:${eventId}`, success: true };
    }
  );

  // PATCH /calendar/events/:id
  fastify.patch(
    '/calendar/events/:id',
    {
      schema: {
        tags: ['calendar'],
        params: { type: 'object', properties: { id: { type: 'string' } } },
        body: { type: 'object' },
      },
    },
    async (request, reply) => {
      const member = request.member as Member | undefined;
      if (!member || !isCalendarAdmin(member)) {
        return reply.code(403).send({ error: 'Calendar admin access required' });
      }

      const idParam = (request.params as { id: string }).id;
      const body = updateEventBodySchema.parse(request.body);
      const scope = (request.body as { scope?: 'this' | 'all' }).scope;

      const { db, schema } = getDrizzleDb();

      const parts = idParam.split(':');
      const isInstance = parts.length === 3;
      const dbId = isInstance ? parseInt(parts[1], 10) : parseInt(parts[1], 10);
      const recurrenceDate = isInstance ? parts[2] : null;

      if (isNaN(dbId)) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      if (isInstance && scope === 'all') {
        const [parent] = await db
          .select()
          .from(schema.calendarEvents)
          .where(and(eq(schema.calendarEvents.id, dbId), sql`${schema.calendarEvents.parent_event_id} IS NULL`))
          .limit(1);

        if (!parent) {
          const [ov] = await db
            .select()
            .from(schema.calendarEvents)
            .where(eq(schema.calendarEvents.id, dbId))
            .limit(1);
          if (ov?.parent_event_id) {
            await db.update(schema.calendarEvents).set({
              type_id: body.typeId ?? undefined,
              title: body.title ?? undefined,
              start_dt: body.start ?? undefined,
              end_dt: body.end ?? undefined,
              all_day: body.allDay !== undefined ? (body.allDay ? 1 : 0) : undefined,
              description: body.description !== undefined ? body.description : undefined,
              article_id: body.articleId !== undefined ? body.articleId : undefined,
              updated_at: sql`CURRENT_TIMESTAMP`,
            }).where(eq(schema.calendarEvents.parent_event_id, ov.parent_event_id));
            return { success: true };
          }
        }
        if (parent) {
          await db
.update(schema.calendarEvents)
          .set({
            type_id: body.typeId ?? parent.type_id,
            title: body.title ?? parent.title,
            start_dt: body.start ?? parent.start_dt,
            end_dt: body.end ?? parent.end_dt,
            all_day: body.allDay !== undefined ? (body.allDay ? 1 : 0) : parent.all_day,
            description: body.description !== undefined ? body.description : parent.description,
            article_id: body.articleId !== undefined ? body.articleId : parent.article_id,
            recurrence_rule: body.recurrence?.rrule ?? parent.recurrence_rule,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(schema.calendarEvents.id, parent.id));
          if (body.locations) {
            await db.delete(schema.calendarEventLocations).where(eq(schema.calendarEventLocations.event_id, parent.id));
            const locValues = toLocationRows(parent.id, body.locations);
            if (locValues.length > 0) {
              await db.insert(schema.calendarEventLocations).values(locValues);
            }
          }
          return { success: true };
        }
      }

      if (isInstance && scope === 'this' && recurrenceDate) {
        const [parent] = await db
          .select()
          .from(schema.calendarEvents)
          .where(eq(schema.calendarEvents.id, dbId))
          .limit(1);

        if (parent?.parent_event_id) {
          await db.update(schema.calendarEvents).set({
            type_id: body.typeId ?? parent.type_id,
            title: body.title ?? parent.title,
            start_dt: body.start ?? parent.start_dt,
            end_dt: body.end ?? parent.end_dt,
            all_day: body.allDay !== undefined ? (body.allDay ? 1 : 0) : parent.all_day,
            description: body.description !== undefined ? body.description : parent.description,
            article_id: body.articleId !== undefined ? body.articleId : parent.article_id,
            updated_at: sql`CURRENT_TIMESTAMP`,
          }).where(eq(schema.calendarEvents.id, dbId));
          if (body.locations) {
            await db.delete(schema.calendarEventLocations).where(eq(schema.calendarEventLocations.event_id, dbId));
            const locValues = toLocationRows(dbId, body.locations);
            if (locValues.length > 0) {
              await db.insert(schema.calendarEventLocations).values(locValues);
            }
          }
          return { success: true };
        }

        // Add exception so recurrence no longer produces this date
        await db.insert(schema.calendarEventExceptions).values({
          parent_event_id: dbId,
          exception_date: recurrenceDate,
        });
        // Create a standalone event (no parent_event_id) so it's independent of the recurrence.
        // When the user edits "all instances" later, this standalone event won't be affected.
        const [created] = await db
          .insert(schema.calendarEvents)
          .values({
            source: 'direct',
            type_id: body.typeId ?? parent!.type_id,
            title: body.title ?? parent!.title,
            start_dt: body.start ?? parent!.start_dt,
            end_dt: body.end ?? parent!.end_dt,
            all_day: (body.allDay ?? parent!.all_day === 1) ? 1 : 0,
            description: body.description !== undefined ? body.description : parent!.description,
            article_id: body.articleId !== undefined ? body.articleId : parent!.article_id,
            parent_event_id: null,
            recurrence_date: null,
            created_by_member_id: member.id,
          })
          .returning({ id: schema.calendarEvents.id });

        const locValues = toLocationRows(created?.id ?? 0, body.locations);
        if (locValues.length > 0 && created) {
          await db.insert(schema.calendarEventLocations).values(locValues);
        }
        return { success: true };
      }

      const [ev] = await db
        .select()
        .from(schema.calendarEvents)
        .where(eq(schema.calendarEvents.id, dbId))
        .limit(1);

      if (!ev || (ev.parent_event_id != null && ev.recurrence_date == null)) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      await db
        .update(schema.calendarEvents)
        .set({
          type_id: body.typeId ?? ev.type_id,
          title: body.title ?? ev.title,
          start_dt: body.start ?? ev.start_dt,
          end_dt: body.end ?? ev.end_dt,
          all_day: body.allDay !== undefined ? (body.allDay ? 1 : 0) : ev.all_day,
          description: body.description !== undefined ? body.description : ev.description,
          article_id: body.articleId !== undefined ? body.articleId : ev.article_id,
          recurrence_rule: body.recurrence?.rrule ?? ev.recurrence_rule,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.calendarEvents.id, dbId));

      if (body.locations) {
        await db.delete(schema.calendarEventLocations).where(eq(schema.calendarEventLocations.event_id, dbId));
        const locValues = toLocationRows(dbId, body.locations);
        if (locValues.length > 0) {
          await db.insert(schema.calendarEventLocations).values(locValues);
        }
      }

      return { success: true };
    }
  );

  // DELETE /calendar/events/:id
  fastify.delete(
    '/calendar/events/:id',
    {
      schema: {
        tags: ['calendar'],
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const member = request.member as Member | undefined;
      if (!member || !isCalendarAdmin(member)) {
        return reply.code(403).send({ error: 'Calendar admin access required' });
      }

      const idParam = (request.params as { id: string }).id;
      const scope = (request.query as { scope?: 'this' | 'all' }).scope;

      const { db, schema } = getDrizzleDb();

      const parts = idParam.split(':');
      const isInstance = parts.length === 3;
      const dbId = isInstance ? parseInt(parts[1], 10) : parseInt(parts[1], 10);
      const recurrenceDate = isInstance ? parts[2] : null;

      if (isNaN(dbId)) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      if (isInstance && scope === 'this' && recurrenceDate) {
        const [parent] = await db
          .select()
          .from(schema.calendarEvents)
          .where(eq(schema.calendarEvents.id, dbId))
          .limit(1);

        if (parent?.parent_event_id) {
          await db.delete(schema.calendarEvents).where(eq(schema.calendarEvents.id, dbId));
          return { success: true };
        }

        await db.insert(schema.calendarEventExceptions).values({
          parent_event_id: dbId,
          exception_date: recurrenceDate,
        });
        return { success: true };
      }

      if (isInstance && scope === 'all') {
        const [parent] = await db
          .select()
          .from(schema.calendarEvents)
          .where(eq(schema.calendarEvents.id, dbId))
          .limit(1);

        const deleteId = parent?.parent_event_id ?? dbId;
        await db.delete(schema.calendarEvents).where(eq(schema.calendarEvents.id, deleteId));
        await db.delete(schema.calendarEventLocations).where(
          sql`${schema.calendarEventLocations.event_id} IN (SELECT id FROM calendar_events WHERE parent_event_id = ${deleteId})`
        );
        await db.delete(schema.calendarEventLocations).where(eq(schema.calendarEventLocations.event_id, deleteId));
        await db.delete(schema.calendarEventExceptions).where(eq(schema.calendarEventExceptions.parent_event_id, deleteId));
        await db.delete(schema.calendarEvents).where(eq(schema.calendarEvents.parent_event_id, deleteId));
        return { success: true };
      }

      const [ev] = await db
        .select()
        .from(schema.calendarEvents)
        .where(eq(schema.calendarEvents.id, dbId))
        .limit(1);

      if (!ev || ev.parent_event_id != null) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      await db.delete(schema.calendarEventLocations).where(eq(schema.calendarEventLocations.event_id, dbId));
      await db.delete(schema.calendarEvents).where(eq(schema.calendarEvents.id, dbId));

      return { success: true };
    }
  );
}
