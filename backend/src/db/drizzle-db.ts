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
      leagueExceptions: sqliteSchema.leagueExceptionsSqlite,
      memberAvailability: sqliteSchema.memberAvailabilitySqlite,
      spareRequests: sqliteSchema.spareRequestsSqlite,
      spareRequestInvitations: sqliteSchema.spareRequestInvitationsSqlite,
      spareRequestCcs: sqliteSchema.spareRequestCcsSqlite,
      spareResponses: sqliteSchema.spareResponsesSqlite,
      serverConfig: sqliteSchema.serverConfigSqlite,
      spareRequestNotificationQueue: sqliteSchema.spareRequestNotificationQueueSqlite,
      spareRequestNotificationDeliveries: sqliteSchema.spareRequestNotificationDeliveriesSqlite,
      feedback: sqliteSchema.feedbackSqlite,
      observabilityEvents: sqliteSchema.observabilityEventsSqlite,
      dailyActivity: sqliteSchema.dailyActivitySqlite,
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
      leagueExceptions: pgSchema.leagueExceptionsPg,
      memberAvailability: pgSchema.memberAvailabilityPg,
      spareRequests: pgSchema.spareRequestsPg,
      spareRequestInvitations: pgSchema.spareRequestInvitationsPg,
      spareRequestCcs: pgSchema.spareRequestCcsPg,
      spareResponses: pgSchema.spareResponsesPg,
      serverConfig: pgSchema.serverConfigPg,
      spareRequestNotificationQueue: pgSchema.spareRequestNotificationQueuePg,
      spareRequestNotificationDeliveries: pgSchema.spareRequestNotificationDeliveriesPg,
      feedback: pgSchema.feedbackPg,
      observabilityEvents: pgSchema.observabilityEventsPg,
      dailyActivity: pgSchema.dailyActivityPg,
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

