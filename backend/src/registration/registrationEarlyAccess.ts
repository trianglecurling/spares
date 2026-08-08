import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';

const SINGLETON_SCOPE = 'singleton';
const EARLY_ACCESS_HEADER = 'x-registration-early-access';
const UNLOCK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const REQUEST_UNLOCKED_KEY = 'registrationEarlyAccessUnlocked';

type EarlyAccessAlsStore = { unlocked: boolean };

const earlyAccessAls = new AsyncLocalStorage<EarlyAccessAlsStore>();

export const REGISTRATION_EARLY_ACCESS_PATH = '/registration/start/early';
export const REGISTRATION_EARLY_ACCESS_HEADER = EARLY_ACCESS_HEADER;

type EarlyAccessDecoratedRequest = FastifyRequest & {
  [REQUEST_UNLOCKED_KEY]?: boolean;
};

export class RegistrationEarlyAccessValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Early access validation failed');
  }
}

type EarlyAccessSettingsRow = {
  scope: string;
  enabled: number;
  password_hash: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecodeToString(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signPayload(payloadB64: string): string {
  return base64UrlEncode(crypto.createHmac('sha256', config.jwtSecret).update(payloadB64).digest());
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPasswordHash(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function passwordFingerprint(passwordHash: string): string {
  return crypto.createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
}

function normalizeDateTime(value: string | Date | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : String(value);
}

export function isEarlyAccessUnlockedInRequest(request?: FastifyRequest): boolean {
  if (request && (request as EarlyAccessDecoratedRequest)[REQUEST_UNLOCKED_KEY] === true) {
    return true;
  }
  return earlyAccessAls.getStore()?.unlocked === true;
}

export function enterEarlyAccessRequestContext(unlocked: boolean): void {
  earlyAccessAls.enterWith({ unlocked });
}

export function readEarlyAccessUnlockTokenFromRequest(
  headers: FastifyRequest['headers'] | Record<string, unknown> | undefined,
): string | null {
  if (!headers) return null;
  const raw =
    (headers as Record<string, unknown>)[EARLY_ACCESS_HEADER] ??
    (headers as Record<string, unknown>)[EARLY_ACCESS_HEADER.toUpperCase()];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

/**
 * Bind early-access unlock into the Fastify request lifecycle.
 * Uses AsyncLocalStorage.run(done) so GET handlers inherit the context, and also
 * decorates the request so route handlers can pass unlock state explicitly
 * (async onRequest + enterWith after await loses the store across hooks).
 */
export function bindEarlyAccessOnRequest(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: (err?: Error) => void,
): void {
  const token = readEarlyAccessUnlockTokenFromRequest(request.headers);
  void verifyEarlyAccessUnlockToken(token)
    .then((unlocked) => {
      (request as EarlyAccessDecoratedRequest)[REQUEST_UNLOCKED_KEY] = unlocked;
      earlyAccessAls.run({ unlocked }, () => {
        done();
      });
    })
    .catch((error: unknown) => {
      done(error instanceof Error ? error : new Error(String(error)));
    });
}

export async function loadOrInsertRegistrationEarlyAccessSettings(): Promise<EarlyAccessSettingsRow> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select()
    .from(schema.registrationEarlyAccessSettings)
    .where(eq(schema.registrationEarlyAccessSettings.scope, SINGLETON_SCOPE))
    .limit(1);
  if (existing[0]) return existing[0];

  await db
    .insert(schema.registrationEarlyAccessSettings)
    .values({
      scope: SINGLETON_SCOPE,
      enabled: 0,
      password_hash: null,
    })
    .onConflictDoNothing();

  const created = await db
    .select()
    .from(schema.registrationEarlyAccessSettings)
    .where(eq(schema.registrationEarlyAccessSettings.scope, SINGLETON_SCOPE))
    .limit(1);
  if (!created[0]) {
    throw new Error('Could not load registration_early_access_settings singleton row.');
  }
  return created[0];
}

export function mapEarlyAccessSettingsToAdminResponse(row: EarlyAccessSettingsRow) {
  return {
    enabled: row.enabled === 1,
    passwordConfigured: Boolean(row.password_hash?.trim()),
    earlyAccessPath: REGISTRATION_EARLY_ACCESS_PATH,
    createdAt: normalizeDateTime(row.created_at),
    updatedAt: normalizeDateTime(row.updated_at),
  };
}

export async function getRegistrationEarlyAccessAdminSettings() {
  const row = await loadOrInsertRegistrationEarlyAccessSettings();
  return mapEarlyAccessSettingsToAdminResponse(row);
}

export async function updateRegistrationEarlyAccessSettings(input: {
  enabled?: boolean;
  password?: string | null;
}) {
  const row = await loadOrInsertRegistrationEarlyAccessSettings();
  const nextEnabled = input.enabled ?? row.enabled === 1;
  let nextPasswordHash = row.password_hash;

  if (input.password !== undefined) {
    if (input.password === null || input.password === '') {
      nextPasswordHash = null;
    } else {
      const trimmed = input.password.trim();
      if (trimmed.length < MIN_PASSWORD_LENGTH) {
        throw new RegistrationEarlyAccessValidationError({
          password: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        });
      }
      nextPasswordHash = hashPassword(trimmed);
    }
  }

  if (nextEnabled && !nextPasswordHash?.trim()) {
    throw new RegistrationEarlyAccessValidationError({
      password: 'Set a password before enabling early access.',
    });
  }

  const { db, schema } = getDrizzleDb();
  const [updated] = await db
    .update(schema.registrationEarlyAccessSettings)
    .set({
      enabled: nextEnabled ? 1 : 0,
      password_hash: nextPasswordHash,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.registrationEarlyAccessSettings.scope, SINGLETON_SCOPE))
    .returning();

  return mapEarlyAccessSettingsToAdminResponse(updated ?? (await loadOrInsertRegistrationEarlyAccessSettings()));
}

export async function isRegistrationEarlyAccessActive(): Promise<boolean> {
  const row = await loadOrInsertRegistrationEarlyAccessSettings();
  return row.enabled === 1 && Boolean(row.password_hash?.trim());
}

export async function createEarlyAccessUnlockToken(password: string): Promise<{ unlockToken: string; expiresAt: string }> {
  const row = await loadOrInsertRegistrationEarlyAccessSettings();
  if (row.enabled !== 1 || !row.password_hash?.trim()) {
    throw new RegistrationEarlyAccessValidationError({
      password: 'Early access is not available.',
    });
  }
  if (!verifyPasswordHash(password, row.password_hash)) {
    throw new RegistrationEarlyAccessValidationError({
      password: 'Incorrect password.',
    });
  }

  const exp = Date.now() + UNLOCK_TTL_MS;
  const payload = {
    v: 1,
    exp,
    ph: passwordFingerprint(row.password_hash),
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const unlockToken = `${payloadB64}.${signPayload(payloadB64)}`;
  return { unlockToken, expiresAt: new Date(exp).toISOString() };
}

export async function verifyEarlyAccessUnlockToken(token: string | null | undefined): Promise<boolean> {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payloadB64, sig] = token.split('.', 2);
  if (!payloadB64 || !sig) return false;

  const expectedSig = signPayload(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  let payload: { v?: number; exp?: number; ph?: string };
  try {
    payload = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch {
    return false;
  }

  if (payload.v !== 1 || typeof payload.exp !== 'number' || typeof payload.ph !== 'string') {
    return false;
  }
  if (Date.now() > payload.exp) return false;

  const row = await loadOrInsertRegistrationEarlyAccessSettings();
  if (row.enabled !== 1 || !row.password_hash?.trim()) return false;
  return payload.ph === passwordFingerprint(row.password_hash);
}

export async function applyEarlyAccessOverlayToWindowState(
  state: 'closed' | 'priority' | 'open',
  options?: { unlocked?: boolean; request?: FastifyRequest },
): Promise<'closed' | 'priority' | 'open'> {
  if (state !== 'closed') return state;
  const unlocked = options?.unlocked ?? isEarlyAccessUnlockedInRequest(options?.request);
  if (!unlocked) return state;
  if (!(await isRegistrationEarlyAccessActive())) return state;
  return 'priority';
}
