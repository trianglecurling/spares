import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { eq } from 'drizzle-orm';

// Cache for test time to avoid repeated DB queries
let cachedTestTime: string | null | undefined = undefined;
let cacheTimestamp = 0;
let cachePromise: Promise<Date> | null = null;
const CACHE_TTL = 1000; // Cache for 1 second

/**
 * Invalidates the test time cache. Call this when the test time is updated.
 */
export function invalidateTestTimeCache(): void {
  cachedTestTime = undefined;
  cacheTimestamp = 0;
}

/**
 * Async version that properly works with PostgreSQL.
 * This should be used in async contexts.
 */
export async function getCurrentTimeAsync(): Promise<Date> {
  // Try to use cached value first
  const now = Date.now();
  if (cachedTestTime !== undefined && (now - cacheTimestamp) < CACHE_TTL) {
    if (cachedTestTime) {
      return new Date(cachedTestTime);
    }
    return new Date();
  }

  // If there's already a pending request, wait for it
  if (cachePromise) {
    return cachePromise;
  }

  // Create new async request
  cachePromise = (async () => {
    try {
      const config = getDatabaseConfig();
      if (!config) {
        return new Date();
      }

      const { db, schema } = getDrizzleDb();
      const serverConfigs = await db
        .select({ test_current_time: schema.serverConfig.test_current_time })
        .from(schema.serverConfig)
        .where(eq(schema.serverConfig.id, 1))
        .limit(1);

      const testTime = serverConfigs[0]?.test_current_time;
      
      cachedTestTime = testTime ? (testTime instanceof Date ? testTime.toISOString() : testTime) : null;
      cacheTimestamp = Date.now();

      if (cachedTestTime) {
        return new Date(cachedTestTime);
      }
      return new Date();
    } finally {
      cachePromise = null;
    }
  })();

  return cachePromise;
}

/**
 * Gets the current date/time, or the test time if one is set in server config.
 * This allows overriding the current time for testing/debugging purposes.
 * 
 * For PostgreSQL, this function uses an async cache that gets populated by async callers.
 * If the cache is empty, it will return the current time (test override won't work until cache is populated).
 * 
 * For SQLite, this works synchronously as before.
 */
export function getCurrentTime(): Date {
  // Try to use cached value first
  const now = Date.now();
  if (cachedTestTime !== undefined && (now - cacheTimestamp) < CACHE_TTL) {
    if (cachedTestTime) {
      return new Date(cachedTestTime);
    }
    return new Date();
  }

  const config = getDatabaseConfig();
  if (config?.type === 'sqlite') {
    // Use SQLite adapter synchronously
    const { SQLiteAdapter } = require('../db/sqlite-adapter.js');
    const dbPath = config.sqlite?.path || './data/spares.sqlite';
    const db = new SQLiteAdapter(dbPath);
    const serverConfig = db.prepare('SELECT test_current_time FROM server_config WHERE id = 1').get() as {
      test_current_time: string | null;
    } | undefined;
    db.close();
    
    cachedTestTime = serverConfig?.test_current_time || null;
    cacheTimestamp = now;
    
    if (cachedTestTime) {
      return new Date(cachedTestTime);
    }
    return new Date();
  } else {
    // For PostgreSQL, use cached value if available, otherwise return current time
    // The cache will be populated by async callers using getCurrentTimeAsync()
    if (cachedTestTime !== undefined) {
      if (cachedTestTime) {
        return new Date(cachedTestTime);
      }
      return new Date();
    }
    // Cache not yet populated - return current time (will be updated when async callers run)
    return new Date();
  }
}

/**
 * Gets the current date as a YYYY-MM-DD string (for SQL DATE comparisons)
 */
export function getCurrentDateString(): string {
  return getCurrentTime().toISOString().split('T')[0];
}

/**
 * Async version of getCurrentDateString() for use in async contexts
 */
export async function getCurrentDateStringAsync(): Promise<string> {
  const time = await getCurrentTimeAsync();
  return time.toISOString().split('T')[0];
}

/**
 * Gets the current timestamp as an ISO string (for SQL DATETIME)
 */
export function getCurrentTimestamp(): string {
  return getCurrentTime().toISOString();
}

/**
 * Async version of getCurrentTimestamp() for use in async contexts
 */
export async function getCurrentTimestampAsync(): Promise<string> {
  const time = await getCurrentTimeAsync();
  return time.toISOString();
}

