import { drizzle } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { getDatabaseConfig } from './config.js';
import * as sqliteSchema from './drizzle-schema.js';
import * as pgSchema from './drizzle-schema.js';

let dbInstance: any = null;
let schema: any = null;

export function getDrizzleDb() {
  if (dbInstance) {
    return { db: dbInstance, schema };
  }

  const config = getDatabaseConfig();
  if (!config) {
    throw new Error('Database not configured. Run installation first.');
  }

  if (config.type === 'sqlite') {
    const dbPath = config.sqlite?.path || './data/spares.sqlite';
    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    
    dbInstance = drizzle(sqlite);
    schema = {
      members: sqliteSchema.membersSqlite,
      authCodes: sqliteSchema.authCodesSqlite,
      authTokens: sqliteSchema.authTokensSqlite,
      leagues: sqliteSchema.leaguesSqlite,
      leagueDrawTimes: sqliteSchema.leagueDrawTimesSqlite,
      memberAvailability: sqliteSchema.memberAvailabilitySqlite,
      spareRequests: sqliteSchema.spareRequestsSqlite,
      spareRequestInvitations: sqliteSchema.spareRequestInvitationsSqlite,
      spareResponses: sqliteSchema.spareResponsesSqlite,
      serverConfig: sqliteSchema.serverConfigSqlite,
      spareRequestNotificationQueue: sqliteSchema.spareRequestNotificationQueueSqlite,
    };
  } else if (config.type === 'postgres') {
    if (!config.postgres) {
      throw new Error('PostgreSQL configuration missing');
    }
    
    const pool = new Pool({
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.username,
      password: config.postgres.password,
      ssl: config.postgres.ssl ? { rejectUnauthorized: false } : false,
    });
    
    dbInstance = drizzlePg(pool);
    schema = {
      members: pgSchema.membersPg,
      authCodes: pgSchema.authCodesPg,
      authTokens: pgSchema.authTokensPg,
      leagues: pgSchema.leaguesPg,
      leagueDrawTimes: pgSchema.leagueDrawTimesPg,
      memberAvailability: pgSchema.memberAvailabilityPg,
      spareRequests: pgSchema.spareRequestsPg,
      spareRequestInvitations: pgSchema.spareRequestInvitationsPg,
      spareResponses: pgSchema.spareResponsesPg,
      serverConfig: pgSchema.serverConfigPg,
      spareRequestNotificationQueue: pgSchema.spareRequestNotificationQueuePg,
    };
  } else {
    throw new Error(`Unsupported database type: ${(config as any).type}`);
  }

  return { db: dbInstance, schema };
}

export function resetDrizzleDb() {
  dbInstance = null;
  schema = null;
}

