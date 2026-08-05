import type { FastifyInstance } from 'fastify';
import { getDashboardLayout } from '../domains/content/dashboardSections.js';

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/dashboard/layout', async (request, reply) => {
    if (!request.member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const sections = await getDashboardLayout();
    return { sections };
  });
}
