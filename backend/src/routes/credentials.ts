import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Member } from '../types.js';
import { sendApiError, sendValidationError } from '../api/errors.js';
import { isCredentialsManager } from '../utils/auth.js';
import {
  archiveCredential,
  canManageCredential,
  createCredential,
  deleteCredential,
  getCredentialAdmin,
  grantCredential,
  listCredentialsAdmin,
  listManagedCredentialIds,
  revokeCredential,
  updateCredential,
  updateCredentialGrant,
} from '../services/credentialService.js';
import { CredentialServiceError } from '../services/credentialServiceError.js';

interface AuthenticatedRequest extends FastifyRequest {
  member: Member;
}

async function handleServiceError(reply: any, err: unknown) {
  if (err instanceof CredentialServiceError) {
    return sendApiError(reply, err.statusCode, err.message);
  }
  throw err;
}

function getMember(request: AuthenticatedRequest): Member | null {
  return (request.member as Member | undefined) ?? null;
}

const credentialBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  pointOfContactEmail: z.string().email(),
  managerIds: z.array(z.number().int().positive()).optional(),
});

const credentialPatchSchema = credentialBodySchema.partial();

const grantExpiresAtSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiration date must be YYYY-MM-DD')
  .nullable();

const grantBodySchema = z.object({
  memberId: z.number().int().positive(),
  expiresAt: grantExpiresAtSchema.optional(),
});

const grantPatchSchema = z.object({
  expiresAt: grantExpiresAtSchema,
});

export async function credentialRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/members/admin/credentials', { schema: { tags: ['members'] } }, async (request, reply) => {
    const member = getMember(request as AuthenticatedRequest);
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    const managed = await listManagedCredentialIds(member);
    if (managed !== 'all' && managed.length === 0) {
      return sendApiError(reply, 403, 'Forbidden');
    }
    const includeArchived =
      (request.query as { includeArchived?: string } | undefined)?.includeArchived === '1';
    try {
      return { credentials: await listCredentialsAdmin(member, { includeArchived }) };
    } catch (err) {
      return handleServiceError(reply, err);
    }
  });

  fastify.get<{ Params: { id: string } }>(
    '/members/admin/credentials/:id',
    { schema: { tags: ['members'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const credentialId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(credentialId)) return sendApiError(reply, 400, 'Invalid credential id');
      try {
        return { credential: await getCredentialAdmin(member, credentialId) };
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.post('/members/admin/credentials', { schema: { tags: ['members'] } }, async (request, reply) => {
    const member = getMember(request as AuthenticatedRequest);
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    if (!isCredentialsManager(member)) return sendApiError(reply, 403, 'Forbidden');
    const parsed = credentialBodySchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, 'Invalid credential data', parsed.error.flatten());
    try {
      const result = await createCredential(parsed.data);
      return reply.code(201).send(result);
    } catch (err) {
      return handleServiceError(reply, err);
    }
  });

  fastify.patch<{ Params: { id: string } }>(
    '/members/admin/credentials/:id',
    { schema: { tags: ['members'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const credentialId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(credentialId)) return sendApiError(reply, 400, 'Invalid credential id');
      if (!(await canManageCredential(member, credentialId))) return sendApiError(reply, 403, 'Forbidden');
      const parsed = credentialPatchSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid credential data', parsed.error.flatten());
      try {
        await updateCredential(credentialId, parsed.data);
        return { ok: true };
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/members/admin/credentials/:id/archive',
    { schema: { tags: ['members'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const credentialId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(credentialId)) return sendApiError(reply, 400, 'Invalid credential id');
      if (!isCredentialsManager(member)) return sendApiError(reply, 403, 'Forbidden');
      try {
        await archiveCredential(credentialId, true);
        return { ok: true };
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/members/admin/credentials/:id/restore',
    { schema: { tags: ['members'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const credentialId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(credentialId)) return sendApiError(reply, 400, 'Invalid credential id');
      if (!isCredentialsManager(member)) return sendApiError(reply, 403, 'Forbidden');
      try {
        await archiveCredential(credentialId, false);
        return { ok: true };
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/members/admin/credentials/:id',
    { schema: { tags: ['members'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      if (!isCredentialsManager(member)) return sendApiError(reply, 403, 'Forbidden');
      const credentialId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(credentialId)) return sendApiError(reply, 400, 'Invalid credential id');
      try {
        await deleteCredential(credentialId);
        return reply.code(204).send();
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/members/admin/credentials/:id/grants',
    { schema: { tags: ['members'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const credentialId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(credentialId)) return sendApiError(reply, 400, 'Invalid credential id');
      if (!(await canManageCredential(member, credentialId))) return sendApiError(reply, 403, 'Forbidden');
      const parsed = grantBodySchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid grant data', parsed.error.flatten());
      try {
        const result = await grantCredential({
          credentialId,
          memberId: parsed.data.memberId,
          grantedByMemberId: member.id,
          expiresAt: parsed.data.expiresAt,
        });
        return reply.code(201).send(result);
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.patch<{ Params: { id: string; memberId: string } }>(
    '/members/admin/credentials/:id/grants/:memberId',
    { schema: { tags: ['members'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const credentialId = Number.parseInt(request.params.id, 10);
      const memberId = Number.parseInt(request.params.memberId, 10);
      if (!Number.isFinite(credentialId) || !Number.isFinite(memberId)) {
        return sendApiError(reply, 400, 'Invalid id');
      }
      if (!(await canManageCredential(member, credentialId))) return sendApiError(reply, 403, 'Forbidden');
      const parsed = grantPatchSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid grant data', parsed.error.flatten());
      try {
        await updateCredentialGrant(credentialId, memberId, parsed.data.expiresAt);
        return { ok: true };
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.delete<{ Params: { id: string; memberId: string } }>(
    '/members/admin/credentials/:id/grants/:memberId',
    { schema: { tags: ['members'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const credentialId = Number.parseInt(request.params.id, 10);
      const memberId = Number.parseInt(request.params.memberId, 10);
      if (!Number.isFinite(credentialId) || !Number.isFinite(memberId)) {
        return sendApiError(reply, 400, 'Invalid id');
      }
      if (!(await canManageCredential(member, credentialId))) return sendApiError(reply, 403, 'Forbidden');
      try {
        await revokeCredential(credentialId, memberId);
        return reply.code(204).send();
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );
}
