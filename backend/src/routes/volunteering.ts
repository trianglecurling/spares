import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Member } from '../types.js';
import { sendApiError, sendValidationError } from '../api/errors.js';
import { isVolunteerManager } from '../utils/auth.js';
import {
  archiveProgram,
  canManageCredential,
  canManageProgram,
  cancelOwnSignup,
  createCredential,
  createProgram,
  createRole,
  createShiftsBulk,
  deleteCredential,
  deleteProgram,
  deleteRole,
  deleteShift,
  duplicateProgram,
  getAdminProgram,
  grantCredential,
  listAdminPrograms,
  listCredentialsAdmin,
  listDashboardOpportunities,
  listHubCredentials,
  listHubPrograms,
  listManagedCredentialIds,
  listManagedProgramIds,
  listMySignups,
  removeSignupAsManager,
  revokeCredential,
  signUpForShiftRole,
  updateCredential,
  updateOwnSignupComments,
  updateProgram,
  updateRole,
  updateShift,
} from '../services/volunteeringService.js';
import { VolunteeringServiceError } from '../services/volunteeringServiceError.js';

interface AuthenticatedRequest extends FastifyRequest {
  member: Member;
}

async function handleServiceError(reply: any, err: unknown) {
  if (err instanceof VolunteeringServiceError) {
    return sendApiError(reply, err.statusCode, err.message);
  }
  throw err;
}

function getMember(request: AuthenticatedRequest): Member | null {
  return (request.member as Member | undefined) ?? null;
}

const programBodySchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  pointOfContact: z.string().min(1),
  location: z.string().nullable().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD')
    .nullable()
    .optional(),
  managerIds: z.array(z.number().int().positive()).optional(),
});

const programPatchSchema = programBodySchema.partial();

const duplicateProgramSchema = z.object({
  title: z.string().min(1),
  pointOfContact: z.string().min(1),
  location: z.string().nullable().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD')
    .nullable(),
  managerIds: z.array(z.number().int().positive()).optional(),
});

const roleBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  defaultDurationMinutes: z.number().int().positive().optional(),
  requiredCredentialIds: z.array(z.number().int().positive()).optional(),
});

const rolePatchSchema = roleBodySchema.partial();

const shiftRoleSchema = z.object({
  roleId: z.number().int().positive(),
  volunteersNeeded: z.number().int().positive(),
});

const shiftsBulkSchema = z.object({
  shifts: z
    .array(
      z.object({
        startDt: z.string().min(1),
        endDt: z.string().min(1),
        roles: z.array(shiftRoleSchema).min(1),
      })
    )
    .min(1),
});

const shiftPatchSchema = z.object({
  startDt: z.string().min(1).optional(),
  endDt: z.string().min(1).optional(),
  roles: z.array(shiftRoleSchema).min(1).optional(),
});

const credentialBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  pointOfContactEmail: z.string().email(),
  managerIds: z.array(z.number().int().positive()).optional(),
});

const credentialPatchSchema = credentialBodySchema.partial();

const grantBodySchema = z.object({
  memberId: z.number().int().positive(),
});

const signupBodySchema = z.object({
  comments: z.string().max(2000).nullable().optional(),
  memberIds: z.array(z.number().int().positive()).optional(),
  guestNames: z.array(z.string().min(1).max(200)).optional(),
});

const signupCommentsBodySchema = z.object({
  comments: z.string().max(2000).nullable().optional(),
});

