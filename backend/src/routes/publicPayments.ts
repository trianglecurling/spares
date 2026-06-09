import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { memberPaymentDetailSchema } from '../api/schemas.js';
import type { ApiErrorResponse, MemberPaymentDetail } from '../api/types.js';
import { getPaymentDetailByOrderToken } from '../services/memberPaymentHistoryService.js';

const orderTokenParamsSchema = z.object({
  orderToken: z.string().uuid(),
});

export async function publicPaymentRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{
    Params: { orderToken: string };
    Reply: MemberPaymentDetail | ApiErrorResponse;
  }>(
    '/public/payments/:orderToken',
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
        response: {
          200: memberPaymentDetailSchema,
        },
      },
    },
    async (request, reply) => {
      const params = orderTokenParamsSchema.parse(request.params);
      const detail = await getPaymentDetailByOrderToken(params.orderToken);
      if (!detail) {
        return reply.code(404).send({ error: 'Payment not found' });
      }
      return detail;
    }
  );
}
