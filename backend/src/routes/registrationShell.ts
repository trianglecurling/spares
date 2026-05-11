import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendApiError, sendValidationError } from '../api/errors.js';
import type { ApiErrorResponse } from '../api/types.js';
import type { Member } from '../types.js';
import {
  RegistrationShellValidationError,
  acceptPolicies,
  attachNewCurler,
  attachReturningCurler,
  canViewOrEditRegistration,
  completeShell,
  createDraft,
  getEffectiveRegistrationWindow,
  getDefaultRegistrationWindow,
  getRegistrationById,
  getRegistrationShellPayload,
  listEligibleReturningProfiles,
  updateCurlerDemographics,
  updateGuardian,
  type GuardianInput,
  type MemberDemographicsInput,
} from '../registration/registrationShellService.js';

interface AuthenticatedRequest extends FastifyRequest {
  member: Member;
}

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const windowQuerySchema = z.object({
  seasonId: z.coerce.number().int().positive().optional(),
  sessionId: z.coerce.number().int().positive().optional(),
});
const createDraftSchema = z.object({
  seasonId: z.number().int().positive(),
  sessionId: z.number().int().positive(),
  returningMember: z.boolean(),
});
const returningIdentitySchema = z.object({
  curlerMemberId: z.number().int().positive(),
});
const demographicsSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  mailingAddress: z.string().min(1),
  emergencyContactName: z.string().min(1),
  emergencyContactPhone: z.string().min(1),
});
const newIdentitySchema = z.object({
  registeringForSelf: z.boolean(),
  submitter: demographicsSchema.partial().extend({ email: z.string().email() }).optional(),
  curler: demographicsSchema.partial().extend({ email: z.string().email() }),
  useSubmitterEmailForCurler: z.boolean().optional(),
});
const policiesSchema = z.object({
  acceptedPolicyTypes: z.array(z.enum(['code_of_conduct', 'maapp', 'privacy'])).length(3),
});
const guardianSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
});

const idParamsJsonSchema = {
  type: 'object',
  properties: { id: { type: 'number' } },
  required: ['id'],
} as const;

const apiErrorResponseSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    error: { type: 'string' },
    details: {},
  },
  required: ['error'],
} as const;

const anyObjectSchema = {
  type: 'object',
  additionalProperties: true,
} as const;

function handleRegistrationError(reply: FastifyReply, error: unknown) {
  if (error instanceof RegistrationShellValidationError) {
    return sendValidationError(reply, error.message, error.details);
  }
  if (error instanceof z.ZodError) {
    return sendValidationError(reply, 'Validation failed', error.flatten());
  }
  console.error('Registration shell error:', error);
  return sendApiError(reply, 500, 'Registration request failed');
}

async function requireDraftAccess(request: FastifyRequest, reply: FastifyReply, id: number) {
  const registration = await getRegistrationById(id);
  if (!registration) {
    sendApiError(reply, 404, 'Registration draft not found');
    return null;
  }
  const member = (request as AuthenticatedRequest).member;
  if (!registration.submitted_by_member_id && !registration.curler_member_id && registration.status === 'identity_incomplete') {
    return registration;
  }
  if (!(await canViewOrEditRegistration(member, registration))) {
    sendApiError(reply, 403, 'Forbidden');
    return null;
  }
  return registration;
}

