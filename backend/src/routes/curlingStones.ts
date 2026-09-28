import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  curlingStoneActivityResponseSchema,
  curlingStoneCreateBodySchema,
  curlingStoneDetailResponseSchema,
  curlingStoneFlipBodySchema,
  curlingStoneIdParamsSchema,
  curlingStoneImportBodySchema,
  curlingStoneImportResponseSchema,
  curlingStoneListResponseSchema,
  curlingStoneMaintenanceCreateBodySchema,
  curlingStoneMaintenanceCreateResponseSchema,
  curlingStoneMaintenanceUpdateBodySchema,
  curlingStoneMoveBodySchema,
  curlingStonePlacementChangeResponseSchema,
  curlingStonePlacementUpdateBodySchema,
  curlingStoneRotateBodySchema,
  curlingStoneRotateResponseSchema,
  curlingStoneUpdateBodySchema,
} from '../api/curlingStoneSchemas.js';
import { sendApiError, sendValidationError } from '../api/errors.js';
import { successResponseSchema } from '../api/schemas.js';
import {
  CurlingStoneError,
  createCurlingStone,
  createCurlingStoneMaintenance,
  deleteCurlingStone,
  deleteCurlingStoneMaintenance,
  flipCurlingStone,
  getCurlingStoneDetail,
  importCurlingStones,
  listCurlingStoneActivity,
  listCurlingStones,
  moveCurlingStone,
  rotateCurlingStones,
  undoCurlingStonePlacement,
  updateCurlingStone,
  updateCurlingStoneMaintenance,
  updateCurlingStonePlacement,
} from '../domains/facility/curlingStones.js';
import {
  ROCKS_PER_COLOR,
  STONE_COLORS,
  STONE_SHEETS,
  STONE_SIDES,
  isDateOnly,
} from '../domains/facility/curlingStonePositions.js';
import { oneYearBefore } from '../domains/facility/curlingStoneActivity.js';
import { config } from '../config.js';
import type { Member } from '../types.js';
import { formatDateInTimeZone } from '../utils/timeZone.js';
import { hasClubLeagueAdministratorAccess } from '../utils/leagueAccess.js';

const dateOnly = z.string().refine(isDateOnly, 'Enter a valid date.');
const notes = z.string().max(2000).nullable().optional();
const positionFields = {
  sheet: z.enum(STONE_SHEETS).nullable(),
  color: z.enum(STONE_COLORS).nullable(),
  rockNumber: z.number().int().min(1).max(ROCKS_PER_COLOR).nullable(),
};
const identifierFields = {
  wcfRegistrationNumber: z.string().trim().min(1, 'WCF registration number is required.').max(100),
  alSerialNumber: z.string().trim().min(1, 'AL serial number is required.').max(100),
};

const createBody = z.object({
  ...identifierFields,
  ...positionFields,
  notes,
  side: z.enum(STONE_SIDES),
  effectiveDate: dateOnly,
});

const importBody = z.object({
  effectiveDate: dateOnly,
  side: z.enum(STONE_SIDES),
  rows: z
    .array(z.object({ ...identifierFields, ...positionFields }))
    .min(1)
    .max(200),
});

const updateBody = z.object({ ...identifierFields, notes: z.string().max(2000).nullable() });
const moveBody = z.object({ ...positionFields, effectiveDate: dateOnly, notes });
const flipBody = z.object({ effectiveDate: dateOnly, notes });
const rotateBody = z.object({ effectiveDate: dateOnly });
const placementUpdateBody = z.object({ effectiveDate: dateOnly, notes });

const maintenanceFields = {
  activityType: z.enum(['texturing', 'band_narrowing', 'imprinting']),
  performedOn: dateOnly,
  passes: z.number().int().min(0).max(1000).nullable().optional(),
  rotations: z.number().int().min(0).max(1000).nullable().optional(),
  sandpaperGrit: z.number().int().min(1).max(10000).nullable().optional(),
  bandWidthsMm: z.array(z.number().min(0).max(100).nullable()).length(4).nullable().optional(),
  comments: z.string().max(2000).nullable().optional(),
};
const maintenanceCreateBody = z.object({
  ...maintenanceFields,
  stoneIds: z.array(z.number().int().positive()).min(1).max(200),
  side: z.enum(['A', 'B', 'current']),
});
const maintenanceUpdateBody = z.object({ ...maintenanceFields, side: z.enum(STONE_SIDES) });

