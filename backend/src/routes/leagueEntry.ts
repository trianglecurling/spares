import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendValidationError } from '../api/errors.js';
import type { Member } from '../types.js';
import { hasLeagueAdministratorAccess, hasLeagueManagerAccess } from '../utils/leagueAccess.js';
import { memberCanManageRegistrations } from '../utils/registrationStaffAccess.js';
import {
  LeagueEntryValidationError,
  createLeagueEntryTeamStaff,
  deleteLeagueEntryPointsRow,
  getLeagueEntryReport,
  linkEntryTeamPendingMember,
  recordLeagueEntryTeamOutcome,
  saveManualLeagueEntryPoints,
  updateLeagueEntryTeamStaff,
} from '../registration/leagueEntryService.js';

const leagueParamsSchema = z.object({ leagueId: z.coerce.number().int().positive() });
const teamParamsSchema = z.object({
  leagueId: z.coerce.number().int().positive(),
  teamId: z.coerce.number().int().positive(),
});
const pointsParamsSchema = z.object({
  leagueId: z.coerce.number().int().positive(),
  pointsId: z.coerce.number().int().positive(),
});

const savePointsBodySchema = z.object({
  memberId: z.number().int().positive(),
  points: z.number().min(0),
  countsAsReturning: z.boolean(),
  notes: z.string().max(2000).nullable().optional(),
});

const teamMemberInputSchema = z.object({
  memberId: z.number().int().positive().nullable().optional(),
  pendingName: z.string().max(200).nullable().optional(),
  entryType: z.enum(['add', 'replace']).optional(),
  replacesLeagueId: z.number().int().positive().nullable().optional(),
});

const createTeamBodySchema = z.object({
  name: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  members: z.array(teamMemberInputSchema).min(1),
});

const updateTeamBodySchema = z.object({
  name: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(['pending', 'withdrawn']).optional(),
  members: z.array(teamMemberInputSchema).min(1).optional(),
});

const linkMemberBodySchema = z.object({
  teamMemberId: z.number().int().positive(),
  memberId: z.number().int().positive(),
});

const outcomeBodySchema = z.object({
  outcome: z.enum(['entered']),
});

async function requireEntryView(
  request: FastifyRequest,
  reply: FastifyReply,
  leagueId: number
): Promise<Member | null> {
  const member = request.member;
  if (!member) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  if (!memberCanManageRegistrations(member) && !(await hasLeagueManagerAccess(member, leagueId))) {
    reply.code(403).send({ error: 'Forbidden' });
    return null;
  }
  return member;
}

async function requireEntryManage(
  request: FastifyRequest,
  reply: FastifyReply,
  leagueId: number
): Promise<Member | null> {
  const member = request.member;
  if (!member) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  if (!memberCanManageRegistrations(member) && !(await hasLeagueAdministratorAccess(member, leagueId))) {
    reply.code(403).send({ error: 'Forbidden' });
    return null;
  }
  return member;
}

function handleLeagueEntryError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof LeagueEntryValidationError) {
    sendValidationError(reply, error.message, error.details);
    return true;
  }
  if (error instanceof z.ZodError) {
    sendValidationError(reply, 'Validation failed', error.flatten().fieldErrors as Record<string, string[]>);
    return true;
  }
  return false;
}

const looseObjectSchema = { type: 'object', additionalProperties: true } as const;

