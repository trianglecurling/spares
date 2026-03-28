import { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import {
  createPaymentService,
  normalizeRequestHeaders,
  PaymentProvider,
  PaymentServiceError,
  PaymentSignatureError,
} from '../services/paymentService.js';

function toPaymentProvider(value: string): PaymentProvider | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'stripe' || normalized === 'paypal' || normalized === 'square') {
    return normalized;
  }
  return null;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function paymentWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Params: { provider: string }; Body: unknown }>(
    '/payments/webhooks/:provider',
    {
      config: {
        rawBody: true,
      },
      schema: {
        tags: ['payments'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            provider: { type: 'string' },
          },
          required: ['provider'],
        },
      },
    },
    async (request, reply) => {
      const provider = toPaymentProvider(request.params.provider);
      if (!provider) {
        return reply.code(400).send({ error: 'Unsupported payment provider' });
      }

      const normalizedHeaders = normalizeRequestHeaders(
        request.headers as Record<string, string | string[] | undefined>
      );
      const rawBody =
        request.rawBody && (typeof request.rawBody === 'string' || Buffer.isBuffer(request.rawBody))
          ? request.rawBody
          : typeof request.body === 'string'
            ? request.body
            : JSON.stringify(request.body ?? {});
      const paymentService = createPaymentService();

      try {
        if (config.payment.webhookTestDelayMs > 0) {
          await sleep(config.payment.webhookTestDelayMs);
        }
        const result = await paymentService.processWebhook({
          provider,
          headers: normalizedHeaders,
          rawBody,
          parsedBody: request.body,
        });

        return reply.code(200).send({
          received: true,
          deduplicated: result.deduplicated,
          status: result.status,
          eventId: result.eventId,
          paymentOrderId: result.paymentOrderId,
        });
      } catch (error) {
        if (error instanceof PaymentSignatureError) {
          request.log.warn({ provider, message: error.message }, 'Payment webhook signature verification failed');
          return reply.code(401).send({ error: error.message });
        }
        if (error instanceof PaymentServiceError) {
          return reply.code(error.statusCode).send({ error: error.message });
        }

        request.log.error({ err: error }, 'Unhandled payment webhook processing error');
        return reply.code(500).send({ error: 'Failed to process payment webhook' });
      }
    }
  );
}
