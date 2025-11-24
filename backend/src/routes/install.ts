import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { getDatabaseConfig, saveDatabaseConfig, isDatabaseConfigured } from '../db/config.js';
import { testDatabaseConnection, initializeDatabase } from '../db/index.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { normalizeEmail } from '../utils/auth.js';

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
  adminEmails: z.array(z.string().email()).min(1),
});

export async function installRoutes(fastify: FastifyInstance) {
  // Check if database is configured
  fastify.get('/install/status', async () => {
    return {
      configured: isDatabaseConfigured(),
    };
  });

  // Get current config (if configured)
  fastify.get('/install/config', async (request, reply) => {
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
  });

  // Install/configure database
  fastify.post('/install', async (request, reply) => {
    if (isDatabaseConfigured()) {
      return reply.code(403).send({ error: 'Database already configured' });
    }

    const body = installSchema.parse(request.body);

    // Validate that the correct database config is provided
    if (body.databaseType === 'postgres' && !body.postgres) {
      return reply.code(400).send({ error: 'PostgreSQL configuration required' });
    }

    // Build test configuration (without saving yet)
    const testConfig = {
      type: body.databaseType,
      sqlite: body.databaseType === 'sqlite' ? {
        path: body.sqlite?.path || './data/spares.sqlite',
      } : undefined,
      postgres: body.databaseType === 'postgres' ? body.postgres : undefined,
      adminEmails: body.adminEmails,
    };

    // Test database connection FIRST - before saving anything
    try {
      await testDatabaseConnection(testConfig);
    } catch (error: any) {
      console.error('Database connection test failed:', error);
      return reply.code(400).send({ 
        error: `Database connection failed: ${error.message || 'Unable to connect to database. Please check your credentials and try again.'}` 
      });
    }

    // Connection test passed - now save configuration
    try {
      saveDatabaseConfig(testConfig);
    } catch (error: any) {
      console.error('Failed to save database configuration:', error);
      return reply.code(500).send({ 
        error: `Failed to save configuration: ${error.message || 'Unknown error'}` 
      });
    }

    // Configuration saved - now initialize database schema
    try {
      await initializeDatabase(testConfig);
      
      // Create initial admin members from the provided email addresses
      await createAdminMembers(body.adminEmails);
      
      return { success: true };
    } catch (error: any) {
      console.error('Database schema initialization failed:', error);
      
      // Provide helpful error messages for common PostgreSQL permission issues
      let errorMessage = error.message || 'Unknown error';
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
  });

  // Create admin members from config (useful if installation was done before this feature)
  fastify.post('/install/create-admin-members', async (request, reply) => {
    if (!isDatabaseConfigured()) {
      return reply.code(400).send({ error: 'Database not configured' });
    }

    const config = getDatabaseConfig();
    if (!config || !config.adminEmails || config.adminEmails.length === 0) {
      return reply.code(400).send({ error: 'No admin emails configured' });
    }

    try {
      const results = await createAdminMembers(config.adminEmails);
      return { 
        success: true, 
        created: results.created,
        updated: results.updated,
        total: results.created + results.updated
      };
    } catch (error: any) {
      console.error('Failed to create admin members:', error);
      return reply.code(500).send({ 
        error: `Failed to create admin members: ${error.message || 'Unknown error'}` 
      });
    }
  });
}

// Helper function to create admin members
async function createAdminMembers(adminEmails: string[]): Promise<{ created: number; updated: number }> {
  const { db, schema } = getDrizzleDb();
  let created = 0;
  let updated = 0;

  for (const email of adminEmails) {
    const normalizedEmail = normalizeEmail(email);
    
    // Extract a name from email (part before @) or use a default
    const emailName = normalizedEmail.split('@')[0];
    const name = emailName
      .split(/[._-]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || 'Admin User';
    
    // Check if member already exists
    const existingMembers = await db
      .select()
      .from(schema.members)
      .where(sql`LOWER(${schema.members.email}) = LOWER(${normalizedEmail})`)
      .limit(1);
    
    const existingMember = existingMembers[0];
    
    if (!existingMember) {
      // Create new admin member
      await db.insert(schema.members).values({
        name,
        email: normalizedEmail,
        is_admin: 1,
        email_subscribed: 1,
        opted_in_sms: 0,
        first_login_completed: 0,
        email_visible: 0,
        phone_visible: 0,
      });
      console.log(`Created admin member: ${normalizedEmail}`);
      created++;
    } else {
      // Update existing member to be admin
      await db
        .update(schema.members)
        .set({ is_admin: 1 })
        .where(eq(schema.members.id, existingMember.id));
      console.log(`Updated existing member to admin: ${normalizedEmail}`);
      updated++;
    }
  }

  return { created, updated };
}

