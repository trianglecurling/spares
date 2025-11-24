import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isAdmin } from '../utils/auth.js';
import { Member } from '../types.js';
import { sendEmail } from '../services/email.js';
import { sendSMS } from '../services/sms.js';

const updateConfigSchema = z.object({
  twilioApiKeySid: z.string().optional(),
  twilioApiKeySecret: z.string().optional(),
  twilioAccountSid: z.string().optional(),
  twilioCampaignSid: z.string().optional(),
  azureConnectionString: z.string().optional(),
  azureSenderEmail: z.string().email().optional(),
  testMode: z.boolean().optional(),
  testCurrentTime: z.string().nullable().optional(),
  notificationDelaySeconds: z.number().int().min(1).optional(),
});

export async function configRoutes(fastify: FastifyInstance) {
  // Get server configuration (admin only)
  fastify.get('/config', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
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
        testMode: false,
        testCurrentTime: null,
        notificationDelaySeconds: 180,
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
      testMode: config.test_mode === 1,
      testCurrentTime: config.test_current_time,
      notificationDelaySeconds: config.notification_delay_seconds ?? 180,
      updatedAt: config.updated_at,
    };
  });

  // Update server configuration (admin only)
  fastify.patch('/config', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
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
    if (body.testMode !== undefined) {
      updateData.test_mode = body.testMode ? 1 : 0;
    }
    if (body.testCurrentTime !== undefined) {
      updateData.test_current_time = body.testCurrentTime || null;
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
      testMode: updatedConfig.test_mode === 1,
      testCurrentTime: updatedConfig.test_current_time,
      notificationDelaySeconds: updatedConfig.notification_delay_seconds ?? 180,
      updatedAt: updatedConfig.updated_at,
    };
  });

  // Send test email (admin only)
  fastify.post('/config/test-email', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
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
    if (!member || !isAdmin(member)) {
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
}

