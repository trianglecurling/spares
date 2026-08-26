import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendApiError, sendValidationError } from '../api/errors.js';
import type {
  ApiErrorResponse,
  OutboundEmailDetailResponse,
  OutboundEmailListResponse,
} from '../api/types.js';
import { isServerAdmin } from '../utils/auth.js';
import {
  getOutboundEmail,
  listOutboundEmails,
} from '../services/outboundEmailLogService.js';

const apiErrorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    error: { type: 'string' },
    details: {},
  },
  required: ['error'],
} as const;

const outboundEmailListItemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    recipientEmail: { type: 'string' },
    recipientName: { type: ['string', 'null'] },
    subject: { type: 'string' },
    createdAt: { type: 'string' },
  },
  required: ['id', 'recipientEmail', 'recipientName', 'subject', 'createdAt'],
} as const;

const outboundEmailListResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: outboundEmailListItemSchema },
    page: { type: 'number' },
    pageSize: { type: 'number' },
    total: { type: 'number' },
  },
  required: ['items', 'page', 'pageSize', 'total'],
} as const;

const outboundEmailDetailResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    recipientEmail: { type: 'string' },
    recipientName: { type: ['string', 'null'] },
    subject: { type: 'string' },
    createdAt: { type: 'string' },
    htmlBody: { type: 'string' },
    textBody: { type: ['string', 'null'] },
  },
  required: [
    'id',
    'recipientEmail',
    'recipientName',
    'subject',
    'createdAt',
    'htmlBody',
    'textBody',
  ],
} as const;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export async function observabilityEmailRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{
    Querystring: { page?: number; pageSize?: number };
    Reply: OutboundEmailListResponse | ApiErrorResponse;
  }>(
    '/observability/emails',
    {
      schema: {
        tags: ['observability'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'number' },
            pageSize: { type: 'number' },
          },
        },
        response: {
          200: outboundEmailListResponseSchema,
          400: apiErrorResponseSchema,
          403: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member || !isServerAdmin(member)) {
        return sendApiError(reply, 403, 'Forbidden');
      }
      const query = listQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return sendValidationError(reply, 'Validation failed', query.error.flatten().fieldErrors);
      }
      return listOutboundEmails({ page: query.data.page, pageSize: query.data.pageSize });
    }
  );

  fastify.get<{
    Params: { id: string };
    Reply: OutboundEmailDetailResponse | ApiErrorResponse;
  }>(
    '/observability/emails/:id',
    {
      schema: {
        tags: ['observability'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: outboundEmailDetailResponseSchema,
          400: apiErrorResponseSchema,
          403: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member || !isServerAdmin(member)) {
        return sendApiError(reply, 403, 'Forbidden');
      }
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return sendValidationError(reply, 'Validation failed', params.error.flatten().fieldErrors);
      }
      const email = await getOutboundEmail(params.data.id);
      if (!email) {
        return sendApiError(reply, 404, 'Email not found');
      }
      return email;
    }
  );
}
