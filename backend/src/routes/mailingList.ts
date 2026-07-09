import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendApiError } from '../api/errors.js';
import {
  getMailingListBySlug,
  getPublicMailingListBySlug,
} from '../domains/content/mailingLists.js';
import { sendMailingListSignupCommentEmail } from '../services/email.js';
import {
  isMauticSubscribeAvailableForSegment,
  MauticRequestError,
  sendMauticEmailToContact,
  subscribeToMailingListSegment,
} from '../services/mauticService.js';

const mailingListSlugSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/);

const subscribeSchema = z.object({
  list: mailingListSlugSchema,
  fullName: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(320),
  comments: z.string().trim().max(4000).optional(),
  /** Honeypot — must be empty; if filled, we return success without calling Mautic */
  website: z.string().optional(),
});

export async function mailingListRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { slug: string } }>(
    '/public/mailing-lists/:slug',
    {
      schema: {
        tags: ['public'],
        description: 'Public mailing list page metadata by slug.',
      },
    },
    async (request, reply) => {
      const slug = request.params.slug.trim().toLowerCase();
      if (!mailingListSlugSchema.safeParse(slug).success) {
        return reply.code(404).send({ error: 'Mailing list not found' });
      }
      const row = await getPublicMailingListBySlug(slug);
      if (!row) {
        return reply.code(404).send({ error: 'Mailing list not found' });
      }
      return row;
    },
  );

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
      const list = await getMailingListBySlug(payload.list.trim().toLowerCase());
      if (!list) {
        return reply.code(400).send({ error: 'Invalid mailing list' });
      }
      if (!isMauticSubscribeAvailableForSegment(list.mauticSegmentId)) {
        return sendApiError(reply, 503, 'Mailing list sign-up is not available right now.');
      }
      if (payload.website && payload.website.trim().length > 0) {
        return { ok: true };
      }

      const comments = payload.comments?.trim() ?? '';
      if (comments && !list.includeQuestionsComments) {
        return reply.code(400).send({ error: 'Comments are not accepted for this mailing list.' });
      }

      try {
        const subscribeResult = await subscribeToMailingListSegment({
          segmentId: list.mauticSegmentId,
          fullName: payload.fullName,
          email: payload.email,
        });

        const welcomeEmailId = list.mauticWelcomeEmailId;
        if (
          subscribeResult.newlyAddedToSegment &&
          welcomeEmailId != null &&
          welcomeEmailId > 0
        ) {
          try {
            await sendMauticEmailToContact(welcomeEmailId, subscribeResult.contactId);
          } catch (error) {
            request.log.error(
              { err: error, listSlug: list.slug, welcomeEmailId },
              'Mautic welcome email failed',
            );
          }
        }

        if (comments) {
          const recipientEmail = list.commentsRecipientEmail?.trim();
          if (!recipientEmail) {
            request.log.error(
              { listSlug: list.slug },
              'Mailing list comment email skipped because no recipient is configured',
            );
          } else {
            try {
              await sendMailingListSignupCommentEmail({
                recipientEmail,
                listName: list.name,
                subscriberName: payload.fullName,
                subscriberEmail: payload.email,
                comments,
              });
            } catch (error) {
              request.log.error({ err: error, listSlug: list.slug }, 'Mailing list comment email failed');
            }
          }
        }

        return { ok: true };
      } catch (error) {
        if (error instanceof MauticRequestError) {
          request.log.error(
            { err: error, statusCode: error.statusCode, body: error.responseBody },
            'Mautic mailing list subscribe failed',
          );
          return sendApiError(
            reply,
            502,
            'We could not complete your sign-up. Please try again in a few minutes.',
          );
        }
        request.log.error({ err: error }, 'Mailing list subscribe failed');
        return sendApiError(reply, 500, 'Something went wrong. Please try again later.');
      }
    },
  );
}
