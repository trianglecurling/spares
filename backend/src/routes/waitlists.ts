import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendValidationError } from '../api/errors.js';
import type { Member } from '../types.js';
import {
  acceptWaitlistOffer,
  addWaitlistEntryForWaitlist,
  cancelWaitlistOffer,
  declineWaitlistOffer,
  getWaitlistManagerById,
  listWaitlistsOverview,
  moveWaitlistEntryToBottom,
  removeWaitlistEntry,
  reorderWaitlistEntries,
  renameWaitlist,
  processBatchVacancyOffers,
  sendWaitlistOffers,
  triggerWaitlistDeferredPayment,
  updateWaitlistEntry,
  WaitlistStaffValidationError,
} from '../registration/waitlistStaffService.js';
import {
  getMemberWaitlistJoinContext,
  getWaitlistTeamMemberPlacementOptions,
  joinMemberWaitlist,
} from '../registration/memberWaitlistJoinService.js';
import { RegistrationMemberValidationError } from '../registration/registrationMemberService.js';
import { memberCanManageWaitlists, memberCanViewWaitlists } from '../utils/waitlistAccess.js';

function requireWaitlistView(request: FastifyRequest, reply: FastifyReply): Member | null {
  const member = request.member;
  if (!member) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  if (!memberCanViewWaitlists(member)) {
    reply.code(403).send({ error: 'Forbidden' });
    return null;
  }
  return member;
}

function requireWaitlistManage(request: FastifyRequest, reply: FastifyReply): Member | null {
  const member = request.member;
  if (!member) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  if (!memberCanManageWaitlists(member)) {
    reply.code(403).send({ error: 'Forbidden' });
    return null;
  }
  return member;
}

function handleWaitlistError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof RegistrationMemberValidationError) {
    sendValidationError(reply, error.message, error.details);
    return true;
  }
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

const waitlistIdParamsSchema = z.object({ waitlistId: z.coerce.number().int().positive() });
const entryParamsSchema = z.object({ entryId: z.coerce.number().int().positive() });
const offerParamsSchema = z.object({ offerId: z.coerce.number().int().positive() });
const listQuerySchema = z.object({ sessionId: z.coerce.number().int().positive().optional() });
const detailQuerySchema = z.object({
  placementLeagueId: z.coerce.number().int().positive().optional(),
});
const reasonSchema = z.object({ reason: z.string().min(1) });
const teamRosterPlacementSchema = z.object({
  memberId: z.number().int().positive(),
  entryType: z.enum(['add', 'replace']),
  replacesLeagueId: z.number().int().positive().optional().nullable(),
});
const teamRosterPlacementsSchema = z.array(teamRosterPlacementSchema).optional().nullable();
const createEntrySchema = z.object({
  placementLeagueId: z.number().int().positive(),
  memberId: z.number().int().positive(),
  entryType: z.enum(['add', 'replace']),
  replacesLeagueId: z.number().int().positive().optional().nullable(),
  teamRosterText: z.string().optional().nullable(),
  teamRosterPlacements: teamRosterPlacementsSchema,
  reason: z.string().min(1),
});
const updateEntrySchema = z.object({
  entryType: z.enum(['add', 'replace']).optional(),
  replacesLeagueId: z.number().int().positive().optional().nullable(),
  teamRosterText: z.string().optional().nullable(),
  teamRosterPlacements: teamRosterPlacementsSchema,
  reason: z.string().min(1),
});
const expiresAtSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'A valid response deadline is required.' });

const createOfferSchema = z.object({
  placementLeagueId: z.number().int().positive(),
  offerType: z.enum(['permanent', 'temporary_sabbatical_fill']),
  entryIds: z.array(z.number().int().positive()).optional(),
  count: z.number().int().positive().max(50).optional(),
  reason: z.string().min(1),
  expiresAt: expiresAtSchema,
  override: z.boolean().optional(),
  staffNotes: z.string().optional().nullable(),
});
const reorderSchema = z.object({
  entryIds: z.array(z.number().int().positive()).min(1),
  reason: z.string().min(1),
});
const renameWaitlistSchema = z.object({
  name: z.string().min(1),
});
const sessionParamsSchema = z.object({ sessionId: z.coerce.number().int().positive() });
const processVacanciesSchema = z.object({
  offerType: z.enum(['permanent', 'temporary_sabbatical_fill']).default('permanent'),
  leagueIds: z.array(z.number().int().positive()).optional(),
  reason: z.string().min(1),
  expiresAt: expiresAtSchema,
  override: z.boolean().optional(),
});
const joinWaitlistSchema = z.object({
  entryType: z.enum(['add', 'replace']).optional(),
  replacesLeagueId: z.number().int().positive().optional().nullable(),
  teamRosterText: z.string().optional().nullable(),
  teamRosterPlacements: teamRosterPlacementsSchema,
});
const teamMemberPlacementOptionsQuerySchema = z.object({
  memberIds: z
    .union([z.string(), z.array(z.coerce.number().int().positive())])
    .transform((value) => {
      if (Array.isArray(value)) return value;
      return value
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isFinite(id) && id > 0);
    }),
});

