import { eq } from 'drizzle-orm';
import { getPublicBootstrap } from '../domains/public/queries/publicReadFacade.js';
import { getDrizzleDb } from '../db/drizzle-db.js';

export type PublicBootstrapPayload = Awaited<ReturnType<typeof getPublicBootstrap>>;

type CacheEntry = {
  generation: number;
  payload: PublicBootstrapPayload;
  builtAt: number;
};

let generationCounter = 0;
let shellCache: CacheEntry | null = null;
let homeCache: CacheEntry | null = null;
let staleShellCache: CacheEntry | null = null;
let staleHomeCache: CacheEntry | null = null;
let rebuildPromise: Promise<void> | null = null;
let scheduledInvalidationTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledInvalidationAt: number | null = null;

/** Node.js setTimeout maximum delay (~24.8 days). */
const MAX_SET_TIMEOUT_MS = 2_147_483_647;

function clearScheduledInvalidation(): void {
  if (scheduledInvalidationTimer != null) {
    clearTimeout(scheduledInvalidationTimer);
    scheduledInvalidationTimer = null;
  }
  scheduledInvalidationAt = null;
}

function parseTimestampMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function parseDateOnlyMs(value: string | Date | null | undefined, endOfDay: boolean): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    if (endOfDay) {
      return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59, 999);
    }
    return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
  const parsed = new Date(`${value.trim()}${suffix}`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

async function loadTimedInvalidationCandidates(homePayload: PublicBootstrapPayload): Promise<number[]> {
  const now = Date.now();
  const candidates: number[] = [];

  const { db, schema } = getDrizzleDb();
  const [siteConfigRow, sponsorshipRows] = await Promise.all([
    db
      .select({
        announcementMarkdown: schema.siteConfig.announcement_markdown,
        announcementExpiresAt: schema.siteConfig.announcement_expires_at,
      })
      .from(schema.siteConfig)
      .where(eq(schema.siteConfig.id, 1))
      .limit(1),
    db
      .select({
        startDate: schema.sponsorships.start_date,
        endDate: schema.sponsorships.end_date,
      })
      .from(schema.sponsorships),
  ]);

  const siteConfig = siteConfigRow[0];
  if (siteConfig?.announcementMarkdown?.trim()) {
    const expiresMs = parseTimestampMs(siteConfig.announcementExpiresAt);
    if (expiresMs != null && expiresMs > now) {
      candidates.push(expiresMs);
    }
  }

  for (const row of sponsorshipRows) {
    const startMs = parseDateOnlyMs(row.startDate, false);
    if (startMs != null && startMs > now) {
      candidates.push(startMs);
    }
    const endMs = parseDateOnlyMs(row.endDate, true);
    if (endMs != null && endMs > now) {
      candidates.push(endMs + 1);
    }
  }

  const bonspiels = homePayload.home?.upcomingBonspiels ?? [];
  for (const bonspiel of bonspiels) {
    const startMs = parseTimestampMs(bonspiel.start);
    if (startMs != null && startMs > now) {
      candidates.push(startMs);
    }
    const endMs = parseTimestampMs(bonspiel.end);
    if (endMs != null && endMs > now) {
      candidates.push(endMs + 1);
    }
  }

  return candidates;
}

function armInvalidationTimer(): void {
  if (scheduledInvalidationAt == null) return;

  const delayMs = Math.max(0, scheduledInvalidationAt - Date.now());
  const cappedDelay = Math.min(delayMs, MAX_SET_TIMEOUT_MS);

  scheduledInvalidationTimer = setTimeout(() => {
    scheduledInvalidationTimer = null;
    if (scheduledInvalidationAt == null) return;

    const remaining = scheduledInvalidationAt - Date.now();
    if (remaining > MAX_SET_TIMEOUT_MS) {
      armInvalidationTimer();
      return;
    }

    scheduledInvalidationAt = null;
    invalidatePublicBootstrapCache('timed');
  }, cappedDelay);
}

function scheduleTimedInvalidation(homePayload: PublicBootstrapPayload): void {
  clearScheduledInvalidation();
  void loadTimedInvalidationCandidates(homePayload)
    .then((candidates) => {
      if (candidates.length === 0) return;
      scheduledInvalidationAt = Math.min(...candidates);
      armInvalidationTimer();
    })
    .catch((error) => {
      console.error('Failed to schedule public bootstrap cache invalidation:', error);
    });
}

async function rebuildCaches(): Promise<void> {
  const [shellPayload, homePayload] = await Promise.all([
    getPublicBootstrap(false),
    getPublicBootstrap(true),
  ]);

  generationCounter += 1;
  const builtAt = Date.now();
  shellCache = { generation: generationCounter, payload: shellPayload, builtAt };
  homeCache = { generation: generationCounter, payload: homePayload, builtAt };
  staleShellCache = null;
  staleHomeCache = null;

  scheduleTimedInvalidation(homePayload);
}

export function getPublicBootstrapCacheEtag(includeHome: boolean): string {
  const entry = includeHome ? homeCache : shellCache;
  return `"bootstrap-${entry?.generation ?? 0}"`;
}

export async function warmPublicBootstrapCache(): Promise<void> {
  if (rebuildPromise) {
    await rebuildPromise;
    return;
  }

  rebuildPromise = rebuildCaches()
    .catch((error) => {
      console.error('Failed to warm public bootstrap cache:', error);
      throw error;
    })
    .finally(() => {
      rebuildPromise = null;
    });

  await rebuildPromise;
}

export function invalidatePublicBootstrapCache(_reason?: string): void {
  if (shellCache) staleShellCache = shellCache;
  if (homeCache) staleHomeCache = homeCache;
  shellCache = null;
  homeCache = null;
  clearScheduledInvalidation();

  if (!rebuildPromise) {
    void warmPublicBootstrapCache().catch(() => {
      // Errors are logged in warmPublicBootstrapCache.
    });
  }
}

export async function getCachedPublicBootstrap(includeHome: boolean): Promise<PublicBootstrapPayload> {
  const cache = includeHome ? homeCache : shellCache;
  if (cache) {
    return cache.payload;
  }

  const stale = includeHome ? staleHomeCache : staleShellCache;
  if (stale && rebuildPromise) {
    return stale.payload;
  }

  if (rebuildPromise) {
    await rebuildPromise;
    const rebuilt = includeHome ? homeCache : shellCache;
    if (rebuilt) return rebuilt.payload;
    if (stale) return stale.payload;
    throw new Error('Public bootstrap cache unavailable after rebuild');
  }

  await warmPublicBootstrapCache();
  const built = includeHome ? homeCache : shellCache;
  if (built) return built.payload;
  if (stale) return stale.payload;
  throw new Error('Public bootstrap cache unavailable');
}
