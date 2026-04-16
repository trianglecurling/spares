import dotenv from 'dotenv';

dotenv.config();

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'change-this-secret-key',
  databasePath: process.env.DATABASE_PATH || './data/spares.sqlite',
  fileStoragePath: process.env.FILE_STORAGE_PATH || './data/uploads',
  timeZone: process.env.TIME_ZONE || 'America/New_York',
  
  admins: (process.env.SERVER_ADMINS || '').split(',').map(email => email.trim()).filter(Boolean),
  
  azure: {
    connectionString: process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '',
    senderEmail: process.env.AZURE_COMMUNICATION_SENDER_EMAIL || 'noreply@tccnc.club',
  },
  
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
  },

  payment: {
    enabledProviders:
      parseCsvEnv(process.env.PAYMENT_ENABLED_PROVIDERS).length > 0
        ? parseCsvEnv(process.env.PAYMENT_ENABLED_PROVIDERS)
        : ['stripe'],
    defaultProvider: process.env.PAYMENT_DEFAULT_PROVIDER || 'stripe',
    providers: {
      stripe: {
        apiKey: process.env.STRIPE_API_KEY || '',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
      },
      paypal: {
        clientId: process.env.PAYPAL_CLIENT_ID || '',
        clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
        webhookSecret: process.env.PAYPAL_WEBHOOK_SECRET || '',
      },
      square: {
        accessToken: process.env.SQUARE_ACCESS_TOKEN || '',
        webhookSecret: process.env.SQUARE_WEBHOOK_SECRET || '',
      },
    },
    webhookTestDelayMs: Math.max(0, parseIntEnv(process.env.PAYMENT_WEBHOOK_TEST_DELAY_MS, 0)),
    reconcile: {
      enabled: parseBooleanEnv(process.env.PAYMENT_RECONCILE_ENABLED, true),
      intervalMs: Math.max(5_000, parseIntEnv(process.env.PAYMENT_RECONCILE_INTERVAL_MS, 60_000)),
      staleAfterSeconds: Math.max(10, parseIntEnv(process.env.PAYMENT_RECONCILE_STALE_AFTER_SECONDS, 120)),
      maxPendingAgeSeconds: Math.max(0, parseIntEnv(process.env.PAYMENT_RECONCILE_MAX_PENDING_AGE_SECONDS, 0)),
      batchSize: Math.max(1, Math.min(200, parseIntEnv(process.env.PAYMENT_RECONCILE_BATCH_SIZE, 25))),
    },
  },

  cleverWaiver: {
    baseUrl: (process.env.CLEVERWAIVER_BASE_URL || 'https://app.cleverwaiver.com').replace(/\/$/, ''),
    appName: process.env.CLEVERWAIVER_APP_NAME || '',
    clientId: process.env.CLEVERWAIVER_CLIENT_ID || '',
    accessToken: process.env.CLEVERWAIVER_ACCESS_TOKEN || '',
  },
};