function parseId(request: FastifyRequest): number | null {
  const raw = (request.params as { id?: string }).id ?? '';
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function handleStoneError(reply: FastifyReply, error: unknown) {
  if (error instanceof CurlingStoneError) {
    return sendApiError(reply, error.statusCode, error.message, error.details);
  }
  throw error;
}

async function requireStoneManager(request: FastifyRequest, reply: FastifyReply): Promise<Member | null> {
  const member = request.member;
  if (!member) {
    await sendApiError(reply, 401, 'Unauthorized');
    return null;
  }
  if (!(await hasClubLeagueAdministratorAccess(member))) {
    await sendApiError(reply, 403, 'Forbidden');
    return null;
  }
  return member;
}

export async function publicCurlingStoneRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/public/stones',
    {
      schema: {
        tags: ['curling-stones'],
        response: { 200: curlingStoneListResponseSchema },
      },
    },
    async () => ({ stones: await listCurlingStones() }),
  );

  fastify.get(
    '/public/stones/activity',
    {
      schema: {
        tags: ['curling-stones'],
        response: { 200: curlingStoneActivityResponseSchema },
      },
    },
    async () => {
      const today =
        formatDateInTimeZone(new Date(), config.timeZone || 'America/New_York') ??
        new Date().toISOString().slice(0, 10);
      const since = oneYearBefore(today);
      return { since, entries: await listCurlingStoneActivity(since) };
    },
  );

  fastify.get(
    '/public/stones/:id',
    {
      schema: {
        tags: ['curling-stones'],
        params: curlingStoneIdParamsSchema,
        response: { 200: curlingStoneDetailResponseSchema },
      },
    },
    async (request, reply) => {
      const id = parseId(request);
      if (id == null) return sendApiError(reply, 400, 'Invalid stone id');
      try {
        return await getCurlingStoneDetail(id);
      } catch (error) {
        return handleStoneError(reply, error);
      }
    },
  );
}

