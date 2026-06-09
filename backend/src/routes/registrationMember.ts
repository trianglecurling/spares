import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendValidationError } from '../api/errors.js';
import { RegistrationPriorityEditValidationError } from '../registration/registrationPriorityEdit.js';
import {
  cancelMemberRegistration,
  getMemberCurrentRegistrationDetail,
  getMemberDashboardRegistrationStatus,
  getMemberRegistrationDetail,
  listMemberRegistrationSummaries,
  removeMemberWaitlistEntry,
  RegistrationMemberValidationError,
} from '../registration/registrationMemberService.js';
import { listRegistrationOutboundMessages } from '../registration/registrationEmailService.js';
import type { Member } from '../types.js';

interface AuthenticatedRequest extends FastifyRequest {
  member: Member;
}

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const entryParamsSchema = z.object({ entryId: z.coerce.number().int().positive() });
const listQuerySchema = z.object({ seasonId: z.coerce.number().int().positive().optional() });
const currentQuerySchema = z.object({
  curlerMemberId: z.coerce.number().int().positive().optional(),
  slot: z.coerce.number().int().positive().optional(),
});

function handleMemberRegistrationError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof RegistrationMemberValidationError) {
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

export async function protectedRegistrationMemberRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/registration/member/dashboard-status', async (request) => {
    return getMemberDashboardRegistrationStatus((request as AuthenticatedRequest).member);
  });

  fastify.get('/registration/member/registrations', async (request, reply) => {
    try {
      const query = listQuerySchema.parse(request.query);
      return await listMemberRegistrationSummaries((request as AuthenticatedRequest).member, query.seasonId);
    } catch (error) {
      if (handleMemberRegistrationError(reply, error)) return;
      throw error;
    }
  });

  fastify.get('/registration/member/registrations/current', async (request, reply) => {
    try {
      const query = currentQuerySchema.parse(request.query);
      return await getMemberCurrentRegistrationDetail((request as AuthenticatedRequest).member, {
        curlerMemberId: query.curlerMemberId,
        viewSlot: query.slot,
      });
    } catch (error) {
      if (handleMemberRegistrationError(reply, error)) return;
      throw error;
    }
  });

  fastify.get('/registration/member/registrations/:id', async (request, reply) => {
    try {
      const params = idParamsSchema.parse(request.params);
      return await getMemberRegistrationDetail(params.id, (request as AuthenticatedRequest).member);
    } catch (error) {
      if (handleMemberRegistrationError(reply, error)) return;
      throw error;
    }
  });

  fastify.get('/registration/member/registrations/:id/communications', async (request, reply) => {
    try {
      const params = idParamsSchema.parse(request.params);
      await getMemberRegistrationDetail(params.id, (request as AuthenticatedRequest).member);
      return { communications: await listRegistrationOutboundMessages({ registrationId: params.id, limit: 50 }) };
    } catch (error) {
      if (handleMemberRegistrationError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/member/waitlist-entries/:entryId/remove', async (request, reply) => {
    try {
      const params = entryParamsSchema.parse(request.params);
      return await removeMemberWaitlistEntry({ entryId: params.entryId, actor: (request as AuthenticatedRequest).member });
    } catch (error) {
      if (handleMemberRegistrationError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/member/registrations/current/cancel', async (request, reply) => {
    try {
      const query = currentQuerySchema.parse(request.query);
      const detail = await getMemberCurrentRegistrationDetail((request as AuthenticatedRequest).member, {
        curlerMemberId: query.curlerMemberId,
        viewSlot: query.slot,
      });
      return await cancelMemberRegistration({
        registrationId: detail.registration.id,
        actor: (request as AuthenticatedRequest).member,
      });
    } catch (error) {
      if (handleMemberRegistrationError(reply, error)) return;
      throw error;
    }
  });
}
