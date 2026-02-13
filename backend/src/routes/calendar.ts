import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, or, sql } from 'drizzle-orm';
import rrule from 'rrule';
const { RRule } = rrule;
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isCalendarAdmin } from '../utils/auth.js';
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

    const rrule = new RRule(options);
    // Use between() instead of all() so infinite recurrence only generates instances
    // within the requested range rather than until year 9999
    const dates = rrule.between(rangeStart, rangeEnd, true);

    return dates.map((dt) => {
      const instanceStart = dt.toISOString();
      const instanceEnd = new Date(dt.getTime() + durationMs).toISOString();
      return { start: instanceStart, end: instanceEnd };
    });
  } catch {
    return [];
  }
}

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
            // Recurring events: include if recurrence has started (start_dt <= rangeEnd).
            // Non-recurring: include only if event overlaps range.
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

      const exceptionSet = new Set(
        exceptions.map((ex) => `${ex.parent_event_id}:${ex.exception_date}`)
      );

      const locationsByEventId = new Map<number, Array<{ type: string; sheet_id: number | null }>>();
      const eventIds = [
        ...events.map((e) => e.id),
        ...overrides.map((o) => o.id),
      ];
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

      const result: Array<{
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
      }> = [];

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
            const override = overrides.find(
              (o) => o.parent_event_id === ev.id && o.recurrence_date === incDate
            );
            // Skip if this instance was deleted (exception) and not replaced by an override
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
              createdBy: (useEv.created_by_member_id ?? ev.created_by_member_id) != null
                ? creatorNameById.get(useEv.created_by_member_id ?? ev.created_by_member_id!)
                : undefined,
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
          });
        }
      }

      return result;
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
