import type { FastifyInstance } from 'fastify';
import { teamCatalogErrorSchema, teamCatalogResponseSchema } from '../api/teamCatalogSchemas.js';
import { sendApiError } from '../api/errors.js';
import type { ApiErrorResponse } from '../api/types.js';
import { getTeamCatalog, type TeamCatalogResponse } from '../services/teamCatalogService.js';
import { hasScope } from '../utils/rbac.js';

type ApiReply<T> = T | ApiErrorResponse;

export async function teamCatalogRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Reply: ApiReply<TeamCatalogResponse> }>(
    '/teams',
    {
      schema: {
        tags: ['teams'],
        summary: 'List current league and bonspiel teams',
        description:
          'Returns defined teams for leagues and bonspiels that have not concluded. Requires the teams.read scope.',
        response: {
          200: teamCatalogResponseSchema,
          401: teamCatalogErrorSchema,
          403: teamCatalogErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const member = request.member;
      if (!member) return sendApiError(reply, 401, 'Unauthorized');
      if (!hasScope(member.authz, 'teams.read')) return sendApiError(reply, 403, 'Forbidden');
      return getTeamCatalog();
    },
  );
}