export async function leagueEntryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/leagues/:leagueId/entry/report',
    { schema: { tags: ['league-entry'] } },
    async (request, reply) => {
      const { leagueId } = leagueParamsSchema.parse(request.params);
      const member = await requireEntryView(request, reply, leagueId);
      if (!member) return;
      try {
        const report = await getLeagueEntryReport(leagueId);
        const canManage =
          memberCanManageRegistrations(member) || (await hasLeagueAdministratorAccess(member, leagueId));
        return reply.send({ ...report, canManage });
      } catch (error) {
        if (handleLeagueEntryError(reply, error)) return;
        throw error;
      }
    }
  );

  fastify.put(
    '/leagues/:leagueId/entry/points',
    { schema: { tags: ['league-entry'], body: looseObjectSchema } },
    async (request, reply) => {
      const { leagueId } = leagueParamsSchema.parse(request.params);
      const member = await requireEntryManage(request, reply, leagueId);
      if (!member) return;
      try {
        const body = savePointsBodySchema.parse(request.body);
        const result = await saveManualLeagueEntryPoints({
          leagueId,
          memberId: body.memberId,
          points: body.points,
          countsAsReturning: body.countsAsReturning,
          notes: body.notes ?? null,
          actorMemberId: member.id,
        });
        return reply.send(result);
      } catch (error) {
        if (handleLeagueEntryError(reply, error)) return;
        throw error;
      }
    }
  );

  fastify.delete(
    '/leagues/:leagueId/entry/points/:pointsId',
    { schema: { tags: ['league-entry'] } },
    async (request, reply) => {
      const { leagueId, pointsId } = pointsParamsSchema.parse(request.params);
      const member = await requireEntryManage(request, reply, leagueId);
      if (!member) return;
      try {
        await deleteLeagueEntryPointsRow({ leagueId, pointsId });
        return reply.send({ success: true });
      } catch (error) {
        if (handleLeagueEntryError(reply, error)) return;
        throw error;
      }
    }
  );

  fastify.post(
    '/leagues/:leagueId/entry/teams',
    { schema: { tags: ['league-entry'], body: looseObjectSchema } },
    async (request, reply) => {
      const { leagueId } = leagueParamsSchema.parse(request.params);
      const member = await requireEntryManage(request, reply, leagueId);
      if (!member) return;
      try {
        const body = createTeamBodySchema.parse(request.body);
        const result = await createLeagueEntryTeamStaff({
          leagueId,
          name: body.name ?? null,
          notes: body.notes ?? null,
          members: body.members,
          actorMemberId: member.id,
        });
        return reply.send(result);
      } catch (error) {
        if (handleLeagueEntryError(reply, error)) return;
        throw error;
      }
    }
  );

  fastify.patch(
    '/leagues/:leagueId/entry/teams/:teamId',
    { schema: { tags: ['league-entry'], body: looseObjectSchema } },
    async (request, reply) => {
      const { leagueId, teamId } = teamParamsSchema.parse(request.params);
      const member = await requireEntryManage(request, reply, leagueId);
      if (!member) return;
      try {
        const body = updateTeamBodySchema.parse(request.body);
        await updateLeagueEntryTeamStaff({
          teamId,
          leagueId,
          name: body.name,
          notes: body.notes,
          status: body.status,
          members: body.members,
          actorMemberId: member.id,
        });
        return reply.send({ success: true });
      } catch (error) {
        if (handleLeagueEntryError(reply, error)) return;
        throw error;
      }
    }
  );

  fastify.post(
    '/leagues/:leagueId/entry/teams/:teamId/link-member',
    { schema: { tags: ['league-entry'], body: looseObjectSchema } },
    async (request, reply) => {
      const { leagueId, teamId } = teamParamsSchema.parse(request.params);
      const member = await requireEntryManage(request, reply, leagueId);
      if (!member) return;
      try {
        const body = linkMemberBodySchema.parse(request.body);
        await linkEntryTeamPendingMember({
          teamId,
          leagueId,
          teamMemberId: body.teamMemberId,
          memberId: body.memberId,
          actorMemberId: member.id,
        });
        return reply.send({ success: true });
      } catch (error) {
        if (handleLeagueEntryError(reply, error)) return;
        throw error;
      }
    }
  );

  fastify.post(
    '/leagues/:leagueId/entry/teams/:teamId/outcome',
    { schema: { tags: ['league-entry'], body: looseObjectSchema } },
    async (request, reply) => {
      const { leagueId, teamId } = teamParamsSchema.parse(request.params);
      const member = await requireEntryManage(request, reply, leagueId);
      if (!member) return;
      try {
        const body = outcomeBodySchema.parse(request.body);
        const result = await recordLeagueEntryTeamOutcome({
          teamId,
          leagueId,
          outcome: body.outcome,
          actorMemberId: member.id,
        });
        return reply.send(result);
      } catch (error) {
        if (handleLeagueEntryError(reply, error)) return;
        throw error;
      }
    }
  );
}
