import { loadBackendLogCaptureFromDb } from './otel.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyRawBody from 'fastify-raw-body';
import { config } from './config.js';
import { apiErrorPayload } from './api/errors.js';
import { connectDatabase, resetDatabaseState, verifyDatabaseSchema } from './db/index.js';
import { authMiddleware } from './middleware/auth.js';
import { registerProtectedApiRoutes, registerPublicApiRoutes } from './registerRoutes.js';
import { optionalAuthMiddleware } from './middleware/auth.js';
import { goRedirectRoutes } from './routes/goRedirect.js';
import { startNotificationProcessor } from './services/notificationProcessor.js';
import { startPaymentReconciliationProcessor } from './services/paymentReconciliationProcessor.js';
import { startWaitlistOfferProcessor } from './services/waitlistOfferProcessor.js';
import { startVolunteerReminderProcessor } from './services/volunteerReminderProcessor.js';
import { isDatabaseConfigured } from './db/config.js';
import { warmPublicBootstrapCache } from './services/publicBootstrapCache.js';
import { warmSearchIndex } from './search/searchIndexService.js';
import { maybeInvalidatePublicBootstrapCache } from './services/publicBootstrapCacheInvalidation.js';
import { FASTIFY_MAX_PARAM_LENGTH } from './utils/eventRegistrationAccessToken.js';

const fastify = Fastify({
  logger: config.nodeEnv === 'development',
  routerOptions: {
    maxParamLength: FASTIFY_MAX_PARAM_LENGTH,
  },
});

fastify.addHook('onResponse', async (request, reply) => {
  maybeInvalidatePublicBootstrapCache(request, reply.statusCode);
});

// Register CORS
await fastify.register(cors, {
  origin: config.frontendUrl,
  credentials: true,
});

await fastify.register(multipart, {
  limits: {
    files: 50,
    fileSize: 50 * 1024 * 1024,
  },
});

await fastify.register(swagger, {
  openapi: {
    info: {
      title: 'Triangle Curling API',
      version: '1.0.0',
    },
  },
});

await fastify.register(swaggerUi, {
  routePrefix: '/docs',
});

await fastify.register(fastifyRawBody, {
  field: 'rawBody',
  global: false,
  encoding: 'utf8',
  runFirst: true,
});

// Track database initialization state
let dbInitialized = false;
let dbInitError: Error | null = null;
let backgroundProcessorsStarted = false;

function startBackgroundProcessorsIfReady(): void {
  if (backgroundProcessorsStarted || !dbInitialized) {
    return;
  }

  startNotificationProcessor();
  startPaymentReconciliationProcessor();
  startWaitlistOfferProcessor();
  startVolunteerReminderProcessor();
  backgroundProcessorsStarted = true;
}

// Try to initialize database on startup if configured
if (isDatabaseConfigured()) {
  try {
    await connectDatabase();
    await verifyDatabaseSchema();
    dbInitialized = true;
    console.log('Database connection verified successfully');
    await loadBackendLogCaptureFromDb();
    startBackgroundProcessorsIfReady();
    void warmSearchIndex().catch((error) => {
      console.error('Failed to warm search index on startup:', error);
    });
  } catch (error: unknown) {
    const initError = error instanceof Error ? error : new Error('Unknown database initialization error');
    dbInitError = initError;
    console.error('Failed to verify database startup state:', error);
    console.error('Error details:', initError.message);
  }
}

// Dynamic hook that checks database status on each request
fastify.addHook('onRequest', async (request, reply) => {
  const url = request.url.split('?')[0]; // Remove query string
  
  // Always allow install routes and health check
  if (url.startsWith('/api/install') || url === '/api/health') {
    return;
  }

  // Check if database is configured (re-check on each request)
  if (!isDatabaseConfigured()) {
    return reply.code(503).send({
      ...apiErrorPayload('Database not configured'),
      requiresInstallation: true,
    });
  }

  // Database is configured - check if it's initialized
  if (!dbInitialized) {
    try {
      // Reset any previous state before initializing
      resetDatabaseState();
      await connectDatabase();
      await verifyDatabaseSchema();
      dbInitialized = true;
      dbInitError = null;
      console.log('Database verified on first request');
      await loadBackendLogCaptureFromDb();
      void warmPublicBootstrapCache().catch((error) => {
        console.error('Failed to warm public bootstrap cache on first request:', error);
      });
      void warmSearchIndex().catch((error) => {
        console.error('Failed to warm search index on first request:', error);
      });
      startBackgroundProcessorsIfReady();

      // Allow request to proceed
      return;
    } catch (error: unknown) {
      const initError = error instanceof Error ? error : new Error('Unknown database initialization error');
      dbInitError = initError;
      console.error('Failed to verify database on request:', error);
    }
    
    // If initialization failed, block the request
    return reply.code(503).send({
      ...apiErrorPayload('Database initialization failed'),
      message: dbInitError?.message || 'Please check your database configuration and run "bun run db:migrate".',
      requiresInstallation: true,
    });
  }

  // Database is configured and initialized - allow request
  return;
});

// Health check
fastify.get('/api/health', async () => {
  return { status: 'ok' };
});

await registerPublicApiRoutes(fastify);

await fastify.register(
  async (instance) => {
    instance.addHook('onRequest', optionalAuthMiddleware);
    await instance.register(goRedirectRoutes);
  },
  { prefix: '/go' }
);

// Protected routes
fastify.register(
  async (instance) => {
    instance.addHook('onRequest', authMiddleware);
    await registerProtectedApiRoutes(instance);
  }
);

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`Server listening on port ${config.port}`);
    if (dbInitialized) {
      void warmPublicBootstrapCache().catch((error) => {
        console.error('Failed to warm public bootstrap cache after listen:', error);
      });
      void warmSearchIndex().catch((error) => {
        console.error('Failed to warm search index after listen:', error);
      });
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
