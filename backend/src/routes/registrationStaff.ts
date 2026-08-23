import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendValidationError } from '../api/errors.js';
import { cancelStaffRegistration } from '../registration/registrationPriorityEdit.js';
import { RegistrationPriorityEditValidationError } from '../registration/registrationPriorityEdit.js';
import { createStaffRegistrationDraft } from '../registration/registrationStaffCreateService.js';
import {
  RegistrationMembershipPaymentValidationError,
  recordStaffOfflineRegistrationPayment,
  submitStaffRegistrationEdits,
  triggerDeferredRegistrationPayment,
} from '../registration/registrationMembershipPaymentService.js';
import { resolveFrontendBaseUrl } from '../utils/frontendUrl.js';
import { getStaffRegistrationStats } from '../registration/registrationStaffStats.js';
import {
  getStaffRegistrationDetail,
  listStaffRegistrations,
  listStaffRegistrationSessions,
  RegistrationStaffValidationError,
} from '../registration/registrationStaffService.js';
import { RegistrationShellValidationError } from '../registration/registrationShellService.js';
import type { Member } from '../types.js';
import { memberCanManageRegistrations } from '../utils/registrationStaffAccess.js';

interface AuthenticatedRequest extends FastifyRequest {
  member: Member;
}

function requireRegistrationManage(request: FastifyRequest, reply: FastifyReply): boolean {
  const member = request.member;
  if (!member) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  if (!memberCanManageRegistrations(member)) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function handleStaffRegistrationError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof RegistrationStaffValidationError) {
    sendValidationError(reply, error.message, error.details);
    return true;
  }
  if (error instanceof RegistrationShellValidationError) {
    sendValidationError(reply, error.message, error.details);
    return true;
  }
  if (error instanceof RegistrationMembershipPaymentValidationError) {
    sendValidationError(reply, error.message, error.details);
    return true;
  }
  if (error instanceof RegistrationPriorityEditValidationError) {
    sendValidationError(reply, error.message, error.details);
    return true;
  }
  if (error instanceof z.ZodError) {
    sendValidationError(reply, 'Validation failed', error.flatten().fieldErrors as Record<string, string[]>);
    return true;
  }
  return false;
}

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const listQuerySchema = z.object({
  sessionId: z.coerce.number().int().positive(),
  search: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});
const statsQuerySchema = z.object({
  sessionId: z.coerce.number().int().positive(),
});
const staffSubmitSchema = z.object({
  changedSummary: z.string().min(1).optional(),
  confirmImmediatePayment: z.boolean().optional(),
});
const staffCancelSchema = z.object({
  refund: z.boolean().optional(),
});
const staffCreateSchema = z
  .object({
    sessionId: z.number().int().positive(),
    acceptPoliciesOnBehalf: z.literal(true),
    curlerMemberId: z.number().int().positive().optional(),
    newCurler: z
      .object({
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().min(1),
        email: z.string().trim().email(),
        phone: z.string().trim().optional(),
      })
      .optional(),
  })
  .refine((body) => Boolean(body.curlerMemberId) !== Boolean(body.newCurler), {
    message: 'Choose either an existing member or a new curler.',
  });
const staffOfflinePaymentSchema = z.object({
  note: z.string().trim().min(1, 'Enter a check number or other explanation.').max(500),
});

export async function protectedRegistrationStaffRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/registration/staff/sessions', async (request, reply) => {
    if (!requireRegistrationManage(request, reply)) return;
    try {
      return await listStaffRegistrationSessions();
    } catch (error) {
      if (handleStaffRegistrationError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/staff/registrations', async (request, reply) => {
    if (!requireRegistrationManage(request, reply)) return;
    try {
      const body = staffCreateSchema.parse(request.body);
      return await createStaffRegistrationDraft({
        actor: (request as AuthenticatedRequest).member,
        sessionId: body.sessionId,
        acceptPoliciesOnBehalf: body.acceptPoliciesOnBehalf,
        curlerMemberId: body.curlerMemberId,
        newCurler: body.newCurler,
      });
    } catch (error) {
      if (handleStaffRegistrationError(reply, error)) return;
      throw error;
    }
  });

  fastify.get('/registration/staff/registrations', async (request, reply) => {
    if (!requireRegistrationManage(request, reply)) return;
    try {
      const query = listQuerySchema.parse(request.query);
      return await listStaffRegistrations({
        actor: (request as AuthenticatedRequest).member,
        ...query,
      });
    } catch (error) {
      if (handleStaffRegistrationError(reply, error)) return;
      throw error;
    }
  });

  fastify.get('/registration/staff/stats', async (request, reply) => {
    if (!requireRegistrationManage(request, reply)) return;
    try {
      const query = statsQuerySchema.parse(request.query);
      return await getStaffRegistrationStats({
        actor: (request as AuthenticatedRequest).member,
        sessionId: query.sessionId,
      });
    } catch (error) {
      if (handleStaffRegistrationError(reply, error)) return;
      throw error;
    }
  });

  fastify.get('/registration/staff/registrations/:id', async (request, reply) => {
    if (!requireRegistrationManage(request, reply)) return;
    try {
      const params = idParamsSchema.parse(request.params);
      return await getStaffRegistrationDetail(params.id, (request as AuthenticatedRequest).member);
    } catch (error) {
      if (handleStaffRegistrationError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/staff/registrations/:id/submit', async (request, reply) => {
    if (!requireRegistrationManage(request, reply)) return;
    try {
      const params = idParamsSchema.parse(request.params);
      const body = staffSubmitSchema.parse(request.body ?? {});
      return await submitStaffRegistrationEdits({
        registrationId: params.id,
        actor: (request as AuthenticatedRequest).member,
        changedSummary: body.changedSummary,
        confirmImmediatePayment: body.confirmImmediatePayment,
        frontendBaseUrl: resolveFrontendBaseUrl(request),
      });
    } catch (error) {
      if (handleStaffRegistrationError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/staff/registrations/:id/record-offline-payment', async (request, reply) => {
    if (!requireRegistrationManage(request, reply)) return;
    try {
      const params = idParamsSchema.parse(request.params);
      const body = staffOfflinePaymentSchema.parse(request.body ?? {});
      return await recordStaffOfflineRegistrationPayment({
        registrationId: params.id,
        actor: (request as AuthenticatedRequest).member,
        note: body.note,
      });
    } catch (error) {
      if (handleStaffRegistrationError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/staff/registrations/:id/request-payment', async (request, reply) => {
    if (!requireRegistrationManage(request, reply)) return;
    try {
      const params = idParamsSchema.parse(request.params);
      return await triggerDeferredRegistrationPayment({
        registrationId: params.id,
        actorMemberId: (request as AuthenticatedRequest).member.id,
        frontendBaseUrl: resolveFrontendBaseUrl(request),
      });
    } catch (error) {
      if (handleStaffRegistrationError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/staff/registrations/:id/cancel', async (request, reply) => {
    if (!requireRegistrationManage(request, reply)) return;
    try {
      const params = idParamsSchema.parse(request.params);
      staffCancelSchema.parse(request.body ?? {});
      return await cancelStaffRegistration({
        registrationId: params.id,
        actor: (request as AuthenticatedRequest).member,
      });
    } catch (error) {
      if (handleStaffRegistrationError(reply, error)) return;
      throw error;
    }
  });
}
