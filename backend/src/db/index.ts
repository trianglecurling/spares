import { getDatabaseConfig as getDbConfigFromFile, DatabaseConfig } from './config.js';
import { getDrizzleDb, resetDrizzleDb } from './drizzle-db.js';
import { runDatabaseBootstrap } from './bootstrap.js';
import { runDrizzleMigrations } from './migrate-runner.js';
import { ensureRegistrationPriceDiscountSettingsTablesExist } from './registrationSchemaBootstrap.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { sql } from 'drizzle-orm';
import type { DatabaseAdapter, PreparedStatement } from './adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbConfig: DatabaseConfig | null = null;

function resolveDatabaseConfig(config?: DatabaseConfig): DatabaseConfig {
  const configToUse = config || getDbConfigFromFile();

  if (!configToUse) {
    throw new Error('Database configuration not found');
  }

  return configToUse;
}

function ensureDatabaseStorage(config: DatabaseConfig): void {
  if (config.type !== 'sqlite') {
    return;
  }

  const dbPath = config.sqlite?.path || path.join(__dirname, '../data/spares.sqlite');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

function configureDatabase(config?: DatabaseConfig): DatabaseConfig {
  const configToUse = resolveDatabaseConfig(config);

  dbConfig = configToUse;
  resetDrizzleDb();
  ensureDatabaseStorage(configToUse);

  return configToUse;
}

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

export async function connectDatabase(config?: DatabaseConfig): Promise<void> {
  const configToUse = configureDatabase(config);
  const { db } = getDrizzleDb();

  if (configToUse.type === 'postgres') {
    await db.execute(sql`SELECT 1`);
  }
}

export async function verifyDatabaseSchema(): Promise<void> {
  const { db, schema } = getDrizzleDb();

  try {
    await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.members)
      .limit(1);
    await ensureRegistrationPriceDiscountSettingsTablesExist();
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Database schema is not initialized or is missing migrations. Run "bun run db:migrate". (${details})`);
  }
}

export async function initializeDatabase(config?: DatabaseConfig): Promise<void> {
  const configToUse = configureDatabase(config);
  getDrizzleDb();
  await runDrizzleMigrations(configToUse);
  await runDatabaseBootstrap(configToUse);
}

export function getDatabase(): DatabaseAdapter {
  throw new Error('getDatabase() is deprecated. Use getDrizzleDb() instead.');
}

export async function getDatabaseAsync(): Promise<DatabaseAdapter> {
  throw new Error('getDatabaseAsync() is deprecated. Use getDrizzleDb() instead.');
}

export async function testDatabaseConnection(config: DatabaseConfig): Promise<void> {
  if (config.type === 'sqlite') {
    const dbPath = config.sqlite?.path || path.join(__dirname, '../data/spares.sqlite');
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
  resetDrizzleDb();
}

export async function dbExec(sqlStatement: string): Promise<void> {
  const database = await getDatabaseAsync();
  const result = database.exec(sqlStatement);
  if (result instanceof Promise) {
    await result;
  }
}

export function dbPrepare(sqlStatement: string) {
  const database = getDatabase();
  return database.prepare(sqlStatement);
}

export async function dbPrepareAsync(sqlStatement: string) {
  const database = await getDatabaseAsync();
  return database.prepare(sqlStatement);
}

export async function dbAll<T>(stmt: PreparedStatement<T, T[]>, ...params: unknown[]): Promise<T[]> {
  const result = stmt.all(...params);
  if (result instanceof Promise) {
    return await result;
  }
  return result;
}

export async function dbGet<T>(stmt: PreparedStatement<T | null, T[]>, ...params: unknown[]): Promise<T | null> {
  const result = stmt.get(...params);
  if (result instanceof Promise) {
    return await result;
  }
  return result;
}

export async function dbRun(
  stmt: PreparedStatement,
  ...params: unknown[]
): Promise<{ lastInsertRowid?: number | bigint; changes: number }> {
  const result = stmt.run(...params);
  if (result instanceof Promise) {
    return await result;
  }
  return result;
}
