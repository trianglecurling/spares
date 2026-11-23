import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendApiError, sendValidationError } from '../api/errors.js';
import { optionalAuthMiddleware } from '../middleware/auth.js';
import {
  DonationCollectionServiceError,
  createDonationCollection,
  exportDonationCollectionDonorsCsv,
  getDonationCollectionForMember,
  getDonationCollectionCheckoutContext,
  getPublicDonationCollection,
  listDonationCollectionDonors,
  listDonationCollectionsForMember,
  memberCanManageDonationCollection,
  updateDonationCollection,
} from '../services/donationCollectionService.js';
import {
  buildCheckoutSuccessUrl,
  createPaymentService,
  getDefaultPaymentProvider,
  PaymentServiceError,
} from '../services/paymentService.js';
import { DONATION_COLLECTION_SOURCE, normalizeDonorPhone } from '../utils/donationCollections.js';
import { resolveFrontendBaseUrl } from '../utils/frontendUrl.js';
import type { Member } from '../types.js';

const collectionBodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().max(120).nullable().optional(),
  causeName: z.string().trim().min(1).max(160),
  description: z.string().max(100_000).nullable().optional(),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  minimumAmountMinor: z.number().int().min(100).max(5_000_000),
  managerIds: z.array(z.number().int().positive()).max(50),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const slugParamSchema = z.object({
  slug: z.string().trim().min(1).max(120),
});

const checkoutBodySchema = z.object({
  amountMinor: z.coerce.number().int().min(100).max(5_000_000),
  donorName: z.string().trim().min(1).max(120),
  donorEmail: z.string().trim().email().max(320),
  donorPhone: z.string().trim().min(1).max(40),
});

function memberFrom(request: FastifyRequest): Member | null {
  return (request as { member?: Member }).member ?? null;
}

function handleServiceError(reply: FastifyReply, error: unknown) {
  if (error instanceof DonationCollectionServiceError) {
    return sendApiError(reply, error.statusCode, error.message);
  }
  if (error instanceof PaymentServiceError) {
    return sendApiError(reply, error.statusCode, error.message);
  }
  throw error;
}

export async function publicDonationCollectionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { slug: string } }>(
    '/public/donation-collections/:slug',
    {
      schema: { tags: ['donations'] },
    },
    async (request, reply) => {
      const parsed = slugParamSchema.safeParse(request.params);
      if (!parsed.success) return sendValidationError(reply, 'Invalid donation collection', parsed.error.flatten());
      const collection = await getPublicDonationCollection(parsed.data.slug);
      if (!collection) return sendApiError(reply, 404, 'Donation collection not found');
      return { collection };
    }
  );

  fastify.post<{ Params: { slug: string }; Body: unknown }>(
    '/public/donation-collections/:slug/checkout',
    {
      preHandler: optionalAuthMiddleware,
      schema: { tags: ['donations'] },
    },
    async (request, reply) => {
      const parsedParams = slugParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return sendValidationError(reply, 'Invalid donation collection', parsedParams.error.flatten());
      }
      const parsedBody = checkoutBodySchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        return sendValidationError(reply, 'Invalid donation request', parsedBody.error.flatten());
      }
      const phone = normalizeDonorPhone(parsedBody.data.donorPhone);
      if (!phone) return sendApiError(reply, 400, 'Enter a valid phone number.');

      try {
        const collection = await getDonationCollectionCheckoutContext(parsedParams.data.slug);
        if (!collection) return sendApiError(reply, 404, 'Donation collection not found');
        if (collection.status === 'upcoming') {
          return sendApiError(reply, 409, 'This donation collection has not started yet.');
        }
        if (collection.status === 'ended') {
          return sendApiError(reply, 409, 'This donation collection has ended.');
        }
        if (parsedBody.data.amountMinor < collection.minimumAmountMinor) {
          return sendApiError(reply, 400, 'This donation is below the minimum amount.');
        }

        const member = memberFrom(request);
        const paymentService = createPaymentService();
        const paymentProvider = getDefaultPaymentProvider();
        const order = await paymentService.createPaymentOrder({
          provider: paymentProvider,
          subjectType: 'donation',
          subjectId: collection.id,
          amountMinor: parsedBody.data.amountMinor,
          currency: 'usd',
          createdByMemberId: member?.id ?? null,
          metadata: {
            source: DONATION_COLLECTION_SOURCE,
            donationCollectionId: collection.id,
            donationCollectionSlug: collection.slug,
            donationCollectionName: collection.name,
            causeName: collection.causeName,
            donorName: parsedBody.data.donorName,
            donorEmail: parsedBody.data.donorEmail,
            donorPhone: phone,
            ...(collection.paymentItemName ? { paymentItemName: collection.paymentItemName } : {}),
          },
        });

        const frontendBaseUrl = resolveFrontendBaseUrl(request);
        const orderTokenEncoded = encodeURIComponent(order.orderToken);
        const slugEncoded = encodeURIComponent(collection.slug);
        const successUrl = buildCheckoutSuccessUrl(
          `${frontendBaseUrl}/donations/${slugEncoded}/success?orderToken=${orderTokenEncoded}`,
          paymentProvider
        );
        const cancelUrl = `${frontendBaseUrl}/donations/${slugEncoded}/cancel?orderToken=${orderTokenEncoded}`;
        const checkout = await paymentService.createHostedCheckoutForOrder({
          orderId: order.id,
          successUrl,
          cancelUrl,
        });
        return {
          orderId: order.id,
          orderToken: order.orderToken,
          status: checkout.status,
          checkoutUrl: checkout.checkoutUrl,
          expiresAt: checkout.expiresAt,
        };
      } catch (error) {
        request.log.error({ err: error }, 'Failed to create donation collection checkout');
        return handleServiceError(reply, error);
      }
    }
  );
}

