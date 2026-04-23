import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { registerProtectedApiRoutes, registerPublicApiRoutes } from './registerRoutes.js';
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
        title: 'Triangle Curling API',
        version: '1.0.0',
      },
      servers: [{ url: '/api' }],
    },
  });

  await registerPublicApiRoutes(fastify);
  await registerProtectedApiRoutes(fastify);

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
