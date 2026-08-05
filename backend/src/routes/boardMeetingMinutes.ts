import { FastifyInstance, FastifyRequest } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  boardMeetingMinutesItemSchema,
  boardMeetingMinutesListResponseSchema,
  boardMeetingMinutesWriteBodySchema,
} from '../api/boardMeetingMinutesSchemas.js';
import type { ApiErrorResponse } from '../api/types.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import {
  getSeasonStartYearForUtcDate,
  parseFiscalYearStartMmdd,
} from '../utils/fiscalSeason.js';
import { canManageBoardMeetingMinutes } from '../utils/governanceSecretary.js';

interface AuthenticatedRequest extends FastifyRequest {
  member?: Member;
}

type ApiReply<T> = T | ApiErrorResponse;

const writeBodySchema = z.object({
  meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Meeting date must be YYYY-MM-DD'),
  documentUrl: z.string().trim().min(1, 'Document URL is required').url('Document URL must be a valid URL'),
  comment: z.string().trim().nullable().optional(),
});

const idParamsSchema = z.object({
  id: z.string().regex(/^\d+$/),
});

function toIso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const trimmed = String(value).trim();
  return trimmed || null;
}

function toDateOnly(value: string | Date | null | undefined): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const trimmed = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  return trimmed;
}

function formatTwoYearSeasonLabel(seasonStartYear: number): string {
  const y2 = seasonStartYear + 1;
  return `${seasonStartYear}-${String(y2 % 100).padStart(2, '0')}`;
}

function mapRow(row: {
  id: number;
  meeting_date: string | Date;
  document_url: string;
  comment: string | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
}) {
  return {
    id: row.id,
    meetingDate: toDateOnly(row.meeting_date),
    documentUrl: row.document_url,
    comment: row.comment ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function getFiscalYearStartMmdd(): Promise<string> {
  const { db, schema } = getDrizzleDb();
  const [settings] = await db
    .select({ mmdd: schema.governanceSettings.fiscal_year_start_mmdd })
    .from(schema.governanceSettings)
    .where(eq(schema.governanceSettings.id, 1))
    .limit(1);
  return settings?.mmdd?.trim() || '09-01';
}

export async function boardMeetingMinutesRoutes(fastify: FastifyInstance) {
  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/board-meeting-minutes',
    {
      schema: {
        tags: ['board-meeting-minutes'],
        response: {
          200: boardMeetingMinutesListResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { db, schema } = getDrizzleDb();
      const [fiscalYearStartMmdd, rows, canManage] = await Promise.all([
        getFiscalYearStartMmdd(),
        db.select().from(schema.boardMeetingMinutes).orderBy(desc(schema.boardMeetingMinutes.meeting_date)),
        canManageBoardMeetingMinutes(member),
      ]);

      const fiscal = parseFiscalYearStartMmdd(fiscalYearStartMmdd);
      const groups = new Map<
        number,
        { fiscalYearStartYear: number; label: string; minutes: ReturnType<typeof mapRow>[] }
      >();

      for (const row of rows) {
        const meetingDate = toDateOnly(row.meeting_date);
        const [y, m, d] = meetingDate.split('-').map((part) => Number.parseInt(part, 10));
        if (!y || !m || !d) continue;
        const seasonStartYear = getSeasonStartYearForUtcDate(new Date(Date.UTC(y, m - 1, d)), fiscal);
        let group = groups.get(seasonStartYear);
        if (!group) {
          group = {
            fiscalYearStartYear: seasonStartYear,
            label: formatTwoYearSeasonLabel(seasonStartYear),
            minutes: [],
          };
          groups.set(seasonStartYear, group);
        }
        group.minutes.push(mapRow(row));
      }

      const fiscalYears = [...groups.values()].sort(
        (a, b) => b.fiscalYearStartYear - a.fiscalYearStartYear,
      );

      return {
        canManage,
        fiscalYearStartMmdd,
        fiscalYears,
      };
    },
  );

  fastify.post<{ Reply: ApiReply<unknown> }>(
    '/board-meeting-minutes',
    {
      schema: {
        tags: ['board-meeting-minutes'],
        body: boardMeetingMinutesWriteBodySchema,
        response: {
          200: boardMeetingMinutesItemSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      if (!(await canManageBoardMeetingMinutes(member))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const parsed = writeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid board meeting minutes',
          details: parsed.error.flatten(),
        });
      }

      const { db, schema } = getDrizzleDb();
      try {
        const inserted = await db
          .insert(schema.boardMeetingMinutes)
          .values({
            meeting_date: parsed.data.meetingDate,
            document_url: parsed.data.documentUrl,
            comment: parsed.data.comment?.trim() || null,
            created_by_member_id: member.id,
            updated_by_member_id: member.id,
          })
          .returning();
        return mapRow(inserted[0]);
      } catch (err: unknown) {
        const message = String((err as { message?: unknown })?.message ?? err).toLowerCase();
        if (message.includes('unique') || message.includes('duplicate')) {
          return reply.code(409).send({ error: 'A minutes entry with this document URL already exists.' });
        }
        throw err;
      }
    },
  );

  fastify.patch<{ Reply: ApiReply<unknown> }>(
    '/board-meeting-minutes/:id',
    {
      schema: {
        tags: ['board-meeting-minutes'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: boardMeetingMinutesWriteBodySchema,
        response: {
          200: boardMeetingMinutesItemSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      if (!(await canManageBoardMeetingMinutes(member))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid minutes id' });
      }
      const parsed = writeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid board meeting minutes',
          details: parsed.error.flatten(),
        });
      }

      const id = Number.parseInt(params.data.id, 10);
      const { db, schema } = getDrizzleDb();
      try {
        const updated = await db
          .update(schema.boardMeetingMinutes)
          .set({
            meeting_date: parsed.data.meetingDate,
            document_url: parsed.data.documentUrl,
            comment: parsed.data.comment?.trim() || null,
            updated_by_member_id: member.id,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(schema.boardMeetingMinutes.id, id))
          .returning();
        if (!updated[0]) {
          return reply.code(404).send({ error: 'Minutes not found' });
        }
        return mapRow(updated[0]);
      } catch (err: unknown) {
        const message = String((err as { message?: unknown })?.message ?? err).toLowerCase();
        if (message.includes('unique') || message.includes('duplicate')) {
          return reply.code(409).send({ error: 'A minutes entry with this document URL already exists.' });
        }
        throw err;
      }
    },
  );

  fastify.delete<{ Reply: ApiReply<unknown> }>(
    '/board-meeting-minutes/:id',
    {
      schema: {
        tags: ['board-meeting-minutes'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            properties: { success: { type: 'boolean' } },
            required: ['success'],
          },
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!member) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      if (!(await canManageBoardMeetingMinutes(member))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid minutes id' });
      }

      const id = Number.parseInt(params.data.id, 10);
      const { db, schema } = getDrizzleDb();
      const deleted = await db
        .delete(schema.boardMeetingMinutes)
        .where(eq(schema.boardMeetingMinutes.id, id))
        .returning({ id: schema.boardMeetingMinutes.id });
      if (!deleted[0]) {
        return reply.code(404).send({ error: 'Minutes not found' });
      }
      return { success: true };
    },
  );
}
