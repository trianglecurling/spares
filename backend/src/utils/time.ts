import { getDatabaseConfig } from '../db/config.js';

// Cache for test time to avoid repeated DB queries
let cachedTestTime: string | null | undefined = undefined;
let cacheTimestamp = 0;
const CACHE_TTL = 1000; // Cache for 1 second

/**
 * Gets the current date/time, or the test time if one is set in server config.
 * This allows overriding the current time for testing/debugging purposes.
 * Note: This function is synchronous for compatibility, but uses async DB access internally.
 * For PostgreSQL, this will throw an error - use getCurrentTimeAsync() instead.
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

  // For now, use a synchronous approach with the old database adapter
  // This is a temporary solution until we can refactor all callers to be async
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
    // For PostgreSQL, we can't do this synchronously
    // Return current time and log a warning
    console.warn('getCurrentTime() called synchronously with PostgreSQL - test time override may not work');
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
 * Gets the current timestamp as an ISO string (for SQL DATETIME)
 */
export function getCurrentTimestamp(): string {
  return getCurrentTime().toISOString();
}