const looseObjectSchema = {
  type: 'object',
  additionalProperties: true,
} as const;

export async function waitlistRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/waitlists', { schema: { tags: ['waitlists'] } }, async (request, reply) => {
    if (!requireWaitlistView(request, reply)) return;
    try {
      const query = listQuerySchema.parse(request.query);
      return await listWaitlistsOverview(query);
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.get('/waitlists/:waitlistId', { schema: { tags: ['waitlists'] } }, async (request, reply) => {
    if (!requireWaitlistView(request, reply)) return;
    try {
      const params = waitlistIdParamsSchema.parse(request.params);
      const query = detailQuerySchema.parse(request.query);
      return await getWaitlistManagerById({
        waitlistId: params.waitlistId,
        placementLeagueId: query.placementLeagueId,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.get(
    '/waitlists/:waitlistId/team-member-placement-options',
    { schema: { tags: ['waitlists'] } },
    async (request, reply) => {
      if (!requireWaitlistView(request, reply)) return;
      try {
        const params = waitlistIdParamsSchema.parse(request.params);
        const query = teamMemberPlacementOptionsQuerySchema.parse(request.query);
        return await getWaitlistTeamMemberPlacementOptions(params.waitlistId, query.memberIds);
      } catch (error) {
        if (handleWaitlistError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.get('/waitlists/:waitlistId/join-context', { schema: { tags: ['waitlists'] } }, async (request, reply) => {
    const member = requireWaitlistView(request, reply);
    if (!member) return;
    try {
      const params = waitlistIdParamsSchema.parse(request.params);
      return await getMemberWaitlistJoinContext(member, params.waitlistId);
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/waitlists/:waitlistId/join', { schema: { tags: ['waitlists'], body: looseObjectSchema } }, async (request, reply) => {
    const member = requireWaitlistView(request, reply);
    if (!member) return;
    try {
      const params = waitlistIdParamsSchema.parse(request.params);
      const body = joinWaitlistSchema.parse(request.body);
      return await joinMemberWaitlist({
        member,
        waitlistId: params.waitlistId,
        entryType: body.entryType,
        replacesLeagueId: body.replacesLeagueId,
        teamRosterText: body.teamRosterText,
        teamRosterPlacements: body.teamRosterPlacements,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.patch('/waitlists/:waitlistId', { schema: { tags: ['waitlists'], body: looseObjectSchema } }, async (request, reply) => {
    const member = requireWaitlistManage(request, reply);
    if (!member) return;
    try {
      const params = waitlistIdParamsSchema.parse(request.params);
      const body = renameWaitlistSchema.parse(request.body);
      return await renameWaitlist({
        waitlistId: params.waitlistId,
        name: body.name,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/waitlists/:waitlistId/entries/reorder', { schema: { tags: ['waitlists'], body: looseObjectSchema } }, async (request, reply) => {
    const member = requireWaitlistManage(request, reply);
    if (!member) return;
    try {
      const params = waitlistIdParamsSchema.parse(request.params);
      const body = reorderSchema.parse(request.body);
      return await reorderWaitlistEntries({
        waitlistId: params.waitlistId,
        entryIds: body.entryIds,
        reason: body.reason,
        actorMemberId: member.id,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/waitlists/:waitlistId/entries', { schema: { tags: ['waitlists'], body: looseObjectSchema } }, async (request, reply) => {
    const member = requireWaitlistManage(request, reply);
    if (!member) return;
    try {
      const params = waitlistIdParamsSchema.parse(request.params);
      const body = createEntrySchema.parse(request.body);
      return await addWaitlistEntryForWaitlist({
        waitlistId: params.waitlistId,
        placementLeagueId: body.placementLeagueId,
        memberId: body.memberId,
        entryType: body.entryType,
        replacesLeagueId: body.replacesLeagueId,
        teamRosterText: body.teamRosterText,
        teamRosterPlacements: body.teamRosterPlacements,
        reason: body.reason,
        actorMemberId: member.id,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/waitlists/sessions/:sessionId/process-vacancies', { schema: { tags: ['waitlists'], body: looseObjectSchema } }, async (request, reply) => {
    const member = requireWaitlistManage(request, reply);
    if (!member) return;
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
        actorMemberId: member.id,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/waitlists/:waitlistId/offers', { schema: { tags: ['waitlists'], body: looseObjectSchema } }, async (request, reply) => {
    const member = requireWaitlistManage(request, reply);
    if (!member) return;
    try {
      waitlistIdParamsSchema.parse(request.params);
      const body = createOfferSchema.parse(request.body);
      return await sendWaitlistOffers({
        leagueId: body.placementLeagueId,
        offerType: body.offerType,
        entryIds: body.entryIds,
        count: body.count,
        reason: body.reason,
        expiresAt: body.expiresAt,
        override: body.override,
        staffNotes: body.staffNotes,
        actorMemberId: member.id,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.patch('/waitlists/entries/:entryId', { schema: { tags: ['waitlists'], body: looseObjectSchema } }, async (request, reply) => {
    const member = requireWaitlistManage(request, reply);
    if (!member) return;
    try {
      const params = entryParamsSchema.parse(request.params);
      const body = updateEntrySchema.parse(request.body);
      return await updateWaitlistEntry({
        entryId: params.entryId,
        actorMemberId: member.id,
        reason: body.reason,
        entryType: body.entryType,
        replacesLeagueId: body.replacesLeagueId,
        teamRosterText: body.teamRosterText,
        teamRosterPlacements: body.teamRosterPlacements,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/waitlists/entries/:entryId/move-to-bottom', { schema: { tags: ['waitlists'], body: looseObjectSchema } }, async (request, reply) => {
    const member = requireWaitlistManage(request, reply);
    if (!member) return;
    try {
      const params = entryParamsSchema.parse(request.params);
      const body = reasonSchema.parse(request.body);
      return await moveWaitlistEntryToBottom({
        entryId: params.entryId,
        actorMemberId: member.id,
        reason: body.reason,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.delete('/waitlists/entries/:entryId', { schema: { tags: ['waitlists'], body: looseObjectSchema } }, async (request, reply) => {
    const member = requireWaitlistManage(request, reply);
    if (!member) return;
    try {
      const params = entryParamsSchema.parse(request.params);
      const body = reasonSchema.parse(request.body);
      return await removeWaitlistEntry({
        entryId: params.entryId,
        actorMemberId: member.id,
        reason: body.reason,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/waitlists/offers/:offerId/accept', { schema: { tags: ['waitlists'], body: looseObjectSchema } }, async (request, reply) => {
    const member = requireWaitlistManage(request, reply);
    if (!member) return;
    try {
      const params = offerParamsSchema.parse(request.params);
      const body = reasonSchema.parse(request.body);
      return await acceptWaitlistOffer({
        offerId: params.offerId,
        actorMemberId: member.id,
        reason: body.reason,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/waitlists/offers/:offerId/decline', { schema: { tags: ['waitlists'], body: looseObjectSchema } }, async (request, reply) => {
    const member = requireWaitlistManage(request, reply);
    if (!member) return;
    try {
      const params = offerParamsSchema.parse(request.params);
      const body = reasonSchema.parse(request.body);
      return await declineWaitlistOffer({
        offerId: params.offerId,
        actorMemberId: member.id,
        reason: body.reason,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/waitlists/offers/:offerId/cancel', { schema: { tags: ['waitlists'], body: looseObjectSchema } }, async (request, reply) => {
    const member = requireWaitlistManage(request, reply);
    if (!member) return;
    try {
      const params = offerParamsSchema.parse(request.params);
      const body = reasonSchema.parse(request.body);
      return await cancelWaitlistOffer({
        offerId: params.offerId,
        actorMemberId: member.id,
        reason: body.reason,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });

  fastify.post('/waitlists/offers/:offerId/payment-link', { schema: { tags: ['waitlists'], body: looseObjectSchema } }, async (request, reply) => {
    const member = requireWaitlistManage(request, reply);
    if (!member) return;
    try {
      const params = offerParamsSchema.parse(request.params);
      const body = reasonSchema.parse(request.body);
      return await triggerWaitlistDeferredPayment({
        offerId: params.offerId,
        actorMemberId: member.id,
        reason: body.reason,
      });
    } catch (error) {
      if (handleWaitlistError(reply, error)) return;
      throw error;
    }
  });
}
