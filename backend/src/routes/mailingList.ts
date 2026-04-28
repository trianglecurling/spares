import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendApiError } from '../api/errors.js';
import {
  isMauticSubscribeAvailableForList,
  MauticRequestError,
  subscribeToMailingList,
} from '../services/mauticService.js';

const subscribeSchema = z.object({
  list: z.enum(['bonspiels', 'membership', 'learn-to-curl']),
  fullName: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(320),
  /** Honeypot — must be empty; if filled, we return success without calling Mautic */
  website: z.string().optional(),
});

export async function mailingListRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: unknown }>(
    '/public/mailing-list/subscribe',
    {
      schema: {
        tags: ['public'],
        description: 'Subscribe an email to a Mautic segment (public mailing list).',
      },
    },
    async (request, reply) => {
      const parsed = subscribeSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
      }

      const payload = parsed.data;
      if (!isMauticSubscribeAvailableForList(payload.list)) {
        return sendApiError(reply, 503, 'Mailing list sign-up is not available right now.');
      }
      if (payload.website && payload.website.trim().length > 0) {
        return { ok: true };
      }

      try {
        await subscribeToMailingList({
          list: payload.list,
          fullName: payload.fullName,
          email: payload.email,
        });
        return { ok: true };
      } catch (error) {
        if (error instanceof MauticRequestError) {
          request.log.error(
            { err: error, statusCode: error.statusCode, body: error.responseBody },
            'Mautic mailing list subscribe failed'
          );
          return sendApiError(
            reply,
            502,
            'We could not complete your sign-up. Please try again in a few minutes.'
          );
        }
        request.log.error({ err: error }, 'Mailing list subscribe failed');
        return sendApiError(reply, 500, 'Something went wrong. Please try again later.');
      }
    }
  );
}
