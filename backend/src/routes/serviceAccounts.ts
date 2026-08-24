import { randomBytes } from 'node:crypto';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { isServerAdmin } from '../utils/auth.js';
import { ACCOUNT_KIND_SERVICE } from '../utils/accountKind.js';
import {
  mintPersonalAccessToken,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
  serviceAccountEmail,
} from '../services/personalAccessTokenService.js';

function requireServerAdmin(member: Member | undefined, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (!member || !isServerAdmin(member)) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

const createBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  roleIds: z.array(z.number().int().positive()).default([]),
});

const updateBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  roleIds: z.array(z.number().int().positive()).optional(),
});

const mintTokenBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  expiresAt: z.string().datetime().nullable().optional(),
});

const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const tokenParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  tokenId: z.coerce.number().int().positive(),
});

async function assertAssignableRoleIds(roleIds: number[]): Promise<string | null> {
  if (roleIds.length === 0) return null;
  const uniqueIds = [...new Set(roleIds)];
  const { db, schema } = getDrizzleDb();
  const roles = await db
    .select({
      id: schema.roles.id,
      isAssignable: schema.roles.is_assignable,
    })
    .from(schema.roles)
    .where(inArray(schema.roles.id, uniqueIds));
  if (roles.length !== uniqueIds.length) return 'Unknown role id';
  if (roles.some((role) => role.isAssignable !== 1)) return 'Role is not directly assignable';
  return null;
}

async function replaceRoleAssignments(memberId: number, roleIds: number[]): Promise<void> {
  const uniqueIds = [...new Set(roleIds)];
  const { db, schema } = getDrizzleDb();
  await db.transaction(async (tx) => {
    await tx.delete(schema.memberRoleAssignments).where(eq(schema.memberRoleAssignments.member_id, memberId));
    if (uniqueIds.length > 0) {
      await tx.insert(schema.memberRoleAssignments).values(
        uniqueIds.map((roleId) => ({
          member_id: memberId,
          role_id: roleId,
          resource_type: null,
          resource_id: null,
        }))
      );
    }
  });
}

async function loadServiceAccount(memberId: number) {
  const { db, schema } = getDrizzleDb();
  const [member] = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      email: schema.members.email,
      createdAt: schema.members.created_at,
    })
    .from(schema.members)
    .where(and(eq(schema.members.id, memberId), eq(schema.members.account_kind, ACCOUNT_KIND_SERVICE)))
    .limit(1);
  if (!member) return null;

  const [tokenCountRow] = await db
    .select({ value: count() })
    .from(schema.personalAccessTokens)
    .where(
      and(eq(schema.personalAccessTokens.member_id, memberId), isNull(schema.personalAccessTokens.revoked_at))
    );

  const roleRows = await db
    .select({
      id: schema.roles.id,
      code: schema.roles.code,
      name: schema.roles.name,
    })
    .from(schema.memberRoleAssignments)
    .innerJoin(schema.roles, eq(schema.memberRoleAssignments.role_id, schema.roles.id))
    .where(eq(schema.memberRoleAssignments.member_id, memberId))
    .orderBy(asc(schema.roles.name));

  return {
    id: member.id,
    name: member.name,
    email: member.email,
    createdAt: member.createdAt,
    tokenCount: Number(tokenCountRow?.value ?? 0),
    roles: roleRows,
  };
}

