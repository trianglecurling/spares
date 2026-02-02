import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { publicAuthRoutes, protectedAuthRoutes } from './routes/auth.js';
import { memberRoutes } from './routes/members.js';
import { leagueRoutes } from './routes/leagues.js';
import { leagueSetupRoutes } from './routes/leagueSetup.js';
import { availabilityRoutes } from './routes/availability.js';
import { spareRoutes } from './routes/spares.js';
import { configRoutes } from './routes/config.js';
import { installRoutes } from './routes/install.js';
import { publicFeedbackRoutes, protectedFeedbackRoutes } from './routes/feedback.js';
import { publicConfigRoutes } from './routes/publicConfig.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function buildOpenApi(): Promise<void> {
  const fastify = Fastify({ logger: false });

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Triangle Curling Spares API',
        version: '1.0.0',
      },
      servers: [{ url: '/api' }],
    },
  });

  // Register all routes for OpenAPI generation.
  await fastify.register(installRoutes, { prefix: '/api' });
  await fastify.register(publicAuthRoutes, { prefix: '/api' });
  await fastify.register(protectedAuthRoutes, { prefix: '/api' });
  await fastify.register(publicFeedbackRoutes, { prefix: '/api' });
  await fastify.register(protectedFeedbackRoutes, { prefix: '/api' });
  await fastify.register(publicConfigRoutes, { prefix: '/api' });
  await fastify.register(memberRoutes, { prefix: '/api' });
  await fastify.register(leagueRoutes, { prefix: '/api' });
  await fastify.register(leagueSetupRoutes, { prefix: '/api' });
  await fastify.register(availabilityRoutes, { prefix: '/api' });
  await fastify.register(spareRoutes, { prefix: '/api' });
  await fastify.register(configRoutes, { prefix: '/api' });

  await fastify.ready();
  const spec = fastify.swagger();

  const outPath = path.resolve(__dirname, '../openapi.json');
  fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));
  await fastify.close();
}

buildOpenApi().catch((error) => {
  console.error('Failed to generate OpenAPI spec:', error);
  process.exit(1);
});
