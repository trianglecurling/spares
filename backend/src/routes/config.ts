import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isServerAdmin } from '../utils/auth.js';
import { getCurrentDateStringAsync, invalidateTestTimeCache } from '../utils/time.js';
import { Member } from '../types.js';
import { sendEmail } from '../services/email.js';
import { sendSMS } from '../services/sms.js';
import { getDatabaseConfig, saveDatabaseConfig } from '../db/config.js';
import { resetDatabaseState, testDatabaseConnection } from '../db/index.js';
import type { DatabaseConfig } from '../db/config.js';
import { setBackendLogCaptureEnabled } from '../otel.js';

const updateConfigSchema = z.object({
  twilioApiKeySid: z.string().optional(),
  twilioApiKeySecret: z.string().optional(),
  twilioAccountSid: z.string().optional(),
  twilioCampaignSid: z.string().optional(),
  azureConnectionString: z.string().optional(),
  azureSenderEmail: z.string().email().optional().nullable(),
  azureSenderDisplayName: z.string().optional(),
  dashboardAlertTitle: z.string().optional().nullable(),
  dashboardAlertBody: z.string().optional().nullable(),
  dashboardAlertExpiresAt: z.string().optional().nullable(),
  dashboardAlertVariant: z
    .enum(['info', 'warning', 'success', 'danger'])
    .optional()
    .nullable(),
  dashboardAlertIcon: z
    .enum(['none', 'info', 'warning', 'announcement', 'success', 'error'])
    .optional()
    .nullable(),
  testMode: z.boolean().optional(),
  disableEmail: z.boolean().optional(),
  disableSms: z.boolean().optional(),
  captureFrontendLogs: z.boolean().optional(),
  captureBackendLogs: z.boolean().optional(),
  testCurrentTime: z.string().nullable().optional(),
  notificationDelaySeconds: z.number().int().min(1).optional(),
});

const observabilityQuerySchema = z.object({
  rangeDays: z.coerce.number().int().min(1).max(180).optional(),
});