export async function serviceAccountRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/service-accounts',
    {
      schema: { tags: ['service-accounts'] },
    },
    async (request, reply) => {
      if (!requireServerAdmin(request.member, reply)) return;
      const { db, schema } = getDrizzleDb();
      const rows = await db
        .select({
          id: schema.members.id,
          name: schema.members.name,
          email: schema.members.email,
          createdAt: schema.members.created_at,
        })
        .from(schema.members)
        .where(eq(schema.members.account_kind, ACCOUNT_KIND_SERVICE))
        .orderBy(asc(schema.members.name));

      const accounts = [];
      for (const row of rows) {
        const account = await loadServiceAccount(row.id);
        if (account) accounts.push(account);
      }
      return { serviceAccounts: accounts };
    }
  );

  fastify.post(
    '/service-accounts',
    {
      schema: { tags: ['service-accounts'] },
    },
    async (request, reply) => {
      if (!requireServerAdmin(request.member, reply)) return;
      const body = createBodySchema.parse(request.body);
      const roleError = await assertAssignableRoleIds(body.roleIds);
      if (roleError) return reply.code(400).send({ error: roleError });

      const uniqueSuffix = randomBytes(3).toString('hex');
      const email = serviceAccountEmail(body.name, uniqueSuffix);
      const { db, schema } = getDrizzleDb();
      const [created] = await db
        .insert(schema.members)
        .values({
          name: body.name,
          email,
          account_kind: ACCOUNT_KIND_SERVICE,
          email_subscribed: 0,
          email_visible: 0,
          phone_visible: 0,
          opted_in_sms: 0,
        })
        .returning({ id: schema.members.id });

      if (!created) return reply.code(500).send({ error: 'Failed to create service account' });
      await replaceRoleAssignments(created.id, body.roleIds);
      const account = await loadServiceAccount(created.id);
      return reply.code(201).send({ serviceAccount: account });
    }
  );

  fastify.patch(
    '/service-accounts/:id',
    {
      schema: { tags: ['service-accounts'] },
    },
    async (request, reply) => {
      if (!requireServerAdmin(request.member, reply)) return;
      const { id } = idParamsSchema.parse(request.params);
      const body = updateBodySchema.parse(request.body);
      const existing = await loadServiceAccount(id);
      if (!existing) return reply.code(404).send({ error: 'Service account not found' });
      if (body.roleIds) {
        const roleError = await assertAssignableRoleIds(body.roleIds);
        if (roleError) return reply.code(400).send({ error: roleError });
      }

      const { db, schema } = getDrizzleDb();
      if (body.name) {
        await db
          .update(schema.members)
          .set({ name: body.name, updated_at: new Date() })
          .where(eq(schema.members.id, id));
      }
      if (body.roleIds) {
        await replaceRoleAssignments(id, body.roleIds);
      }
      return { serviceAccount: await loadServiceAccount(id) };
    }
  );

  fastify.delete(
    '/service-accounts/:id',
    {
      schema: { tags: ['service-accounts'] },
    },
    async (request, reply) => {
      if (!requireServerAdmin(request.member, reply)) return;
      const { id } = idParamsSchema.parse(request.params);
      const existing = await loadServiceAccount(id);
      if (!existing) return reply.code(404).send({ error: 'Service account not found' });
      const { db, schema } = getDrizzleDb();
      await db.delete(schema.members).where(eq(schema.members.id, id));
      return { success: true };
    }
  );

  fastify.get(
    '/service-accounts/:id/tokens',
    {
      schema: { tags: ['service-accounts'] },
    },
    async (request, reply) => {
      if (!requireServerAdmin(request.member, reply)) return;
      const { id } = idParamsSchema.parse(request.params);
      const existing = await loadServiceAccount(id);
      if (!existing) return reply.code(404).send({ error: 'Service account not found' });
      return { tokens: await listPersonalAccessTokens(id) };
    }
  );

  fastify.post(
    '/service-accounts/:id/tokens',
    {
      schema: { tags: ['service-accounts'] },
    },
    async (request, reply) => {
      if (!requireServerAdmin(request.member, reply)) return;
      const { id } = idParamsSchema.parse(request.params);
      const existing = await loadServiceAccount(id);
      if (!existing) return reply.code(404).send({ error: 'Service account not found' });
      const body = mintTokenBodySchema.parse(request.body);
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return reply.code(400).send({ error: 'Invalid expiry' });
      }
      const minted = await mintPersonalAccessToken({
        memberId: id,
        name: body.name,
        createdByMemberId: request.member!.id,
        expiresAt,
      });
      return reply.code(201).send({
        token: minted.token,
        personalAccessToken: minted.summary,
      });
    }
  );

  fastify.delete(
    '/service-accounts/:id/tokens/:tokenId',
    {
      schema: { tags: ['service-accounts'] },
    },
    async (request, reply) => {
      if (!requireServerAdmin(request.member, reply)) return;
      const { id, tokenId } = tokenParamsSchema.parse(request.params);
      const existing = await loadServiceAccount(id);
      if (!existing) return reply.code(404).send({ error: 'Service account not found' });
      const revoked = await revokePersonalAccessToken(tokenId, id);
      if (!revoked) return reply.code(404).send({ error: 'Token not found' });
      return { success: true };
    }
  );
}
