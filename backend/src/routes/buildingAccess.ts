import { FastifyInstance, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  buildingAccessAdminSchema,
  buildingAccessAdminUpdateBodySchema,
  buildingAccessCodeSchema,
  buildingAccessPageSchema,
} from '../api/buildingAccessSchemas.js';
import type { ApiErrorResponse } from '../api/types.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { hasClubLeagueAdministratorAccess } from '../utils/leagueAccess.js';
import { hasScope } from '../utils/rbac.js';

interface AuthenticatedRequest extends FastifyRequest {
  member?: Member;
}

type ApiReply<T> = T | ApiErrorResponse;

const updateBodySchema = z.object({
  accessCode: z.string().regex(/^\d{4}$/, 'Access code must be exactly 4 digits'),
  contentType: z.enum(['markdown', 'html']),
  content: z.string(),
});

const EMPTY_CONFIG = {
  access_code: '',
  content_type: 'markdown' as const,
  content: '',
  updated_at: null as string | Date | null,
};

function toIso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const trimmed = String(value).trim();
  return trimmed || null;
}

function mapAdminConfig(row: {
  access_code: string;
  content_type: string;
  content: string;
  updated_at: string | Date | null;
}) {
  return {
    accessCode: row.access_code ?? '',
    contentType: row.content_type === 'html' ? ('html' as const) : ('markdown' as const),
    content: row.content ?? '',
    updatedAt: toIso(row.updated_at),
  };
}

async function ensureConfigRow() {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select()
    .from(schema.buildingAccessConfig)
    .where(eq(schema.buildingAccessConfig.id, 1))
    .limit(1);
  if (existing[0]) return existing[0];

  await db
    .insert(schema.buildingAccessConfig)
    .values({
      id: 1,
      access_code: '',
      content_type: 'markdown',
      content: '',
    })
    .onConflictDoNothing();

  const created = await db
    .select()
    .from(schema.buildingAccessConfig)
    .where(eq(schema.buildingAccessConfig.id, 1))
    .limit(1);
  return created[0] ?? EMPTY_CONFIG;
}

function requireActiveMember(
  member: Member | undefined,
  reply: { code: (n: number) => { send: (b: ApiErrorResponse) => unknown } },
) {
  if (!member) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  if (!hasScope(member.authz, 'member.active')) {
    return reply.code(403).send({
      error: 'Building access is available only to current club members.',
    });
  }
  return null;
}

export async function buildingAccessRoutes(fastify: FastifyInstance) {
  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/building-access',
    {
      schema: {
        tags: ['building-access'],
        response: {
          200: buildingAccessPageSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      const denied = requireActiveMember(member, reply);
      if (denied) return denied;

      const row = await ensureConfigRow();
      const accessCode = (row.access_code ?? '').trim();
      return {
        contentType: row.content_type === 'html' ? 'html' : 'markdown',
        content: row.content ?? '',
        hasAccessCode: /^\d{4}$/.test(accessCode),
      };
    },
  );

  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/building-access/code',
    {
      schema: {
        tags: ['building-access'],
        response: {
          200: buildingAccessCodeSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      const denied = requireActiveMember(member, reply);
      if (denied) return denied;

      const row = await ensureConfigRow();
      const accessCode = (row.access_code ?? '').trim();
      if (!/^\d{4}$/.test(accessCode)) {
        return reply.code(404).send({ error: 'Building access code is not configured yet.' });
      }
      return { accessCode };
    },
  );

  fastify.get<{ Reply: ApiReply<unknown> }>(
    '/building-access/admin',
    {
      schema: {
        tags: ['building-access'],
        response: {
          200: buildingAccessAdminSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!member || !(await hasClubLeagueAdministratorAccess(member))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const row = await ensureConfigRow();
      return mapAdminConfig(row);
    },
  );

  fastify.put<{ Reply: ApiReply<unknown> }>(
    '/building-access/admin',
    {
      schema: {
        tags: ['building-access'],
        body: buildingAccessAdminUpdateBodySchema,
        response: {
          200: buildingAccessAdminSchema,
        },
      },
    },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member;
      if (!member || !(await hasClubLeagueAdministratorAccess(member))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const parsed = updateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid building access settings',
          details: parsed.error.flatten(),
        });
      }

      const { db, schema } = getDrizzleDb();
      await ensureConfigRow();

      const updated = await db
        .update(schema.buildingAccessConfig)
        .set({
          access_code: parsed.data.accessCode,
          content_type: parsed.data.contentType,
          content: parsed.data.content,
          updated_by_member_id: member.id,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.buildingAccessConfig.id, 1))
        .returning();

      return mapAdminConfig(updated[0] ?? (await ensureConfigRow()));
    },
  );
}