export async function publicRegistrationShellRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { seasonId?: number; sessionId?: number }; Reply: unknown | ApiErrorResponse }>(
    '/registration/window',
    {
      schema: {
        tags: ['registration'],
        querystring: {
          type: 'object',
          properties: { seasonId: { type: 'number' }, sessionId: { type: 'number' } },
        },
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const query = windowQuerySchema.parse(request.query);
        const window = query.seasonId && query.sessionId
          ? await getEffectiveRegistrationWindow(query.seasonId, query.sessionId)
          : await getDefaultRegistrationWindow();
        if (!window) return sendApiError(reply, 404, 'Registration window not found');
        return window;
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.post<{ Body: z.infer<typeof createDraftSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts',
    {
      schema: {
        tags: ['registration'],
        body: {
          type: 'object',
          properties: {
            seasonId: { type: 'number' },
            sessionId: { type: 'number' },
            returningMember: { type: 'boolean' },
          },
          required: ['seasonId', 'sessionId', 'returningMember'],
        },
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const body = createDraftSchema.parse(request.body);
        return await createDraft(body);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: number }; Body: z.infer<typeof newIdentitySchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/identity-new-auth',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        body: anyObjectSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        const existing = await getRegistrationById(id);
        if (!existing) return sendApiError(reply, 404, 'Registration draft not found');
        if (existing.submitted_by_member_id) return sendApiError(reply, 403, 'This draft already has an owner.');
        const body = newIdentitySchema.parse(request.body);
        return await attachNewCurler({
          registrationId: id,
          registeringForSelf: body.registeringForSelf,
          submitter: body.submitter,
          curler: body.curler,
          useSubmitterEmailForCurler: body.useSubmitterEmailForCurler,
        });
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );
}

export async function protectedRegistrationShellRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: number }; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        response: { 200: anyObjectSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        const registration = await requireDraftAccess(request, reply, id);
        if (!registration) return reply;
        return await getRegistrationShellPayload(id);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.get('/registration/returning-profiles', {
    schema: {
      tags: ['registration'],
      response: { 200: { type: 'array', items: anyObjectSchema } },
    },
  }, async (request) => {
    return listEligibleReturningProfiles((request as AuthenticatedRequest).member.id);
  });

  fastify.patch<{ Params: { id: number }; Body: z.infer<typeof returningIdentitySchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/identity-returning',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        body: {
          type: 'object',
          properties: { curlerMemberId: { type: 'number' } },
          required: ['curlerMemberId'],
        },
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        const registration = await getRegistrationById(id);
        if (!registration) return sendApiError(reply, 404, 'Registration draft not found');
        const body = returningIdentitySchema.parse(request.body);
        return await attachReturningCurler({
          registrationId: id,
          actorMemberId: (request as AuthenticatedRequest).member.id,
          curlerMemberId: body.curlerMemberId,
        });
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: number }; Body: z.infer<typeof newIdentitySchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/identity-new',
    {
      schema: {
        tags: ['registration'],
        params: idParamsJsonSchema,
        body: anyObjectSchema,
        response: { 200: anyObjectSchema, 400: apiErrorResponseSchema, 403: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        const registration = await getRegistrationById(id);
        if (!registration) return sendApiError(reply, 404, 'Registration draft not found');
        if (registration.submitted_by_member_id && !(await requireDraftAccess(request, reply, id))) return reply;
        const body = newIdentitySchema.parse(request.body);
        return await attachNewCurler({
          registrationId: id,
          actorMemberId: (request as AuthenticatedRequest).member.id,
          registeringForSelf: body.registeringForSelf,
          submitter: body.submitter,
          curler: body.curler,
          useSubmitterEmailForCurler: body.useSubmitterEmailForCurler,
        });
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: number }; Body: z.infer<typeof policiesSchema>; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/policies',
    {
      schema: { tags: ['registration'], params: idParamsJsonSchema, body: anyObjectSchema, response: { 200: anyObjectSchema } },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        if (!(await requireDraftAccess(request, reply, id))) return reply;
        policiesSchema.parse(request.body);
        await acceptPolicies(id, (request as AuthenticatedRequest).member.id);
        return await getRegistrationShellPayload(id);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: number }; Body: MemberDemographicsInput & { confirmedCurrent?: boolean }; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/demographics',
    {
      schema: { tags: ['registration'], params: idParamsJsonSchema, body: anyObjectSchema, response: { 200: anyObjectSchema } },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        if (!(await requireDraftAccess(request, reply, id))) return reply;
        const body = demographicsSchema.extend({ confirmedCurrent: z.boolean().optional() }).parse(request.body);
        await updateCurlerDemographics(id, body, body.confirmedCurrent ?? false);
        return await getRegistrationShellPayload(id);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: number }; Body: GuardianInput; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/guardian',
    {
      schema: { tags: ['registration'], params: idParamsJsonSchema, body: anyObjectSchema, response: { 200: anyObjectSchema } },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        if (!(await requireDraftAccess(request, reply, id))) return reply;
        const body = guardianSchema.parse(request.body);
        await updateGuardian(id, body);
        return await getRegistrationShellPayload(id);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { id: number }; Reply: unknown | ApiErrorResponse }>(
    '/registration/drafts/:id/complete-shell',
    {
      schema: { tags: ['registration'], params: idParamsJsonSchema, response: { 200: anyObjectSchema } },
    },
    async (request, reply) => {
      try {
        const { id } = idParamsSchema.parse(request.params);
        if (!(await requireDraftAccess(request, reply, id))) return reply;
        await completeShell(id);
        return await getRegistrationShellPayload(id);
      } catch (error) {
        return handleRegistrationError(reply, error);
      }
    }
  );
}
