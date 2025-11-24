import { getDatabaseConfig as getDbConfigFromFile, DatabaseConfig, isDatabaseConfigured } from './config.js';
import { getDrizzleDb, resetDrizzleDb } from './drizzle-db.js';
import { createSchema, createSchemaSync } from './schema.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { sql } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbConfig: DatabaseConfig | null = null;

// Reset database state (useful when reinitializing)
export function resetDatabaseState(): void {
  dbConfig = null;
  resetDrizzleDb();
}

export function getDatabaseConfig(): DatabaseConfig | null {
  if (dbConfig) {
    return dbConfig;
  }
  return getDbConfigFromFile();
}

export async function initializeDatabase(config?: DatabaseConfig): Promise<void> {
  const configToUse = config || getDbConfigFromFile();
  
  if (!configToUse) {
    throw new Error('Database configuration not found');
  }

  dbConfig = configToUse;
  
  // Reset Drizzle DB to pick up new config
  resetDrizzleDb();
  
  // Get Drizzle instance (this will initialize the connection)
  const { db, schema } = getDrizzleDb();
  
  // Use Drizzle's push to sync schema (creates tables if they don't exist)
  // Import the appropriate schema based on database type
  if (configToUse.type === 'sqlite') {
    const { sqliteSchema } = await import('./drizzle-schema.js');
    await db.run(sql`PRAGMA foreign_keys = ON`);
    // Use Drizzle Kit's push for SQLite - but for now, use the old schema creation
    // since it handles migrations better
    const { SQLiteAdapter } = await import('./sqlite-adapter.js');
    const dbPath = configToUse.sqlite?.path || path.join(__dirname, '../../data/spares.sqlite');
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const adapter = new SQLiteAdapter(dbPath);
    await createSchema(adapter);
    adapter.close();
  } else {
    // For PostgreSQL, use the old schema creation for now (handles migrations)
    const { PostgresAdapter } = await import('./postgres-adapter.js');
    if (!configToUse.postgres) {
      throw new Error('PostgreSQL configuration missing');
    }
    const adapter = new PostgresAdapter(configToUse.postgres);
    await createSchema(adapter);
    await adapter.close();
  }
}

// Legacy functions - kept for backward compatibility but deprecated
// All new code should use getDrizzleDb() instead
export function getDatabase(): any {
  // This is deprecated - use getDrizzleDb() instead
  // But we'll return a mock adapter for any remaining code that needs it
  throw new Error('getDatabase() is deprecated. Use getDrizzleDb() instead.');
}

export async function getDatabaseAsync(): Promise<any> {
  // This is deprecated - use getDrizzleDb() instead
  throw new Error('getDatabaseAsync() is deprecated. Use getDrizzleDb() instead.');
}

export async function testDatabaseConnection(config: DatabaseConfig): Promise<void> {
  if (config.type === 'sqlite') {
    const dbPath = config.sqlite?.path || path.join(__dirname, '../../data/spares.sqlite');
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const { SQLiteAdapter } = await import('./sqlite-adapter.js');
    const testDb = new SQLiteAdapter(dbPath);
    testDb.close();
  } else if (config.type === 'postgres') {
    if (!config.postgres) {
      throw new Error('PostgreSQL configuration missing');
    }
    const { PostgresAdapter } = await import('./postgres-adapter.js');
    const testDb = new PostgresAdapter(config.postgres);
    try {
      await testDb.exec('SELECT 1');
    } finally {
      await testDb.close();
    }
  } else {
    throw new Error(`Unsupported database type: ${config.type}`);
  }
}

export function closeDatabase(): void | Promise<void> {
  // Drizzle handles connection pooling, so we don't need to close manually
  // But we can reset the state
  resetDrizzleDb();
}

// Helper function to execute database operations that may be sync or async
export async function dbExec(sql: string): Promise<void> {
  const database = await getDatabaseAsync();
  const result = database.exec(sql);
  if (result instanceof Promise) {
    await result;
  }
}

// Helper function to prepare statements
export function dbPrepare(sql: string) {
  const database = getDatabase();
  return database.prepare(sql);
}

export async function dbPrepareAsync(sql: string) {
  const database = await getDatabaseAsync();
  return database.prepare(sql);
}

// Helper functions to execute queries that work with both sync and async databases
export async function dbAll(stmt: any, ...params: any[]): Promise<any[]> {
  const result = stmt.all(...params);
  if (result instanceof Promise) {
    return await result;
  }
  return result;
}

export async function dbGet(stmt: any, ...params: any[]): Promise<any> {
  const result = stmt.get(...params);
  if (result instanceof Promise) {
    return await result;
  }
  return result;
}

export async function dbRun(stmt: any, ...params: any[]): Promise<{ lastInsertRowid?: number | bigint; changes: number }> {
  const result = stmt.run(...params);
  if (result instanceof Promise) {
    return await result;
  }
  return result;
}
