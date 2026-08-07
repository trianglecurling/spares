/**
 * In-process abuse controls for a single-node deploy (rate counters, send budgets, tarpit).
 * Not shared across processes — pair with nginx/Cloudflare limits at the edge.
 */

import { config } from '../config.js';

export const DEFAULT_JWT_SECRET = 'change-this-secret-key';

/** Normalize IPv4-mapped IPv6 and trim for allowlist matching. */
export function normalizeClientIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  if (trimmed.startsWith('::ffff:')) return trimmed.slice('::ffff:'.length);
  return trimmed;
}

/** True when this client IP should skip per-IP rate limits / connection caps. */
export function isIpLimitBypassed(ip: string | undefined | null): boolean {
  if (!ip) return false;
  const normalized = normalizeClientIp(ip);
  return config.ipLimitBypassAllowlist.some((entry) => normalizeClientIp(entry) === normalized);
}

const VERIFY_FAIL_MAX = 8;
const VERIFY_FAIL_WINDOW_MS = 15 * 60 * 1000;

type CounterEntry = {
  count: number;
  resetAt: number;
};

const verifyFailCounters = new Map<string, CounterEntry>();

function pruneMap(map: Map<string, CounterEntry>, now: number): void {
  if (map.size < 2000) return;
  for (const [key, entry] of map) {
    if (entry.resetAt <= now) map.delete(key);
  }
}

export function authVerifyFailKey(ip: string, contact: string): string {
  return `${ip}|${contact.trim().toLowerCase()}`;
}

export function isAuthVerifyLockedOut(key: string, now = Date.now()): boolean {
  const entry = verifyFailCounters.get(key);
  if (!entry) return false;
  if (entry.resetAt <= now) {
    verifyFailCounters.delete(key);
    return false;
  }
  return entry.count >= VERIFY_FAIL_MAX;
}

export function recordAuthVerifyFailure(key: string, now = Date.now()): void {
  pruneMap(verifyFailCounters, now);
  const existing = verifyFailCounters.get(key);
  if (!existing || existing.resetAt <= now) {
    verifyFailCounters.set(key, { count: 1, resetAt: now + VERIFY_FAIL_WINDOW_MS });
    return;
  }
  existing.count += 1;
}

export function clearAuthVerifyFailures(key: string): void {
  verifyFailCounters.delete(key);
}

export type SendBudgetKind = 'otp' | 'contact_confirm' | 'public' | 'staff';

type SendBudgetOptions = {
  kind: SendBudgetKind;
  recipient: string;
  /** When true, budget exceed logs but still allows send (staff paths). */
  failOpen?: boolean;
};

const SEND_HOURLY_CAP = 200;
const SEND_DAILY_CAP = 2000;

const COOLDOWN_MS: Record<SendBudgetKind, number> = {
  otp: 60_000,
  contact_confirm: 5 * 60_000,
  public: 30_000,
  staff: 0,
};

const sendBudgetState = {
  hourly: new Map<string, number>(),
  daily: new Map<string, number>(),
  cooldowns: new Map<string, number>(),
  hourBucket: '',
  dayBucket: '',
};

function hourBucket(now: number): string {
  return new Date(now).toISOString().slice(0, 13);
}

function dayBucket(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function ensureSendBuckets(now: number): void {
  const hour = hourBucket(now);
  const day = dayBucket(now);
  if (sendBudgetState.hourBucket !== hour) {
    sendBudgetState.hourly.clear();
    sendBudgetState.hourBucket = hour;
  }
  if (sendBudgetState.dayBucket !== day) {
    sendBudgetState.daily.clear();
    sendBudgetState.dayBucket = day;
  }
}

export type SendBudgetResult = { ok: true } | { ok: false; reason: string };

/**
 * Check-and-consume send budget. Call immediately before a real provider send.
 * Logged/disabled/test paths that do not hit the provider should skip this.
 */
export function consumeSendBudget(options: SendBudgetOptions, now = Date.now()): SendBudgetResult {
  ensureSendBuckets(now);
  const recipient = options.recipient.trim().toLowerCase();
  const cooldownMs = COOLDOWN_MS[options.kind];
  if (cooldownMs > 0) {
    const cooldownKey = `${options.kind}:${recipient}`;
    const until = sendBudgetState.cooldowns.get(cooldownKey) ?? 0;
    if (until > now) {
      const reason = `recipient_cooldown:${options.kind}`;
      if (options.failOpen) {
        console.warn(`[SendBudget] ${reason} for ${recipient} (fail-open)`);
        return { ok: true };
      }
      return { ok: false, reason };
    }
  }

  const hourCount = sendBudgetState.hourly.get('global') ?? 0;
  if (hourCount >= SEND_HOURLY_CAP) {
    const reason = 'hourly_cap';
    if (options.failOpen) {
      console.warn(`[SendBudget] ${reason} (fail-open)`);
      return { ok: true };
    }
    return { ok: false, reason };
  }

  const dayCount = sendBudgetState.daily.get('global') ?? 0;
  if (dayCount >= SEND_DAILY_CAP) {
    const reason = 'daily_cap';
    if (options.failOpen) {
      console.warn(`[SendBudget] ${reason} (fail-open)`);
      return { ok: true };
    }
    return { ok: false, reason };
  }

  sendBudgetState.hourly.set('global', hourCount + 1);
  sendBudgetState.daily.set('global', dayCount + 1);
  if (cooldownMs > 0) {
    sendBudgetState.cooldowns.set(`${options.kind}:${recipient}`, now + cooldownMs);
  }
  return { ok: true };
}

export async function tarpitDelay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Generic sliding-window counter for email/IP keys outside @fastify/rate-limit. */
const slidingCounters = new Map<string, CounterEntry>();

export function consumeSlidingWindowLimit(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now()
): { ok: true } | { ok: false } {
  pruneMap(slidingCounters, now);
  const existing = slidingCounters.get(key);
  if (!existing || existing.resetAt <= now) {
    slidingCounters.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (existing.count >= max) return { ok: false };
  existing.count += 1;
  return { ok: true };
}

export function resetSlidingWindowLimitsForTests(): void {
  slidingCounters.clear();
}

export function honeypotTarpitMs(): number {
  return 1000 + Math.floor(Math.random() * 2000);
}

/** Max inclusive calendar window (start → end) for public/auth calendar feeds. */
export const MAX_CALENDAR_RANGE_MS = 93 * 24 * 60 * 60 * 1000;

export function isCalendarRangeWithinLimit(startIso: string, endIso: string): boolean {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  if (end < start) return false;
  return end - start <= MAX_CALENDAR_RANGE_MS;
}

export function assertProductionJwtSecret(nodeEnv: string, jwtSecret: string): void {
  if (nodeEnv !== 'production') return;
  if (!jwtSecret || jwtSecret === DEFAULT_JWT_SECRET) {
    throw new Error(
      'JWT_SECRET must be set to a strong non-default value when NODE_ENV=production'
    );
  }
}

/** Test helper */
export function resetAbuseProtectionStateForTests(): void {
  verifyFailCounters.clear();
  sendBudgetState.hourly.clear();
  sendBudgetState.daily.clear();
  sendBudgetState.cooldowns.clear();
  sendBudgetState.hourBucket = '';
  sendBudgetState.dayBucket = '';
  slidingCounters.clear();
}
