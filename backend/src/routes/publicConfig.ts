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
        frontend_otel_enabled: schema.serverConfig.frontend_otel_enabled,
        capture_frontend_logs: schema.serverConfig.capture_frontend_logs,
        dashboard_alert_title: schema.serverConfig.dashboard_alert_title,
        dashboard_alert_body: schema.serverConfig.dashboard_alert_body,
        dashboard_alert_expires_at: schema.serverConfig.dashboard_alert_expires_at,
        dashboard_alert_variant: schema.serverConfig.dashboard_alert_variant,
        dashboard_alert_icon: schema.serverConfig.dashboard_alert_icon,
      })
      .from(schema.serverConfig)
      .where(eq(schema.serverConfig.id, 1))
      .limit(1);

    const cfg = rows[0];

    return {
      disableSms: cfg?.disable_sms === 1,
      frontendOtelEnabled: cfg?.frontend_otel_enabled !== 0,
      captureFrontendLogs: cfg?.capture_frontend_logs !== 0,
      dashboardAlertTitle: cfg?.dashboard_alert_title || null,
      dashboardAlertBody: cfg?.dashboard_alert_body || null,
      dashboardAlertExpiresAt: cfg?.dashboard_alert_expires_at || null,
      dashboardAlertVariant: cfg?.dashboard_alert_variant || null,
      dashboardAlertIcon: cfg?.dashboard_alert_icon || null,
    };
  });
}

