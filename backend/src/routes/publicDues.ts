import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendApiError } from '../api/errors.js';
import type { ApiErrorResponse } from '../api/types.js';
import {
  estimateAnnualDues,
  getPublicDuesSchedule,
  type DuesEstimateInput,
} from '../registration/duesEstimatorService.js';

const apiErrorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    error: { type: 'string' },
    details: { type: 'object', additionalProperties: true },
  },
  required: ['error'],
} as const;

const anyObjectSchema = {
  type: 'object',
  additionalProperties: true,
} as const;

const sessionSelectionSchema = z.object({
  membershipType: z.enum(['none', 'regular', 'social', 'junior_recreational']),
  iceTime: z.enum(['none', 'spare_only', '1_league', '2_leagues', '3_leagues']),
});

const estimateBodySchema = z.object({
  fall: sessionSelectionSchema,
  winter: sessionSelectionSchema,
  studentDiscount: z.boolean(),
  reciprocalDiscount: z.boolean(),
});

export async function publicDuesRoutes(fastify: FastifyInstance) {
  fastify.get<{ Reply: unknown | ApiErrorResponse }>(
    '/public/dues',
    {
      schema: {
        tags: ['public'],
        response: { 200: anyObjectSchema, 404: apiErrorResponseSchema },
      },
    },
    async (_request, reply) => {
      const schedule = await getPublicDuesSchedule();
      if (!schedule) return sendApiError(reply, 404, 'Dues schedule is not available.');
      return schedule;
    },
  );

  fastify.post<{ Body: DuesEstimateInput; Reply: unknown | ApiErrorResponse }>(
    '/public/dues/estimate',
    {
      schema: {
        tags: ['public'],
        body: anyObjectSchema,
        response: { 200: anyObjectSchema, 404: apiErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const body = estimateBodySchema.parse(request.body);
      const estimate = await estimateAnnualDues(body);
      if (!estimate) return sendApiError(reply, 404, 'Dues estimate is not available.');
      return estimate;
    },
  );
}
