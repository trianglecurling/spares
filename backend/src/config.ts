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

  azure: {
    connectionString: process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '',
    senderEmail: process.env.AZURE_COMMUNICATION_SENDER_EMAIL || 'noreply@tccnc.club',
  },

  /**
   * Optional SMTP (e.g. local Mailpit: host 127.0.0.1, port 1025).
   * When `smtp.host` is set, outgoing mail uses this transport and takes precedence over Azure.
   */
  smtp: {
    host: (process.env.SMTP_HOST || '').trim(),
    port: parseIntEnv(process.env.SMTP_PORT, 1025),
    secure: parseBooleanEnv(process.env.SMTP_SECURE, false),
    user: (process.env.SMTP_USER || '').trim(),
    pass: (process.env.SMTP_PASS || '').trim(),
    /** Defaults to the Azure sender email env so one address can serve both paths */
    from: (process.env.SMTP_FROM || process.env.AZURE_COMMUNICATION_SENDER_EMAIL || 'noreply@tccnc.club').trim(),
  },

  /**
   * When server test mode is on, email is sent via SMTP to this host:port (e.g. Mailpit).
   * Defaults match local Mailpit: 127.0.0.1:1025.
   */
  testMailer: {
    smtpHost: (process.env.TEST_MAILER_SMTP_HOST || '127.0.0.1').trim() || '127.0.0.1',
    smtpPort: parseIntEnv(process.env.TEST_MAILER_SMTP_PORT, 1025),
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

  /**
   * Mautic (https://mautic.org) — public mailing-list sign-ups via OAuth2 client credentials.
   * Full base URL of the Mautic web app, **including a path** if Mautic is not at the domain root
   * (e.g. `https://mail.example.com` or `https://example.com/mautic`). No trailing slash.
   * Segment IDs are Mautic segment (static list) IDs.
   */
  mautic: {
    baseUrl: (process.env.MAUTIC_BASE_URL || '').trim().replace(/\/$/, ''),
    oauthClientId: (process.env.MAUTIC_OAUTH_CLIENT_ID || '').trim(),
    oauthClientSecret: (process.env.MAUTIC_OAUTH_CLIENT_SECRET || '').trim(),
    segmentIds: {
      bonspiels: parseIntEnv(process.env.MAUTIC_SEGMENT_ID_BONSPIELS, 0),
      membership: parseIntEnv(process.env.MAUTIC_SEGMENT_ID_MEMBERSHIP, 0),
      learnToCurl: parseIntEnv(process.env.MAUTIC_SEGMENT_ID_LEARN_TO_CURL, 0),
    },
  },
};

