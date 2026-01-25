import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';

export async function publicConfigRoutes(fastify: FastifyInstance) {
  // Public, non-sensitive flags that the UI can use to adjust behavior.
  // Intentionally does not expose secrets or admin-only settings.
  fastify.get('/public-config', async () => {
    const { db, schema } = getDrizzleDb();

    const rows = await db
      .select({
        disable_sms: schema.serverConfig.disable_sms,
        capture_frontend_logs: schema.serverConfig.capture_frontend_logs,
      })
      .from(schema.serverConfig)
      .where(eq(schema.serverConfig.id, 1))
      .limit(1);

    const cfg = rows[0];

    return {
      disableSms: cfg?.disable_sms === 1,
      captureFrontendLogs: cfg?.capture_frontend_logs !== 0,
    };
  });
}