export async function protectedDonationCollectionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/donation-collections', { schema: { tags: ['donations'] } }, async (request, reply) => {
    const member = memberFrom(request);
    if (!member) return sendApiError(reply, 401, 'Unauthorized');
    try {
      const collections = await listDonationCollectionsForMember(member);
      return { collections };
    } catch (error) {
      return handleServiceError(reply, error);
    }
  });

  fastify.post<{ Body: unknown }>(
    '/donation-collections',
    { schema: { tags: ['donations'] } },
    async (request, reply) => {
      const member = memberFrom(request);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const parsed = collectionBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) return sendValidationError(reply, 'Invalid donation collection', parsed.error.flatten());
      try {
        const collection = await createDonationCollection(member, parsed.data);
        return reply.code(201).send({ collection });
      } catch (error) {
        return handleServiceError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/donation-collections/:id/management-access',
    { schema: { tags: ['donations'] } },
    async (request, reply) => {
      const member = memberFrom(request);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) return sendValidationError(reply, 'Invalid donation collection', parsed.error.flatten());
      const allowed = await memberCanManageDonationCollection(member, parsed.data.id);
      if (!allowed) return sendApiError(reply, 403, 'Forbidden');
      return { ok: true };
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/donation-collections/:id',
    { schema: { tags: ['donations'] } },
    async (request, reply) => {
      const member = memberFrom(request);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) return sendValidationError(reply, 'Invalid donation collection', parsed.error.flatten());
      try {
        const collection = await getDonationCollectionForMember(member, parsed.data.id);
        return { collection };
      } catch (error) {
        return handleServiceError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: string }; Body: unknown }>(
    '/donation-collections/:id',
    { schema: { tags: ['donations'] } },
    async (request, reply) => {
      const member = memberFrom(request);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const parsedParams = idParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return sendValidationError(reply, 'Invalid donation collection', parsedParams.error.flatten());
      }
      const parsedBody = collectionBodySchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        return sendValidationError(reply, 'Invalid donation collection', parsedBody.error.flatten());
      }
      try {
        const collection = await updateDonationCollection(member, parsedParams.data.id, parsedBody.data);
        return { collection };
      } catch (error) {
        return handleServiceError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/donation-collections/:id/donors',
    { schema: { tags: ['donations'] } },
    async (request, reply) => {
      const member = memberFrom(request);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) return sendValidationError(reply, 'Invalid donation collection', parsed.error.flatten());
      try {
        return await listDonationCollectionDonors(member, parsed.data.id);
      } catch (error) {
        return handleServiceError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/donation-collections/:id/donors/export',
    { schema: { tags: ['donations'] } },
    async (request, reply) => {
      const member = memberFrom(request);
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) return sendValidationError(reply, 'Invalid donation collection', parsed.error.flatten());
      try {
        const result = await exportDonationCollectionDonorsCsv(member, parsed.data.id);
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${result.filename}"`)
          .send(result.csv);
      } catch (error) {
        return handleServiceError(reply, error);
      }
    }
  );
}
