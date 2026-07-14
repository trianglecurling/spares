import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendValidationError } from '../api/errors.js';
import type { Member } from '../types.js';
import { isAdmin } from '../utils/auth.js';
import { memberCanManageWaitlists, memberCanViewWaitlists } from '../utils/waitlistAccess.js';
import {
  acceptWaitlistOffer,
  acceptWaitlistOfferForMember,
  addWaitlistEntry,
  cancelWaitlistOffer,
  declineWaitlistOffer,
  declineWaitlistOfferForMember,
  getLeagueWaitlistManager,
  getWaitlistDashboard,
  moveWaitlistEntryToBottom,
  removeWaitlistEntry,
  rollWaitlistForwardForStaff,
  processBatchVacancyOffers,
  sendWaitlistOffers,
  triggerWaitlistDeferredPayment,
  updateWaitlistEntry,
  WaitlistStaffValidationError,
} from '../registration/waitlistStaffService.js';
import {
  listStaffRegistrationCommunications,
  resendStaffRegistrationCommunication,
  reviewJuniorFinancialAssistance,
  sendManualRegistrationUpdateEmail,
} from '../registration/registrationStaffCommunicationService.js';

interface AuthenticatedRequest extends FastifyRequest {
  member: Member;
}

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const member = request.member;
  if (!member) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  if (!isAdmin(member)) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function requireWaitlistView(request: FastifyRequest, reply: FastifyReply): boolean {
  const member = request.member;
  if (!member) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  if (!memberCanViewWaitlists(member)) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function requireWaitlistManage(request: FastifyRequest, reply: FastifyReply): boolean {
  const member = request.member;
  if (!member) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  if (!memberCanManageWaitlists(member)) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function handleWaitlistError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof WaitlistStaffValidationError) {
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
const leagueParamsSchema = z.object({ leagueId: z.coerce.number().int().positive() });
const offerParamsSchema = z.object({ offerId: z.coerce.number().int().positive() });
const entryParamsSchema = z.object({ entryId: z.coerce.number().int().positive() });
const dashboardQuerySchema = z.object({ sessionId: z.coerce.number().int().positive().optional() });
const reasonSchema = z.object({ reason: z.string().min(1) });
const createOfferSchema = z.object({
  offerType: z.enum(['permanent', 'temporary_sabbatical_fill']),
  entryIds: z.array(z.number().int().positive()).optional(),
  count: z.number().int().positive().max(50).optional(),
  reason: z.string().min(1),
  expiresAt: z
    .string()
    .min(1)
    .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'A valid response deadline is required.' }),
  override: z.boolean().optional(),
  staffNotes: z.string().optional().nullable(),
});
const createEntrySchema = z.object({
  leagueId: z.number().int().positive(),
  memberId: z.number().int().positive(),
  entryType: z.enum(['add', 'replace']),
  replacesLeagueId: z.number().int().positive().optional().nullable(),
  teamRosterText: z.string().optional().nullable(),
  reason: z.string().min(1),
});
const updateEntrySchema = z.object({
  entryType: z.enum(['add', 'replace']).optional(),
  replacesLeagueId: z.number().int().positive().optional().nullable(),
  teamRosterText: z.string().optional().nullable(),
  reason: z.string().min(1),
});
const rolloverSchema = z.object({
  toLeagueId: z.number().int().positive().optional(),
  reason: z.string().min(1),
});
const communicationsQuerySchema = z.object({
  registrationId: z.coerce.number().int().positive().optional(),
  waitlistOfferId: z.coerce.number().int().positive().optional(),
});
const manualUpdateEmailSchema = z.object({
  changedSummary: z.string().min(1),
  paymentImpact: z.string().optional().nullable(),
});
const financialAssistanceReviewSchema = z.object({
  status: z.enum(['approved', 'partially_approved', 'denied', 'withdrawn']),
  approvedPercentage: z.number().min(0).max(100).optional().nullable(),
  staffNotes: z.string().optional().nullable(),
});
const sessionParamsSchema = z.object({ sessionId: z.coerce.number().int().positive() });
const processVacanciesSchema = z.object({
  offerType: z.enum(['permanent', 'temporary_sabbatical_fill']).default('permanent'),
  leagueIds: z.array(z.number().int().positive()).optional(),
  reason: z.string().min(1),
  expiresAt: z
    .string()
    .min(1)
    .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'A valid response deadline is required.' }),
  override: z.boolean().optional(),
});

export async function protectedRegistrationWaitlistStaffRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/registration/member/waitlist-offers/:offerId/accept', async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!member) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    try {
      const params = offerParamsSchema.parse(request.params);
      return await acceptWaitlistOfferForMember({ offerId: params.offerId, actorMemberId: member.id });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/member/waitlist-offers/:offerId/decline', async (request, reply) => {
    const member = (request as AuthenticatedRequest).member;
    if (!member) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    try {
      const params = offerParamsSchema.parse(request.params);
      return await declineWaitlistOfferForMember({ offerId: params.offerId, actorMemberId: member.id });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.get('/registration/waitlists/dashboard', async (request, reply) => {
    if (!requireWaitlistView(request, reply)) return;
    try {
      const query = dashboardQuerySchema.parse(request.query);
      return await getWaitlistDashboard(query);
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.get('/registration/staff/communications', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const query = communicationsQuerySchema.parse(request.query);
      return await listStaffRegistrationCommunications(query);
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/staff/communications/:id/resend', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const params = idParamsSchema.parse(request.params);
      return await resendStaffRegistrationCommunication(params.id);
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/staff/registrations/:id/manual-update-email', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const params = idParamsSchema.parse(request.params);
      const body = manualUpdateEmailSchema.parse(request.body);
      return await sendManualRegistrationUpdateEmail({
        registrationId: params.id,
        changedSummary: body.changedSummary,
        paymentImpact: body.paymentImpact,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.patch('/registration/staff/financial-assistance/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const params = idParamsSchema.parse(request.params);
      const body = financialAssistanceReviewSchema.parse(request.body);
      return await reviewJuniorFinancialAssistance({
        requestId: params.id,
        actorMemberId: (request as AuthenticatedRequest).member.id,
        status: body.status,
        approvedPercentage: body.approvedPercentage,
        staffNotes: body.staffNotes,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.get('/registration/waitlists/leagues/:leagueId', async (request, reply) => {
    if (!requireWaitlistView(request, reply)) return;
    try {
      const params = leagueParamsSchema.parse(request.params);
      return await getLeagueWaitlistManager(params.leagueId);
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/waitlists/leagues/:leagueId/offers', async (request, reply) => {
    if (!requireWaitlistManage(request, reply)) return;
    try {
      const params = leagueParamsSchema.parse(request.params);
      const body = createOfferSchema.parse(request.body);
      return await sendWaitlistOffers({
        leagueId: params.leagueId,
        offerType: body.offerType,
        entryIds: body.entryIds,
        count: body.count,
        reason: body.reason,
        expiresAt: body.expiresAt,
        override: body.override,
        staffNotes: body.staffNotes,
        actorMemberId: (request as AuthenticatedRequest).member.id,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/waitlists/sessions/:sessionId/process-vacancies', async (request, reply) => {
    if (!requireWaitlistManage(request, reply)) return;
    try {
      const params = sessionParamsSchema.parse(request.params);
      const body = processVacanciesSchema.parse(request.body);
      return await processBatchVacancyOffers({
        sessionId: params.sessionId,
        leagueIds: body.leagueIds,
        offerType: body.offerType,
        reason: body.reason,
        expiresAt: body.expiresAt,
        override: body.override,
        actorMemberId: (request as AuthenticatedRequest).member.id,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/waitlists/offers/:offerId/accept', async (request, reply) => {
    if (!requireWaitlistManage(request, reply)) return;
    try {
      const params = offerParamsSchema.parse(request.params);
      const body = reasonSchema.parse(request.body);
      return await acceptWaitlistOffer({ offerId: params.offerId, actorMemberId: (request as AuthenticatedRequest).member.id, reason: body.reason });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/waitlists/offers/:offerId/decline', async (request, reply) => {
    if (!requireWaitlistManage(request, reply)) return;
    try {
      const params = offerParamsSchema.parse(request.params);
      const body = reasonSchema.parse(request.body);
      return await declineWaitlistOffer({ offerId: params.offerId, actorMemberId: (request as AuthenticatedRequest).member.id, reason: body.reason });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/waitlists/offers/:offerId/cancel', async (request, reply) => {
    if (!requireWaitlistManage(request, reply)) return;
    try {
      const params = offerParamsSchema.parse(request.params);
      const body = reasonSchema.parse(request.body);
      return await cancelWaitlistOffer({ offerId: params.offerId, actorMemberId: (request as AuthenticatedRequest).member.id, reason: body.reason });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/waitlists/offers/:offerId/payment-link', async (request, reply) => {
    if (!requireWaitlistManage(request, reply)) return;
    try {
      const params = offerParamsSchema.parse(request.params);
      const body = reasonSchema.parse(request.body);
      return await triggerWaitlistDeferredPayment({ offerId: params.offerId, actorMemberId: (request as AuthenticatedRequest).member.id, reason: body.reason });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/waitlists/entries', async (request, reply) => {
    if (!requireWaitlistManage(request, reply)) return;
    try {
      const body = createEntrySchema.parse(request.body);
      return await addWaitlistEntry({ ...body, actorMemberId: (request as AuthenticatedRequest).member.id });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.patch('/registration/waitlists/entries/:entryId', async (request, reply) => {
    if (!requireWaitlistManage(request, reply)) return;
    try {
      const params = entryParamsSchema.parse(request.params);
      const body = updateEntrySchema.parse(request.body);
      return await updateWaitlistEntry({ ...body, entryId: params.entryId, actorMemberId: (request as AuthenticatedRequest).member.id });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/waitlists/entries/:entryId/move-to-bottom', async (request, reply) => {
    if (!requireWaitlistManage(request, reply)) return;
    try {
      const params = entryParamsSchema.parse(request.params);
      const body = reasonSchema.parse(request.body);
      return await moveWaitlistEntryToBottom({ entryId: params.entryId, actorMemberId: (request as AuthenticatedRequest).member.id, reason: body.reason });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.delete('/registration/waitlists/entries/:entryId', async (request, reply) => {
    if (!requireWaitlistManage(request, reply)) return;
    try {
      const params = entryParamsSchema.parse(request.params);
      const body = reasonSchema.parse(request.body);
      return await removeWaitlistEntry({ entryId: params.entryId, actorMemberId: (request as AuthenticatedRequest).member.id, reason: body.reason });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/registration/waitlists/leagues/:leagueId/rollover', async (request, reply) => {
    if (!requireWaitlistManage(request, reply)) return;
    try {
      const params = leagueParamsSchema.parse(request.params);
      const body = rolloverSchema.parse(request.body);
      return await rollWaitlistForwardForStaff({
        fromLeagueId: params.leagueId,
        toLeagueId: body.toLeagueId,
        reason: body.reason,
        actorMemberId: (request as AuthenticatedRequest).member.id,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.get('/registration/waitlists/:id', async (request, reply) => {
    if (!requireWaitlistView(request, reply)) return;
    try {
      const params = idParamsSchema.parse(request.params);
      return await getLeagueWaitlistManager(params.id);
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });
}

export async function publicRegistrationWaitlistOfferRoutes(_fastify: FastifyInstance): Promise<void> {
  await Promise.resolve();
}
