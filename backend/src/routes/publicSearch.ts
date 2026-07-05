import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { sendApiError } from '../api/errors.js';
import {
  normalizeSearchLimit,
  searchPublicContent,
  validateSearchQuery,
} from '../search/searchIndexService.js';

export async function publicSearchRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(
    async (searchScope) => {
      await searchScope.register(rateLimit, {
        max: 30,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
          error: 'Too many search requests. Please wait a moment and try again.',
        }),
      });

      searchScope.get<{ Querystring: { q?: string; limit?: string } }>(
        '/public/search',
        {
          schema: {
            tags: ['public'],
            querystring: {
              type: 'object',
              required: ['q'],
              properties: {
                q: { type: 'string', minLength: 2, maxLength: 100 },
                limit: { type: 'string' },
              },
            },
            response: {
              200: {
                type: 'object',
                properties: {
                  results: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', enum: ['article', 'event', 'page'] },
                        title: { type: 'string' },
                        url: { type: 'string' },
                        snippet: { type: 'string' },
                        score: { type: 'number' },
                        matchedTerms: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                      },
                      required: ['type', 'title', 'url', 'snippet', 'score', 'matchedTerms'],
                    },
                  },
                  total: { type: 'number' },
                },
                required: ['results', 'total'],
              },
              400: {
                type: 'object',
                properties: {
                  error: { type: 'string' },
                },
                required: ['error'],
              },
              429: {
                type: 'object',
                properties: {
                  error: { type: 'string' },
                },
                required: ['error'],
              },
            },
          },
        },
        async (request, reply) => {
          const rawQuery = request.query.q ?? '';
          const validation = validateSearchQuery(rawQuery);
          if (!validation.ok) {
            return sendApiError(reply, 400, validation.error);
          }

          const parsedLimit = request.query.limit != null ? Number.parseInt(request.query.limit, 10) : undefined;
          if (request.query.limit != null && Number.isNaN(parsedLimit)) {
            return sendApiError(reply, 400, 'Invalid limit');
          }

          const limit = normalizeSearchLimit(parsedLimit);
          return searchPublicContent(validation.query, limit);
        },
      );
    },
    { prefix: '/api' },
  );
}
