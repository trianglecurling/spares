import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendApiError, sendValidationError } from '../api/errors.js';
import {
  cancelPublicSignupByAccessToken,
  getPublicProgram,
  getPublicSignupByAccessToken,
  signUpPublicGuest,
} from '../services/volunteeringService.js';
import { VolunteeringServiceError } from '../services/volunteeringServiceError.js';

async function handleServiceError(reply: any, err: unknown) {
  if (err instanceof VolunteeringServiceError) {
    return sendApiError(reply, err.statusCode, err.message);
  }
  throw err;
}

const publicSignupBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  comments: z.string().max(2000).nullable().optional(),
});

export async function publicVolunteeringRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { slug: string } }>(
    '/public/volunteering/programs/:slug',
    { schema: { tags: ['public-volunteering'] } },
    async (request, reply) => {
      const slug = request.params.slug?.trim();
      if (!slug) return sendApiError(reply, 400, 'Invalid program slug');
      try {
        return { program: await getPublicProgram(slug) };
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/public/volunteering/shift-roles/:id/signups',
    { schema: { tags: ['public-volunteering'] } },
    async (request, reply) => {
      const shiftRoleId = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(shiftRoleId)) return sendApiError(reply, 400, 'Invalid shift role id');
      const parsed = publicSignupBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid signup data', parsed.error.flatten());
      }
      try {
        const result = await signUpPublicGuest(shiftRoleId, parsed.data);
        return reply.code(201).send(result);
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.get<{ Params: { accessToken: string } }>(
    '/public/volunteering/signups/manage/:accessToken',
    { schema: { tags: ['public-volunteering'] } },
    async (request, reply) => {
      try {
        return { signup: await getPublicSignupByAccessToken(request.params.accessToken) };
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );

  fastify.post<{ Params: { accessToken: string } }>(
    '/public/volunteering/signups/manage/:accessToken/cancel',
    { schema: { tags: ['public-volunteering'] } },
    async (request, reply) => {
      try {
        await cancelPublicSignupByAccessToken(request.params.accessToken);
        return { ok: true };
      } catch (err) {
        return handleServiceError(reply, err);
      }
    }
  );
}
