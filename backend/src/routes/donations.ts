import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { optionalAuthMiddleware } from '../middleware/auth.js';
import { createPaymentService, PaymentServiceError } from '../services/paymentService.js';
import type { Member } from '../types.js';

const donationCheckoutSchema = z.object({
  amountMinor: z.coerce.number().int().min(100).max(5_000_000),
  donorName: z.string().trim().min(1).max(120).optional(),
  donorEmail: z.string().trim().email().max(320),
  message: z.string().trim().max(500).optional(),
});

const donationOrderParamsSchema = z.object({
  orderToken: z.string().trim().min(6).max(120),
});

const resolveDonationOrderSchema = z.object({
  sessionId: z.string().trim().min(3).max(255),
});

function frontendBaseUrl(): string {
  return config.frontendUrl.replace(/\/+$/, '');
}

function handlePaymentServiceError(error: unknown): { status: number; body: { error: string } } | null {
  if (error instanceof PaymentServiceError) {
    return {
      status: error.statusCode,
      body: { error: error.message },
    };
  }
  return null;
}

function metadataString(metadata: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export async function donationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: unknown }>(
    '/public/donations/checkout',
    {
      preHandler: optionalAuthMiddleware,
      schema: {
        tags: ['payments'],
      },
    },
    async (request, reply) => {
      const parsed = donationCheckoutSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid donation request', details: parsed.error.flatten() });
      }

      const payload = parsed.data;
      const member = (request as { member?: Member }).member;
      const donationMetadata: Record<string, unknown> = {
        source: 'public_donation',
      };
      if (payload.donorName) donationMetadata.donorName = payload.donorName;
      donationMetadata.donorEmail = payload.donorEmail;
      if (payload.message) donationMetadata.message = payload.message;

      const paymentService = createPaymentService();
      try {
        const order = await paymentService.createPaymentOrder({
          provider: 'stripe',
          subjectType: 'donation',
          amountMinor: payload.amountMinor,
          currency: 'usd',
          metadata: donationMetadata,
          createdByMemberId: member?.id ?? null,
        });

        const orderTokenEncoded = encodeURIComponent(order.orderToken);
        const successUrl = `${frontendBaseUrl()}/donate/success?orderToken=${orderTokenEncoded}&session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${frontendBaseUrl()}/donate/cancel?orderToken=${orderTokenEncoded}`;

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
        const handled = handlePaymentServiceError(error);
        if (handled) {
          return reply.code(handled.status).send(handled.body);
        }
        request.log.error({ err: error }, 'Failed to create public donation checkout session');
        return reply.code(500).send({ error: 'Unable to start donation checkout' });
      }
    }
  );

  fastify.get<{ Params: { orderToken: string } }>(
    '/public/donations/orders/:orderToken',
    {
      schema: {
        tags: ['payments'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            orderToken: { type: 'string' },
          },
          required: ['orderToken'],
        },
      },
    },
    async (request, reply) => {
      const parsedParams = donationOrderParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: 'Invalid order token' });
      }

      const paymentService = createPaymentService();
      try {
        const order = await paymentService.getPaymentOrderByToken(parsedParams.data.orderToken);
        if (!order || order.subjectType !== 'donation') {
          return reply.code(404).send({ error: 'Donation order not found' });
        }

        return {
          order: {
            id: order.id,
            donationReference: `DON-${String(order.id).padStart(6, '0')}`,
            provider: order.provider,
            amountMinor: order.amountMinor,
            currency: order.currency,
            status: order.status,
            statusReason: order.statusReason,
            createdAt: order.createdAt,
            completedAt: order.completedAt,
            donorName: metadataString(order.metadata, 'donorName', 'donor_name'),
            donorEmail: metadataString(order.metadata, 'donorEmail', 'donor_email'),
          },
        };
      } catch (error) {
        const handled = handlePaymentServiceError(error);
        if (handled) {
          return reply.code(handled.status).send(handled.body);
        }
        request.log.error({ err: error }, 'Failed to fetch public donation order');
        return reply.code(500).send({ error: 'Unable to load donation order' });
      }
    }
  );

  fastify.post<{ Params: { orderToken: string }; Body: unknown }>(
    '/public/donations/orders/:orderToken/resolve',
    {
      schema: {
        tags: ['payments'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            orderToken: { type: 'string' },
          },
          required: ['orderToken'],
        },
      },
    },
    async (request, reply) => {
      const parsedParams = donationOrderParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: 'Invalid order token' });
      }
      const parsedBody = resolveDonationOrderSchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        return reply.code(400).send({ error: 'Invalid checkout session id' });
      }

      const paymentService = createPaymentService();
      try {
        const reconciliation = await paymentService.reconcilePaymentOrderByToken(
          parsedParams.data.orderToken,
          parsedBody.data.sessionId,
          'checkout-return'
        );
        const order = await paymentService.getPaymentOrderByToken(parsedParams.data.orderToken);
        if (!order || order.subjectType !== 'donation') {
          return reply.code(404).send({ error: 'Donation order not found' });
        }

        return {
          reconciliation,
          order: {
            id: order.id,
            donationReference: `DON-${String(order.id).padStart(6, '0')}`,
            provider: order.provider,
            amountMinor: order.amountMinor,
            currency: order.currency,
            status: order.status,
            statusReason: order.statusReason,
            createdAt: order.createdAt,
            completedAt: order.completedAt,
            donorName: metadataString(order.metadata, 'donorName', 'donor_name'),
            donorEmail: metadataString(order.metadata, 'donorEmail', 'donor_email'),
          },
        };
      } catch (error) {
        const handled = handlePaymentServiceError(error);
        if (handled) {
          return reply.code(handled.status).send(handled.body);
        }
        request.log.error({ err: error }, 'Failed to resolve donation order from checkout return');
        return reply.code(500).send({ error: 'Unable to resolve donation order' });
      }
    }
  );
}