export async function configRoutes(fastify: FastifyInstance) {
  // Get server configuration (admin only)
  fastify.get('/config', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isServerAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { db, schema } = getDrizzleDb();
    const configs = await db
      .select()
      .from(schema.serverConfig)
      .where(eq(schema.serverConfig.id, 1))
      .limit(1);
    
    const config = configs[0];

    if (!config) {
      return {
        twilioApiKeySid: null,
        twilioApiKeySecret: null,
        twilioAccountSid: null,
        twilioCampaignSid: null,
        azureConnectionString: null,
        azureSenderEmail: null,
        dashboardAlertTitle: null,
        dashboardAlertBody: null,
        dashboardAlertExpiresAt: null,
        dashboardAlertVariant: null,
        dashboardAlertIcon: null,
        testMode: false,
        disableEmail: false,
        disableSms: false,
        testCurrentTime: null,
        notificationDelaySeconds: 180,
        captureFrontendLogs: true,
        captureBackendLogs: true,
        updatedAt: null,
      };
    }

    return {
      twilioApiKeySid: config.twilio_api_key_sid,
      twilioApiKeySecret: config.twilio_api_key_secret ? '***' : null, // Mask the secret
      twilioAccountSid: config.twilio_account_sid,
      twilioCampaignSid: config.twilio_campaign_sid,
      azureConnectionString: config.azure_connection_string ? '***' : null, // Mask the connection string
      azureSenderEmail: config.azure_sender_email,
      dashboardAlertTitle: config.dashboard_alert_title,
      dashboardAlertBody: config.dashboard_alert_body,
      dashboardAlertExpiresAt: config.dashboard_alert_expires_at,
      dashboardAlertVariant: config.dashboard_alert_variant,
      dashboardAlertIcon: config.dashboard_alert_icon,
      testMode: config.test_mode === 1,
      disableEmail: config.disable_email === 1,
      disableSms: config.disable_sms === 1,
      captureFrontendLogs: config.capture_frontend_logs !== 0,
      captureBackendLogs: config.capture_backend_logs !== 0,
      testCurrentTime: config.test_current_time,
      notificationDelaySeconds: config.notification_delay_seconds ?? 180,
      updatedAt: config.updated_at,
    };
  });

  // Observability metrics (server admin only)
  fastify.get('/config/observability', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isServerAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { rangeDays } = observabilityQuerySchema.parse((request as any).query || {});
    const days = rangeDays ?? 30;

    const todayStr = await getCurrentDateStringAsync(); // YYYY-MM-DD
    const todayUtc = new Date(`${todayStr}T00:00:00.000Z`);
    const startUtc = new Date(todayUtc);
    startUtc.setUTCDate(startUtc.getUTCDate() - (days - 1));
    const startStr = startUtc.toISOString().slice(0, 10);

    const dateList: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(startUtc);
      d.setUTCDate(startUtc.getUTCDate() + i);
      dateList.push(d.toISOString().slice(0, 10));
    }

    const { db, schema } = getDrizzleDb();

    // Totals
    const membersTotalRows = await db.select({ count: sql<number>`COUNT(*)` }).from(schema.members);
    const membersTotal = Number(membersTotalRows[0]?.count || 0);

    // DAU (count unique member_id per day)
    const dauRows = await db
      .select({
        date: schema.dailyActivity.activity_date,
        dau: sql<number>`COUNT(DISTINCT ${schema.dailyActivity.member_id})`,
      })
      .from(schema.dailyActivity)
      .where(sql`${schema.dailyActivity.activity_date} >= ${startStr}`)
      .groupBy(schema.dailyActivity.activity_date);

    const dauByDate = new Map<string, number>();
    for (const row of dauRows as any[]) {
      dauByDate.set(String(row.date), Number(row.dau || 0));
    }

    // Events per day by type
    const eventRows = await db
      .select({
        date: sql<string>`DATE(${schema.observabilityEvents.created_at})`,
        eventType: schema.observabilityEvents.event_type,
        count: sql<number>`COUNT(*)`,
      })
      .from(schema.observabilityEvents)
      .where(sql`DATE(${schema.observabilityEvents.created_at}) >= ${startStr}`)
      .groupBy(sql`DATE(${schema.observabilityEvents.created_at})`, schema.observabilityEvents.event_type);

    const eventsByDateType = new Map<string, Map<string, number>>();
    for (const row of eventRows as any[]) {
      const date = String(row.date);
      const type = String(row.eventType);
      const count = Number(row.count || 0);
      if (!eventsByDateType.has(date)) eventsByDateType.set(date, new Map());
      eventsByDateType.get(date)!.set(type, count);
    }

    // Spare request created per day (from DB)
    const spareCreatedRows = await db
      .select({
        date: sql<string>`DATE(${schema.spareRequests.created_at})`,
        count: sql<number>`COUNT(*)`,
      })
      .from(schema.spareRequests)
      .where(sql`DATE(${schema.spareRequests.created_at}) >= ${startStr}`)
      .groupBy(sql`DATE(${schema.spareRequests.created_at})`);

    const spareCreatedByDate = new Map<string, number>();
    for (const row of spareCreatedRows as any[]) {
      spareCreatedByDate.set(String(row.date), Number(row.count || 0));
    }

    // Spare request filled per day (from DB)
    const spareFilledRows = await db
      .select({
        date: sql<string>`DATE(${schema.spareRequests.filled_at})`,
        count: sql<number>`COUNT(*)`,
      })
      .from(schema.spareRequests)
      .where(sql`${schema.spareRequests.filled_at} IS NOT NULL AND DATE(${schema.spareRequests.filled_at}) >= ${startStr}`)
      .groupBy(sql`DATE(${schema.spareRequests.filled_at})`);

    const spareFilledByDate = new Map<string, number>();
    for (const row of spareFilledRows as any[]) {
      spareFilledByDate.set(String(row.date), Number(row.count || 0));
    }

    // Avg time-to-fill for requests filled in range (best-effort)
    const filledTimingRows = await db
      .select({
        createdAt: schema.spareRequests.created_at,
        filledAt: schema.spareRequests.filled_at,
      })
      .from(schema.spareRequests)
      .where(sql`${schema.spareRequests.filled_at} IS NOT NULL AND DATE(${schema.spareRequests.filled_at}) >= ${startStr}`);

    let totalFillMs = 0;
    let fillCount = 0;
    for (const row of filledTimingRows as any[]) {
      const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt));
      const filledAt = row.filledAt instanceof Date ? row.filledAt : new Date(String(row.filledAt));
      const diff = filledAt.getTime() - createdAt.getTime();
      if (Number.isFinite(diff) && diff >= 0) {
        totalFillMs += diff;
        fillCount += 1;
      }
    }
    const avgTimeToFillMinutes = fillCount > 0 ? Math.round((totalFillMs / fillCount) / 60000) : null;

    // Build day-by-day series
    const series = dateList.map((date) => {
      const events = eventsByDateType.get(date) || new Map<string, number>();
      return {
        date,
        dau: dauByDate.get(date) || 0,
        emailsSent: events.get('email.sent') || 0,
        emailsLogged: events.get('email.logged') || 0,
        smsSent: events.get('sms.sent') || 0,
        smsLogged: events.get('sms.logged') || 0,
        spareRequestsCreated: spareCreatedByDate.get(date) || 0,
        spareRequestsFilled: spareFilledByDate.get(date) || 0,
        spareOffersCancelled: events.get('spare.offer.cancelled') || 0,
        spareRequestsCancelled: events.get('spare.request.cancelled') || 0,
        logins: events.get('auth.login_success') || 0,
        authCodesRequested: events.get('auth.code_requested') || 0,
      };
    });

    const today = series[series.length - 1];
    const last7 = series.slice(-7);
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    const avg = (arr: number[]) => (arr.length ? Math.round(sum(arr) / arr.length) : 0);

    return {
      rangeDays: days,
      startDate: startStr,
      endDate: todayStr,
      totals: {
        membersTotal,
        dauToday: today?.dau || 0,
        dau7DayAvg: avg(last7.map((d) => d.dau)),
        emailsToday: (today?.emailsSent || 0) + (today?.emailsLogged || 0),
        emailsSentToday: today?.emailsSent || 0,
        emailsLoggedToday: today?.emailsLogged || 0,
        spareRequestsCreatedToday: today?.spareRequestsCreated || 0,
        spareRequestsFilledToday: today?.spareRequestsFilled || 0,
        avgTimeToFillMinutes,
      },
      series,
    };
  });

  // Update server configuration (admin only)
  fastify.patch('/config', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isServerAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = updateConfigSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const updateData: any = {};

    if (body.twilioApiKeySid !== undefined) {
      updateData.twilio_api_key_sid = body.twilioApiKeySid || null;
    }
    if (body.twilioApiKeySecret !== undefined) {
      updateData.twilio_api_key_secret = body.twilioApiKeySecret || null;
    }
    if (body.twilioAccountSid !== undefined) {
      updateData.twilio_account_sid = body.twilioAccountSid || null;
    }
    if (body.twilioCampaignSid !== undefined) {
      updateData.twilio_campaign_sid = body.twilioCampaignSid || null;
    }
    if (body.azureConnectionString !== undefined) {
      updateData.azure_connection_string = body.azureConnectionString || null;
    }
    if (body.azureSenderEmail !== undefined) {
      updateData.azure_sender_email = body.azureSenderEmail || null;
    }
    if (body.azureSenderDisplayName !== undefined) {
      updateData.azure_sender_display_name = body.azureSenderDisplayName || null;
    }
    if (body.dashboardAlertTitle !== undefined) {
      updateData.dashboard_alert_title = body.dashboardAlertTitle || null;
    }
    if (body.dashboardAlertBody !== undefined) {
      updateData.dashboard_alert_body = body.dashboardAlertBody || null;
    }
    if (body.dashboardAlertExpiresAt !== undefined) {
      updateData.dashboard_alert_expires_at = body.dashboardAlertExpiresAt
        ? new Date(body.dashboardAlertExpiresAt)
        : null;
    }
    if (body.dashboardAlertVariant !== undefined) {
      updateData.dashboard_alert_variant = body.dashboardAlertVariant || null;
    }
    if (body.dashboardAlertIcon !== undefined) {
      updateData.dashboard_alert_icon = body.dashboardAlertIcon || null;
    }
    if (body.testMode !== undefined) {
      updateData.test_mode = body.testMode ? 1 : 0;
    }
    if (body.disableEmail !== undefined) {
      updateData.disable_email = body.disableEmail ? 1 : 0;
    }
    if (body.disableSms !== undefined) {
      updateData.disable_sms = body.disableSms ? 1 : 0;
    }
    if (body.captureFrontendLogs !== undefined) {
      updateData.capture_frontend_logs = body.captureFrontendLogs ? 1 : 0;
    }
    if (body.captureBackendLogs !== undefined) {
      updateData.capture_backend_logs = body.captureBackendLogs ? 1 : 0;
    }
    if (body.testCurrentTime !== undefined) {
      // Convert string to Date object for PostgreSQL timestamp column
      updateData.test_current_time = body.testCurrentTime ? new Date(body.testCurrentTime) : null;
    }
    if (body.notificationDelaySeconds !== undefined) {
      updateData.notification_delay_seconds = body.notificationDelaySeconds;
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = sql`CURRENT_TIMESTAMP`;

      await db
        .update(schema.serverConfig)
        .set(updateData)
        .where(eq(schema.serverConfig.id, 1));
      
      // Invalidate test time cache if test time was updated
      if (body.testCurrentTime !== undefined) {
        invalidateTestTimeCache();
      }
      
      // Invalidate cached clients in email and SMS services
      // This will force them to reinitialize with new credentials
      if (body.twilioApiKeySid !== undefined || body.twilioApiKeySecret !== undefined || body.twilioAccountSid !== undefined || body.twilioCampaignSid !== undefined) {
        // Clear Twilio client cache
        const { clearTwilioClient } = await import('../services/sms.js');
        clearTwilioClient();
      }
      if (body.azureConnectionString !== undefined) {
        // Clear Azure email client cache
        const { clearEmailClient } = await import('../services/email.js');
        clearEmailClient();
      }

      if (body.captureBackendLogs !== undefined) {
        setBackendLogCaptureEnabled(body.captureBackendLogs);
      }
    }

    const updatedConfigs = await db
      .select()
      .from(schema.serverConfig)
      .where(eq(schema.serverConfig.id, 1))
      .limit(1);
    
    const updatedConfig = updatedConfigs[0];

    return {
      twilioApiKeySid: updatedConfig.twilio_api_key_sid,
      twilioApiKeySecret: updatedConfig.twilio_api_key_secret ? '***' : null,
      twilioAccountSid: updatedConfig.twilio_account_sid,
      twilioCampaignSid: updatedConfig.twilio_campaign_sid,
      azureConnectionString: updatedConfig.azure_connection_string ? '***' : null,
      azureSenderEmail: updatedConfig.azure_sender_email,
      dashboardAlertTitle: updatedConfig.dashboard_alert_title,
      dashboardAlertBody: updatedConfig.dashboard_alert_body,
      dashboardAlertExpiresAt: updatedConfig.dashboard_alert_expires_at,
      dashboardAlertVariant: updatedConfig.dashboard_alert_variant,
      dashboardAlertIcon: updatedConfig.dashboard_alert_icon,
      testMode: updatedConfig.test_mode === 1,
      disableEmail: updatedConfig.disable_email === 1,
      disableSms: updatedConfig.disable_sms === 1,
      captureFrontendLogs: updatedConfig.capture_frontend_logs !== 0,
      captureBackendLogs: updatedConfig.capture_backend_logs !== 0,
      testCurrentTime: updatedConfig.test_current_time,
      notificationDelaySeconds: updatedConfig.notification_delay_seconds ?? 180,
      updatedAt: updatedConfig.updated_at,
    };
  });

  // Send test email (admin only)
  fastify.post('/config/test-email', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isServerAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    if (!member.email) {
      return reply.code(400).send({ error: 'Your account does not have an email address configured' });
    }

    try {
      await sendEmail({
        to: member.email,
        subject: 'Test Email from Triangle Curling Spares',
        htmlContent: `
          <h2>Test Email</h2>
          <p>This is a test email from the Triangle Curling Spares server configuration page.</p>
          <p>If you received this email, your Azure Communication Services configuration is working correctly!</p>
          <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
        `,
        recipientName: member.name,
      });

      return { success: true, message: `Test email sent to ${member.email}` };
    } catch (error) {
      console.error('Failed to send test email:', error);
      return reply.code(500).send({ 
        error: 'Failed to send test email',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Send test SMS (admin only)
  fastify.post('/config/test-sms', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isServerAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    if (!member.phone) {
      return reply.code(400).send({ error: 'Your account does not have a phone number configured' });
    }

    try {
      const testMessage = `Test SMS from Triangle Curling Spares. Sent at ${new Date().toLocaleString()}. Your Twilio configuration is working correctly!`;
      await sendSMS(member.phone, testMessage);

      return { success: true, message: `Test SMS sent to ${member.phone}` };
    } catch (error) {
      console.error('Failed to send test SMS:', error);
      return reply.code(500).send({ 
        error: 'Failed to send test SMS',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get database configuration (admin only)
  fastify.get('/database-config', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isServerAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const config = getDatabaseConfig();
    if (!config) {
      return reply.code(404).send({ error: 'Database not configured' });
    }

    // Return config without password for security
    return {
      type: config.type,
      sqlite: config.sqlite,
      postgres: config.postgres ? {
        host: config.postgres.host,
        port: config.postgres.port,
        database: config.postgres.database,
        username: config.postgres.username,
        // Don't return password
        ssl: config.postgres.ssl,
      } : undefined,
      adminEmails: config.adminEmails,
    };
  });

  // Update database configuration (admin only)
  const updateDatabaseConfigSchema = z.object({
    databaseType: z.enum(['sqlite', 'postgres']),
    sqlite: z.object({
      path: z.string().optional(),
    }).optional(),
    postgres: z.object({
      host: z.string(),
      port: z.number().int().min(1).max(65535),
      database: z.string(),
      username: z.string(),
      password: z.string().optional(), // Optional - if not provided, keep existing
      ssl: z.boolean().optional(),
    }).optional(),
    adminEmails: z.array(z.string().email()).min(1),
  });

  fastify.post('/database-config', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isServerAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = updateDatabaseConfigSchema.parse(request.body);

    // Validate that the correct database config is provided
    if (body.databaseType === 'postgres' && !body.postgres) {
      return reply.code(400).send({ error: 'PostgreSQL configuration required' });
    }

    // Get current config to preserve password if not provided
    const currentConfig = getDatabaseConfig();
    let passwordToUse: string | undefined;

    if (body.databaseType === 'postgres' && body.postgres) {
      // If password is not provided, use existing password
      if (!body.postgres.password && currentConfig?.postgres) {
        passwordToUse = currentConfig.postgres.password;
      } else if (body.postgres.password) {
        passwordToUse = body.postgres.password;
      } else {
        return reply.code(400).send({ error: 'Password is required for PostgreSQL' });
      }
    }

    // Build test configuration (without saving yet)
    const testConfig = {
      type: body.databaseType,
      sqlite: body.databaseType === 'sqlite' ? {
        path: body.sqlite?.path || './data/spares.sqlite',
      } : undefined,
      postgres: body.databaseType === 'postgres' && body.postgres ? {
        host: body.postgres.host,
        port: body.postgres.port,
        database: body.postgres.database,
        username: body.postgres.username,
        password: passwordToUse!,
        ssl: body.postgres.ssl || false,
      } : undefined,
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
      
      // Reset database state so it reinitializes with new config on next request
      resetDatabaseState();
      
      return { 
        success: true,
        message: 'Database configuration updated successfully. Please restart the server for changes to take effect.'
      };
    } catch (error: any) {
      console.error('Failed to save database configuration:', error);
      return reply.code(500).send({ 
        error: `Failed to save configuration: ${error.message || 'Unknown error'}` 
      });
    }
  });
}

