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
import { isDatabaseConfigured } from './db/config.js';

const fastify = Fastify({
  logger: config.nodeEnv === 'development',
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
      title: 'Triangle Curling Spares API',
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
let adminMembersCreated = false;
let backgroundProcessorsStarted = false;

function startBackgroundProcessorsIfReady(): void {
  if (backgroundProcessorsStarted || !dbInitialized) {
    return;
  }

  startNotificationProcessor();
  startPaymentReconciliationProcessor();
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
    
    // Create admin members if none exist
    await ensureAdminMembersExist();
    startBackgroundProcessorsIfReady();
  } catch (error: unknown) {
    const initError = error instanceof Error ? error : new Error('Unknown database initialization error');
    dbInitError = initError;
    console.error('Failed to verify database startup state:', error);
    console.error('Error details:', initError.message);
  }
}

// Helper function to create admin members if they don't exist
async function ensureAdminMembersExist(): Promise<void> {
  if (adminMembersCreated) return;
  
  try {
    const { getDrizzleDb } = await import('./db/drizzle-db.js');
    const { getDatabaseConfig } = await import('./db/config.js');
    const { normalizeEmail } = await import('./utils/auth.js');
    const { sql } = await import('drizzle-orm');
    
    const { db, schema } = getDrizzleDb();
    const memberCountResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.members);
    
    const memberCount = Number(memberCountResult[0]?.count || 0);
    
    if (memberCount === 0) {
      // No members exist - create server admin members from SERVER_ADMINS env var and database config
      const dbConfig = getDatabaseConfig();
      
      // Combine SERVER_ADMINS env var and database config adminEmails
      const serverAdminEmails = new Set<string>();
      
      // Add emails from SERVER_ADMINS environment variable
      if (config.admins && config.admins.length > 0) {
        config.admins.forEach(email => serverAdminEmails.add(normalizeEmail(email)));
      }
      
      // Add emails from database config
      if (dbConfig && dbConfig.adminEmails && dbConfig.adminEmails.length > 0) {
        dbConfig.adminEmails.forEach(email => serverAdminEmails.add(normalizeEmail(email)));
      }
      
      if (serverAdminEmails.size > 0) {
        for (const email of serverAdminEmails) {
          const normalizedEmail = normalizeEmail(email);
          const emailName = normalizedEmail.split('@')[0];
          const name = emailName
            .split(/[._-]/)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ') || 'Admin User';
          
          const existingMembers = await db
            .select()
            .from(schema.members)
            .where(sql`LOWER(${schema.members.email}) = LOWER(${normalizedEmail})`)
            .limit(1);
          
          if (existingMembers.length === 0) {
            await db.insert(schema.members).values({
              name,
              email: normalizedEmail,
              is_admin: 0,
              is_server_admin: 1,
              email_subscribed: 1,
              opted_in_sms: 0,
              first_login_completed: 0,
              email_visible: 0,
              phone_visible: 0,
            });
            console.log(`Created server admin member: ${normalizedEmail}`);
          }
        }
        adminMembersCreated = true;
      }
    } else {
      adminMembersCreated = true; // Members exist, no need to create
    }
  } catch (error) {
    // Don't block if this fails - just log it
    console.error('Failed to check/create admin members:', error);
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
      
      // Create admin members if none exist
      await ensureAdminMembersExist();
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
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
