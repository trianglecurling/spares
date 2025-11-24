import twilio from 'twilio';
import { config } from '../config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { eq } from 'drizzle-orm';

let twilioClient: ReturnType<typeof twilio> | null = null;
let cachedConfig: {
  apiKeySid: string;
  apiKeySecret: string;
  accountSid: string | null;
  campaignSid: string | null;
  testMode: boolean;
} | null = null;
let configCacheTimestamp = 0;
const CONFIG_CACHE_TTL = 5000; // Cache for 5 seconds

async function getConfigFromDatabase() {
  const now = Date.now();
  if (cachedConfig && (now - configCacheTimestamp) < CONFIG_CACHE_TTL) {
    return cachedConfig;
  }

  const { db, schema } = getDrizzleDb();
  const serverConfigs = await db
    .select({
      twilio_api_key_sid: schema.serverConfig.twilio_api_key_sid,
      twilio_api_key_secret: schema.serverConfig.twilio_api_key_secret,
      twilio_account_sid: schema.serverConfig.twilio_account_sid,
      twilio_campaign_sid: schema.serverConfig.twilio_campaign_sid,
      test_mode: schema.serverConfig.test_mode,
    })
    .from(schema.serverConfig)
    .where(eq(schema.serverConfig.id, 1))
    .limit(1);
  
  const serverConfig = serverConfigs[0];

  cachedConfig = {
    apiKeySid: serverConfig?.twilio_api_key_sid || config.twilio.accountSid,
    apiKeySecret: serverConfig?.twilio_api_key_secret || config.twilio.authToken,
    accountSid: serverConfig?.twilio_account_sid || null,
    campaignSid: serverConfig?.twilio_campaign_sid || null,
    testMode: serverConfig?.test_mode === 1,
  };
  configCacheTimestamp = now;
  
  return cachedConfig;
}

export function clearTwilioClient() {
  twilioClient = null;
}

async function getTwilioClient() {
  const dbConfig = await getConfigFromDatabase();
  
  if (!twilioClient && dbConfig.apiKeySid && dbConfig.apiKeySecret) {
    // Use API Key SID and Secret, with Account SID as option if provided
    const options = dbConfig.accountSid ? { accountSid: dbConfig.accountSid } : undefined;
    twilioClient = twilio(dbConfig.apiKeySid, dbConfig.apiKeySecret, options);
  }
  if (!twilioClient) {
    throw new Error('SMS client not configured');
  }
  return twilioClient;
}

export async function sendSMS(to: string, message: string): Promise<void> {
  const dbConfig = await getConfigFromDatabase();
  
  // In test mode, print to console instead of sending
  if (dbConfig.testMode) {
    console.log('='.repeat(80));
    console.log('[TEST MODE] SMS would be sent:');
    console.log('To:', to);
    console.log('Message:', message);
    console.log('='.repeat(80));
    return;
  }
  
  if (!dbConfig.apiKeySid || !dbConfig.apiKeySecret || !dbConfig.accountSid || !dbConfig.campaignSid) {
    console.log('SMS not configured. Would send to', to, ':', message);
    return;
  }

  try {
    const client = await getTwilioClient();
    await client.messages.create({
      body: message,
      from: config.twilio.phoneNumber,
      to: to,
      messagingServiceSid: dbConfig.campaignSid,
    });
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}

export async function sendAuthCodeSMS(phone: string, code: string): Promise<void> {
  const message = `Your Triangle Curling login code is: ${code}. This code expires in 10 minutes.`;
  await sendSMS(phone, message);
}

export async function sendSpareRequestSMS(
  phone: string,
  requesterName: string,
  gameDate: string,
  gameTime: string
): Promise<void> {
  const message = `Triangle Curling: ${requesterName} needs a spare for ${gameDate} at ${gameTime}. Check your email or log in to respond.`;
  await sendSMS(phone, message);
}

export async function sendSpareFilledSMS(
  phone: string,
  responderName: string,
  gameDate: string,
  gameTime: string
): Promise<void> {
  const message = `Triangle Curling: ${responderName} will spare for you on ${gameDate} at ${gameTime}.`;
  await sendSMS(phone, message);
}

export async function sendSpareCancellationSMS(
  phone: string,
  responderName: string,
  gameDate: string,
  gameTime: string
): Promise<void> {
  const message = `Triangle Curling: ${responderName} has canceled sparing for you on ${gameDate} at ${gameTime}. Check your email for details.`;
  await sendSMS(phone, message);
}