export async function protectedCurlingStoneRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/stones',
    {
      schema: {
        tags: ['curling-stones'],
        body: curlingStoneCreateBodySchema,
        response: { 200: curlingStoneDetailResponseSchema },
      },
    },
    async (request, reply) => {
      const member = await requireStoneManager(request, reply);
      if (!member) return reply;
      const parsed = createBody.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid stone details', parsed.error.flatten());
      try {
        const id = await createCurlingStone(parsed.data, member.id);
        return await getCurlingStoneDetail(id);
      } catch (error) {
        return handleStoneError(reply, error);
      }
    },
  );

  fastify.post(
    '/stones/import',
    {
      schema: {
        tags: ['curling-stones'],
        body: curlingStoneImportBodySchema,
        response: { 200: curlingStoneImportResponseSchema },
      },
    },
    async (request, reply) => {
      const member = await requireStoneManager(request, reply);
      if (!member) return reply;
      const parsed = importBody.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid stone import', parsed.error.flatten());
      try {
        return { created: await importCurlingStones(parsed.data, member.id) };
      } catch (error) {
        return handleStoneError(reply, error);
      }
    },
  );

  fastify.post(
    '/stones/rotate',
    {
      schema: {
        tags: ['curling-stones'],
        body: curlingStoneRotateBodySchema,
        response: { 200: curlingStoneRotateResponseSchema },
      },
    },
    async (request, reply) => {
      const member = await requireStoneManager(request, reply);
      if (!member) return reply;
      const parsed = rotateBody.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid rotation', parsed.error.flatten());
      try {
        return { moved: await rotateCurlingStones(parsed.data, member.id) };
      } catch (error) {
        return handleStoneError(reply, error);
      }
    },
  );

  fastify.post(
    '/stones/maintenance',
    {
      schema: {
        tags: ['curling-stones'],
        body: curlingStoneMaintenanceCreateBodySchema,
        response: { 200: curlingStoneMaintenanceCreateResponseSchema },
      },
    },
    async (request, reply) => {
      const member = await requireStoneManager(request, reply);
      if (!member) return reply;
      const parsed = maintenanceCreateBody.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid maintenance details', parsed.error.flatten());
      try {
        return { created: await createCurlingStoneMaintenance(parsed.data, member.id) };
      } catch (error) {
        return handleStoneError(reply, error);
      }
    },
  );

  fastify.patch(
    '/stones/maintenance/:id',
    {
      schema: {
        tags: ['curling-stones'],
        params: curlingStoneIdParamsSchema,
        body: curlingStoneMaintenanceUpdateBodySchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request, reply) => {
      const member = await requireStoneManager(request, reply);
      if (!member) return reply;
      const id = parseId(request);
      if (id == null) return sendApiError(reply, 400, 'Invalid maintenance record id');
      const parsed = maintenanceUpdateBody.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid maintenance details', parsed.error.flatten());
      try {
        await updateCurlingStoneMaintenance(id, parsed.data);
        return { success: true };
      } catch (error) {
        return handleStoneError(reply, error);
      }
    },
  );

  fastify.delete(
    '/stones/maintenance/:id',
    {
      schema: {
        tags: ['curling-stones'],
        params: curlingStoneIdParamsSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request, reply) => {
      const member = await requireStoneManager(request, reply);
      if (!member) return reply;
      const id = parseId(request);
      if (id == null) return sendApiError(reply, 400, 'Invalid maintenance record id');
      try {
        await deleteCurlingStoneMaintenance(id);
        return { success: true };
      } catch (error) {
        return handleStoneError(reply, error);
      }
    },
  );

  fastify.patch(
    '/stones/placements/:id',
    {
      schema: {
        tags: ['curling-stones'],
        params: curlingStoneIdParamsSchema,
        body: curlingStonePlacementUpdateBodySchema,
        response: { 200: curlingStonePlacementChangeResponseSchema },
      },
    },
    async (request, reply) => {
      const member = await requireStoneManager(request, reply);
      if (!member) return reply;
      const id = parseId(request);
      if (id == null) return sendApiError(reply, 400, 'Invalid position history entry id');
      const parsed = placementUpdateBody.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid position history entry', parsed.error.flatten());
      try {
        return { affected: await updateCurlingStonePlacement(id, parsed.data) };
      } catch (error) {
        return handleStoneError(reply, error);
      }
    },
  );

  fastify.delete(
    '/stones/placements/:id',
    {
      schema: {
        tags: ['curling-stones'],
        params: curlingStoneIdParamsSchema,
        response: { 200: curlingStonePlacementChangeResponseSchema },
      },
    },
    async (request, reply) => {
      const member = await requireStoneManager(request, reply);
      if (!member) return reply;
      const id = parseId(request);
      if (id == null) return sendApiError(reply, 400, 'Invalid position history entry id');
      try {
        return { affected: await undoCurlingStonePlacement(id) };
      } catch (error) {
        return handleStoneError(reply, error);
      }
    },
  );

  fastify.patch(
    '/stones/:id',
    {
      schema: {
        tags: ['curling-stones'],
        params: curlingStoneIdParamsSchema,
        body: curlingStoneUpdateBodySchema,
        response: { 200: curlingStoneDetailResponseSchema },
      },
    },
    async (request, reply) => {
      const member = await requireStoneManager(request, reply);
      if (!member) return reply;
      const id = parseId(request);
      if (id == null) return sendApiError(reply, 400, 'Invalid stone id');
      const parsed = updateBody.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid stone details', parsed.error.flatten());
      try {
        await updateCurlingStone(id, parsed.data);
        return await getCurlingStoneDetail(id);
      } catch (error) {
        return handleStoneError(reply, error);
      }
    },
  );

  fastify.delete(
    '/stones/:id',
    {
      schema: {
        tags: ['curling-stones'],
        params: curlingStoneIdParamsSchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request, reply) => {
      const member = await requireStoneManager(request, reply);
      if (!member) return reply;
      const id = parseId(request);
      if (id == null) return sendApiError(reply, 400, 'Invalid stone id');
      try {
        await deleteCurlingStone(id);
        return { success: true };
      } catch (error) {
        return handleStoneError(reply, error);
      }
    },
  );

  fastify.post(
    '/stones/:id/move',
    {
      schema: {
        tags: ['curling-stones'],
        params: curlingStoneIdParamsSchema,
        body: curlingStoneMoveBodySchema,
        response: { 200: curlingStoneDetailResponseSchema },
      },
    },
    async (request, reply) => {
      const member = await requireStoneManager(request, reply);
      if (!member) return reply;
      const id = parseId(request);
      if (id == null) return sendApiError(reply, 400, 'Invalid stone id');
      const parsed = moveBody.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid stone move', parsed.error.flatten());
      try {
        await moveCurlingStone(id, parsed.data, member.id);
        return await getCurlingStoneDetail(id);
      } catch (error) {
        return handleStoneError(reply, error);
      }
    },
  );

  fastify.post(
    '/stones/:id/flip',
    {
      schema: {
        tags: ['curling-stones'],
        params: curlingStoneIdParamsSchema,
        body: curlingStoneFlipBodySchema,
        response: { 200: curlingStoneDetailResponseSchema },
      },
    },
    async (request, reply) => {
      const member = await requireStoneManager(request, reply);
      if (!member) return reply;
      const id = parseId(request);
      if (id == null) return sendApiError(reply, 400, 'Invalid stone id');
      const parsed = flipBody.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid stone flip', parsed.error.flatten());
      try {
        await flipCurlingStone(id, parsed.data, member.id);
        return await getCurlingStoneDetail(id);
      } catch (error) {
        return handleStoneError(reply, error);
      }
    },
  );
}