export async function volunteeringRoutes(fastify: FastifyInstance): Promise<void> {
  // ---- Member hub ----
  fastify.get('/volunteering/programs', { schema: { tags: ['volunteering'] } }, async (request, reply) => {
    const member = getMember(request as AuthenticatedRequest);
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    try {
      return await listHubPrograms(member);
    } catch (err) {
      return handleServiceError(reply, err);
    }
  });

  fastify.get('/volunteering/my-credentials', { schema: { tags: ['volunteering'] } }, async (request, reply) => {
    const member = getMember(request as AuthenticatedRequest);
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    try {
      return { credentials: await listHubCredentials(member.id) };
    } catch (err) {
      return handleServiceError(reply, err);
    }
  });

  fastify.get('/volunteering/my-signups', { schema: { tags: ['volunteering'] } }, async (request, reply) => {
    const member = getMember(request as AuthenticatedRequest);
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    try {
      return await listMySignups(member.id);
    } catch (err) {
      return handleServiceError(reply, err);
    }
  });

  fastify.get(
    '/volunteering/dashboard-opportunities',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      try {
        return { opportunities: await listDashboardOpportunities(member.id) };
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/volunteering/shift-roles/:id/signups',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const shiftRoleId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(shiftRoleId)) return sendApiError(reply, 400, 'Invalid shift role id');
      const parsed = signupBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid signup payload', parsed.error.flatten());
      }
      try {
        const result = await signUpForShiftRole(member, shiftRoleId, parsed.data);
        return reply.code(201).send(result);
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/volunteering/shift-roles/:id/signups/me',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const shiftRoleId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(shiftRoleId)) return sendApiError(reply, 400, 'Invalid shift role id');
      try {
        await cancelOwnSignup(member, shiftRoleId);
        return reply.code(204).send();
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    '/volunteering/shift-roles/:id/signups/me',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const shiftRoleId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(shiftRoleId)) return sendApiError(reply, 400, 'Invalid shift role id');
      const parsed = signupCommentsBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid comments payload', parsed.error.flatten());
      }
      try {
        return await updateOwnSignupComments(member, shiftRoleId, parsed.data.comments);
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  // ---- Admin programs ----
  fastify.get('/volunteering/admin/programs', { schema: { tags: ['volunteering'] } }, async (request, reply) => {
    const member = getMember(request as AuthenticatedRequest);
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    const managed = await listManagedProgramIds(member);
    if (managed !== 'all' && managed.length === 0 && !isVolunteerManager(member)) {
      return sendApiError(reply, 403, 'Forbidden');
    }
    const includeArchived =
      (request.query as { includeArchived?: string } | undefined)?.includeArchived === '1';
    try {
      return { programs: await listAdminPrograms(member, includeArchived) };
    } catch (err) {
      return handleServiceError(reply, err);
    }
  });

  fastify.get<{ Params: { id: string } }>(
    '/volunteering/admin/programs/:id',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const programId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(programId)) return sendApiError(reply, 400, 'Invalid program id');
      try {
        return await getAdminProgram(member, programId, true);
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.post('/volunteering/admin/programs', { schema: { tags: ['volunteering'] } }, async (request, reply) => {
    const member = getMember(request as AuthenticatedRequest);
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    if (!isVolunteerManager(member)) return sendApiError(reply, 403, 'Forbidden');
    const parsed = programBodySchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, 'Invalid program data', parsed.error.flatten());
    try {
      const result = await createProgram({
        ...parsed.data,
        createdByMemberId: member.id,
      });
      return reply.code(201).send(result);
    } catch (err) {
      return handleServiceError(reply, err);
    }
  });

  fastify.post<{ Params: { id: string } }>(
    '/volunteering/admin/programs/:id/duplicate',
    {
      schema: {
        tags: ['volunteering'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 1 },
            pointOfContact: { type: 'string', minLength: 1 },
            location: { type: ['string', 'null'] },
            startDate: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            managerIds: {
              type: 'array',
              items: { type: 'integer' },
            },
          },
          required: ['title', 'pointOfContact', 'startDate'],
        },
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
            },
            required: ['id'],
          },
        },
      },
    },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      if (!isVolunteerManager(member)) return sendApiError(reply, 403, 'Forbidden');
      const programId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(programId)) return sendApiError(reply, 400, 'Invalid program id');
      const parsed = duplicateProgramSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid program duplicate data', parsed.error.flatten());
      }
      try {
        const result = await duplicateProgram(programId, {
          ...parsed.data,
          createdByMemberId: member.id,
        });
        return reply.code(201).send(result);
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    '/volunteering/admin/programs/:id',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const programId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(programId)) return sendApiError(reply, 400, 'Invalid program id');
      if (!(await canManageProgram(member, programId))) return sendApiError(reply, 403, 'Forbidden');
      const parsed = programPatchSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid program data', parsed.error.flatten());
      try {
        await updateProgram(programId, parsed.data);
        return await getAdminProgram(member, programId, true);
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/volunteering/admin/programs/:id/archive',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      if (!isVolunteerManager(member)) return sendApiError(reply, 403, 'Forbidden');
      const programId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(programId)) return sendApiError(reply, 400, 'Invalid program id');
      try {
        await archiveProgram(programId, true);
        return { ok: true };
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/volunteering/admin/programs/:id/restore',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      if (!isVolunteerManager(member)) return sendApiError(reply, 403, 'Forbidden');
      const programId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(programId)) return sendApiError(reply, 400, 'Invalid program id');
      try {
        await archiveProgram(programId, false);
        return { ok: true };
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/volunteering/admin/programs/:id',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      if (!isVolunteerManager(member)) return sendApiError(reply, 403, 'Forbidden');
      const programId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(programId)) return sendApiError(reply, 400, 'Invalid program id');
      try {
        await deleteProgram(programId);
        return reply.code(204).send();
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  // ---- Roles ----
  fastify.post<{ Params: { id: string } }>(
    '/volunteering/admin/programs/:id/roles',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const programId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(programId)) return sendApiError(reply, 400, 'Invalid program id');
      if (!(await canManageProgram(member, programId))) return sendApiError(reply, 403, 'Forbidden');
      const parsed = roleBodySchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid role data', parsed.error.flatten());
      try {
        const result = await createRole({ programId, ...parsed.data });
        return reply.code(201).send(result);
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    '/volunteering/admin/roles/:id',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const roleId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(roleId)) return sendApiError(reply, 400, 'Invalid role id');
      const parsed = rolePatchSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid role data', parsed.error.flatten());
      try {
        const { getDrizzleDb } = await import('../db/drizzle-db.js');
        const { eq } = await import('drizzle-orm');
        const { db, schema } = getDrizzleDb();
        const existing = await db
          .select({ programId: schema.volunteerRoles.program_id })
          .from(schema.volunteerRoles)
          .where(eq(schema.volunteerRoles.id, roleId))
          .limit(1);
        if (!existing[0]) return sendApiError(reply, 404, 'Role not found');
        if (!(await canManageProgram(member, existing[0].programId))) {
          return sendApiError(reply, 403, 'Forbidden');
        }
        const { programId } = await updateRole(roleId, parsed.data);
        return { ok: true, programId };
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/volunteering/admin/roles/:id',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const roleId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(roleId)) return sendApiError(reply, 400, 'Invalid role id');
      try {
        // Authorize via getAdminProgram path: look up role's program through a dry run of delete after auth.
        // Load program id without deleting first:
        const { getDrizzleDb } = await import('../db/drizzle-db.js');
        const { eq } = await import('drizzle-orm');
        const { db, schema } = getDrizzleDb();
        const existing = await db
          .select({ programId: schema.volunteerRoles.program_id })
          .from(schema.volunteerRoles)
          .where(eq(schema.volunteerRoles.id, roleId))
          .limit(1);
        if (!existing[0]) return sendApiError(reply, 404, 'Role not found');
        if (!(await canManageProgram(member, existing[0].programId))) {
          return sendApiError(reply, 403, 'Forbidden');
        }
        await deleteRole(roleId);
        return reply.code(204).send();
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  // ---- Shifts ----
  fastify.post<{ Params: { id: string } }>(
    '/volunteering/admin/programs/:id/shifts/bulk',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const programId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(programId)) return sendApiError(reply, 400, 'Invalid program id');
      if (!(await canManageProgram(member, programId))) return sendApiError(reply, 403, 'Forbidden');
      const parsed = shiftsBulkSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid shifts data', parsed.error.flatten());
      try {
        const result = await createShiftsBulk({ programId, shifts: parsed.data.shifts });
        return reply.code(201).send(result);
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    '/volunteering/admin/shifts/:id',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const shiftId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(shiftId)) return sendApiError(reply, 400, 'Invalid shift id');
      const parsed = shiftPatchSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid shift data', parsed.error.flatten());
      try {
        const { getDrizzleDb } = await import('../db/drizzle-db.js');
        const { eq } = await import('drizzle-orm');
        const { db, schema } = getDrizzleDb();
        const existing = await db
          .select({ programId: schema.volunteerShifts.program_id })
          .from(schema.volunteerShifts)
          .where(eq(schema.volunteerShifts.id, shiftId))
          .limit(1);
        if (!existing[0]) return sendApiError(reply, 404, 'Shift not found');
        if (!(await canManageProgram(member, existing[0].programId))) {
          return sendApiError(reply, 403, 'Forbidden');
        }
        await updateShift(shiftId, parsed.data);
        return { ok: true };
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/volunteering/admin/shifts/:id',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const shiftId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(shiftId)) return sendApiError(reply, 400, 'Invalid shift id');
      try {
        const { getDrizzleDb } = await import('../db/drizzle-db.js');
        const { eq } = await import('drizzle-orm');
        const { db, schema } = getDrizzleDb();
        const existing = await db
          .select({ programId: schema.volunteerShifts.program_id })
          .from(schema.volunteerShifts)
          .where(eq(schema.volunteerShifts.id, shiftId))
          .limit(1);
        if (!existing[0]) return sendApiError(reply, 404, 'Shift not found');
        if (!(await canManageProgram(member, existing[0].programId))) {
          return sendApiError(reply, 403, 'Forbidden');
        }
        await deleteShift(shiftId);
        return reply.code(204).send();
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/volunteering/admin/signups/:id',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const signupId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(signupId)) return sendApiError(reply, 400, 'Invalid signup id');
      try {
        await removeSignupAsManager(signupId, member);
        return reply.code(204).send();
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  // ---- Credentials ----
  fastify.get('/volunteering/admin/credentials', { schema: { tags: ['volunteering'] } }, async (request, reply) => {
    const member = getMember(request as AuthenticatedRequest);
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    const managed = await listManagedCredentialIds(member);
    if (managed !== 'all' && managed.length === 0 && !isVolunteerManager(member)) {
      return sendApiError(reply, 403, 'Forbidden');
    }
    try {
      return { credentials: await listCredentialsAdmin(member) };
    } catch (err) {
      return handleServiceError(reply, err);
    }
  });

  fastify.post('/volunteering/admin/credentials', { schema: { tags: ['volunteering'] } }, async (request, reply) => {
    const member = getMember(request as AuthenticatedRequest);
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    if (!isVolunteerManager(member)) return sendApiError(reply, 403, 'Forbidden');
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
    '/volunteering/admin/credentials/:id',
    { schema: { tags: ['volunteering'] } },
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

  fastify.delete<{ Params: { id: string } }>(
    '/volunteering/admin/credentials/:id',
    { schema: { tags: ['volunteering'] } },
    async (request, reply) => {
      const member = getMember(request as AuthenticatedRequest);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      if (!isVolunteerManager(member)) return sendApiError(reply, 403, 'Forbidden');
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
    '/volunteering/admin/credentials/:id/grants',
    { schema: { tags: ['volunteering'] } },
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
        });
        return reply.code(201).send(result);
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.delete<{ Params: { id: string; memberId: string } }>(
    '/volunteering/admin/credentials/:id/grants/:memberId',
    { schema: { tags: ['volunteering'] } },
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
