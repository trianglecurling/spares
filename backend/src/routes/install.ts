import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatabaseConfig, saveDatabaseConfig, isDatabaseConfigured } from '../db/config.js';
import { testDatabaseConnection, initializeDatabase } from '../db/index.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { normalizeEmail } from '../utils/auth.js';
import { resolveMemberNameFields } from '../utils/memberName.js';
import {
  installConfigResponseSchema,
  installStatusResponseSchema,
  successResponseSchema,
} from '../api/schemas.js';
import type {
  ApiErrorResponse,
  InstallConfigResponse,
  InstallStatusResponse,
} from '../api/types.js';

const initialAdminSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().email(),
});

const installSchema = z.object({
  databaseType: z.enum(['sqlite', 'postgres']),
  sqlite: z.object({
    path: z.string().optional(),
  }).optional(),
  postgres: z.object({
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    database: z.string(),
    username: z.string(),
    password: z.string(),
    ssl: z.boolean().optional(),
  }).optional(),
  initialAdmin: initialAdminSchema,
});

const installBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    databaseType: { type: 'string', enum: ['sqlite', 'postgres'] },
    sqlite: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
      },
    },
    postgres: {
      type: 'object',
      additionalProperties: false,
      properties: {
        host: { type: 'string' },
        port: { type: 'number' },
        database: { type: 'string' },
        username: { type: 'string' },
        password: { type: 'string' },
        ssl: { type: 'boolean' },
      },
      required: ['host', 'port', 'database', 'username', 'password'],
    },
    initialAdmin: {
      type: 'object',
      additionalProperties: false,
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['firstName', 'lastName', 'email'],
    },
  },
  required: ['databaseType', 'initialAdmin'],
} as const;

export async function installRoutes(fastify: FastifyInstance) {
  // Check if database is configured
  fastify.get<{ Reply: InstallStatusResponse }>(
    '/install/status',
    {
      schema: {
        tags: ['install'],
        response: {
          200: installStatusResponseSchema,
        },
      },
    },
    async () => {
    return {
      configured: isDatabaseConfigured(),
    };
    }
  );

  // Get current config (if configured)
  fastify.get<{ Reply: InstallConfigResponse | ApiErrorResponse }>(
    '/install/config',
    {
      schema: {
        tags: ['install'],
        response: {
          200: installConfigResponseSchema,
        },
      },
    },
    async (request, reply) => {
    if (isDatabaseConfigured()) {
      return reply.code(403).send({ error: 'Database already configured' });
    }
    
    const config = getDatabaseConfig();
    if (config) {
      // Don't return password
      const safeConfig = {
        ...config,
        postgres: config.postgres ? {
          ...config.postgres,
          password: undefined,
        } : undefined,
      };
      return safeConfig;
    }
    return null;
    }
  );

  // Install/configure database
  fastify.post<{ Reply: { success: boolean } | ApiErrorResponse }>(
    '/install',
    {
      schema: {
        tags: ['install'],
        body: installBodySchema,
        response: {
          200: successResponseSchema,
        },
      },
    },
    async (request, reply) => {
    if (isDatabaseConfigured()) {
      return reply.code(403).send({ error: 'Database already configured' });
    }

    const body = installSchema.parse(request.body);

    // Validate that the correct database config is provided
    if (body.databaseType === 'postgres' && !body.postgres) {
      return reply.code(400).send({ error: 'PostgreSQL configuration required' });
    }

    const resolvedName = resolveMemberNameFields(body.initialAdmin);
    if (!resolvedName) {
      return reply.code(400).send({ error: 'First name and last name are required for the initial admin account' });
    }

    // Build test configuration (without saving yet)
    const testConfig = {
      type: body.databaseType,
      sqlite: body.databaseType === 'sqlite' ? {
        path: body.sqlite?.path || './data/spares.sqlite',
      } : undefined,
      postgres: body.databaseType === 'postgres' ? body.postgres : undefined,
    };

    // Test database connection FIRST - before saving anything
    try {
      await testDatabaseConnection(testConfig);
    } catch (error: unknown) {
      console.error('Database connection test failed:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to connect to database. Please check your credentials and try again.';
      return reply.code(400).send({ 
        error: `Database connection failed: ${message}` 
      });
    }

    // Connection test passed - now save configuration
    try {
      saveDatabaseConfig(testConfig);
    } catch (error: unknown) {
      console.error('Failed to save database configuration:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.code(500).send({ 
        error: `Failed to save configuration: ${message}` 
      });
    }

    // Configuration saved - now initialize database schema
    try {
      await initializeDatabase(testConfig);
      
      await createInitialAdminMember({
        firstName: resolvedName.firstName,
        lastName: resolvedName.lastName,
        email: normalizeEmail(body.initialAdmin.email),
        name: resolvedName.name,
      });
      
      return { success: true };
    } catch (error: unknown) {
      console.error('Database schema initialization failed:', error);
      
      // Provide helpful error messages for common PostgreSQL permission issues
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';
      let helpfulHint = '';
      
      if (errorMessage.includes('permission denied') || errorMessage.includes('permission denied for schema')) {
        helpfulHint = ' The database user needs CREATE privileges on the database. Run this SQL as a superuser: GRANT CREATE ON DATABASE your_database_name TO your_username;';
      } else if (errorMessage.includes('does not exist')) {
        helpfulHint = ' Please ensure the database exists and the user has access to it.';
      } else if (errorMessage.includes('password authentication failed')) {
        helpfulHint = ' Please check your username and password.';
      } else if (errorMessage.includes('connection')) {
        helpfulHint = ' Please check your host, port, and network connectivity.';
      }
      
      // Configuration is saved but schema init failed - this is a problem
      // User will need to fix the config or we could delete it
      return reply.code(500).send({ 
        error: `Schema initialization failed: ${errorMessage}.${helpfulHint} You may need to fix your database permissions and try again, or delete the configuration file and start over.` 
      });
    }
    }
  );
}

async function createInitialAdminMember(input: {
  firstName: string;
  lastName: string;
  name: string;
  email: string;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();

  await db.insert(schema.members).values({
    name: input.name,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    is_server_admin: 1,
    email_subscribed: 1,
    opted_in_sms: 0,
    email_visible: 0,
    phone_visible: 0,
  });

  console.log(`Created initial server admin member: ${input.email}`);
}
