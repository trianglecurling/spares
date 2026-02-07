import { drizzle } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { getDatabaseConfig } from './config.js';
import * as sqliteSchema from './drizzle-schema.js';
import * as pgSchema from './drizzle-schema.js';

type SqliteSchema = {
  members: typeof sqliteSchema.membersSqlite;
  authCodes: typeof sqliteSchema.authCodesSqlite;
  authTokens: typeof sqliteSchema.authTokensSqlite;
  leagues: typeof sqliteSchema.leaguesSqlite;
  leagueDrawTimes: typeof sqliteSchema.leagueDrawTimesSqlite;
  leagueExceptions: typeof sqliteSchema.leagueExceptionsSqlite;
  sheets: typeof sqliteSchema.sheetsSqlite;
  leagueExtraDraws: typeof sqliteSchema.leagueExtraDrawsSqlite;
  drawSheetAvailability: typeof sqliteSchema.drawSheetAvailabilitySqlite;
  leagueDivisions: typeof sqliteSchema.leagueDivisionsSqlite;
  leagueTeams: typeof sqliteSchema.leagueTeamsSqlite;
  games: typeof sqliteSchema.gamesSqlite;
  leagueSettings: typeof sqliteSchema.leagueSettingsSqlite;
  teamByeRequests: typeof sqliteSchema.teamByeRequestsSqlite;
  gameResults: typeof sqliteSchema.gameResultsSqlite;
  gameLineups: typeof sqliteSchema.gameLineupsSqlite;
  teamMembers: typeof sqliteSchema.teamMembersSqlite;
  leagueMemberRoles: typeof sqliteSchema.leagueMemberRolesSqlite;
  leagueRoster: typeof sqliteSchema.leagueRosterSqlite;
  memberAvailability: typeof sqliteSchema.memberAvailabilitySqlite;
  spareRequests: typeof sqliteSchema.spareRequestsSqlite;
  spareRequestInvitations: typeof sqliteSchema.spareRequestInvitationsSqlite;
  spareRequestCcs: typeof sqliteSchema.spareRequestCcsSqlite;
  spareResponses: typeof sqliteSchema.spareResponsesSqlite;
  serverConfig: typeof sqliteSchema.serverConfigSqlite;
  spareRequestNotificationQueue: typeof sqliteSchema.spareRequestNotificationQueueSqlite;
  spareRequestNotificationDeliveries: typeof sqliteSchema.spareRequestNotificationDeliveriesSqlite;
  feedback: typeof sqliteSchema.feedbackSqlite;
  observabilityEvents: typeof sqliteSchema.observabilityEventsSqlite;
  dailyActivity: typeof sqliteSchema.dailyActivitySqlite;
};

type PgSchema = {
  members: typeof pgSchema.membersPg;
  authCodes: typeof pgSchema.authCodesPg;
  authTokens: typeof pgSchema.authTokensPg;
  leagues: typeof pgSchema.leaguesPg;
  leagueDrawTimes: typeof pgSchema.leagueDrawTimesPg;
  leagueExceptions: typeof pgSchema.leagueExceptionsPg;
  sheets: typeof pgSchema.sheetsPg;
  leagueExtraDraws: typeof pgSchema.leagueExtraDrawsPg;
  drawSheetAvailability: typeof pgSchema.drawSheetAvailabilityPg;
  leagueDivisions: typeof pgSchema.leagueDivisionsPg;
  leagueTeams: typeof pgSchema.leagueTeamsPg;
  games: typeof pgSchema.gamesPg;
  leagueSettings: typeof pgSchema.leagueSettingsPg;
  teamByeRequests: typeof pgSchema.teamByeRequestsPg;
  gameResults: typeof pgSchema.gameResultsPg;
  gameLineups: typeof pgSchema.gameLineupsPg;
  teamMembers: typeof pgSchema.teamMembersPg;
  leagueMemberRoles: typeof pgSchema.leagueMemberRolesPg;
  leagueRoster: typeof pgSchema.leagueRosterPg;
  memberAvailability: typeof pgSchema.memberAvailabilityPg;
  spareRequests: typeof pgSchema.spareRequestsPg;
  spareRequestInvitations: typeof pgSchema.spareRequestInvitationsPg;
  spareRequestCcs: typeof pgSchema.spareRequestCcsPg;
  spareResponses: typeof pgSchema.spareResponsesPg;
  serverConfig: typeof pgSchema.serverConfigPg;
  spareRequestNotificationQueue: typeof pgSchema.spareRequestNotificationQueuePg;
  spareRequestNotificationDeliveries: typeof pgSchema.spareRequestNotificationDeliveriesPg;
  feedback: typeof pgSchema.feedbackPg;
  observabilityEvents: typeof pgSchema.observabilityEventsPg;
  dailyActivity: typeof pgSchema.dailyActivityPg;
};

type DrizzleDb = NodePgDatabase<PgSchema>;
type DrizzleSchema = PgSchema;

let dbInstance: DrizzleDb | null = null;
let schema: DrizzleSchema | null = null;

export function getDrizzleDb(): { db: DrizzleDb; schema: DrizzleSchema } {
  if (dbInstance && schema) {
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
    
    dbInstance = drizzle(sqlite) as unknown as DrizzleDb;
    schema = {
      members: sqliteSchema.membersSqlite,
      authCodes: sqliteSchema.authCodesSqlite,
      authTokens: sqliteSchema.authTokensSqlite,
      leagues: sqliteSchema.leaguesSqlite,
      leagueDrawTimes: sqliteSchema.leagueDrawTimesSqlite,
      leagueExceptions: sqliteSchema.leagueExceptionsSqlite,
      sheets: sqliteSchema.sheetsSqlite,
      leagueExtraDraws: sqliteSchema.leagueExtraDrawsSqlite,
      drawSheetAvailability: sqliteSchema.drawSheetAvailabilitySqlite,
      leagueDivisions: sqliteSchema.leagueDivisionsSqlite,
      leagueTeams: sqliteSchema.leagueTeamsSqlite,
      games: sqliteSchema.gamesSqlite,
      leagueSettings: sqliteSchema.leagueSettingsSqlite,
      teamByeRequests: sqliteSchema.teamByeRequestsSqlite,
      gameResults: sqliteSchema.gameResultsSqlite,
      gameLineups: sqliteSchema.gameLineupsSqlite,
      teamMembers: sqliteSchema.teamMembersSqlite,
      leagueMemberRoles: sqliteSchema.leagueMemberRolesSqlite,
      leagueRoster: sqliteSchema.leagueRosterSqlite,
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
    } as unknown as DrizzleSchema;
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
      sheets: pgSchema.sheetsPg,
      leagueExtraDraws: pgSchema.leagueExtraDrawsPg,
      drawSheetAvailability: pgSchema.drawSheetAvailabilityPg,
      leagueDivisions: pgSchema.leagueDivisionsPg,
      leagueTeams: pgSchema.leagueTeamsPg,
      games: pgSchema.gamesPg,
      leagueSettings: pgSchema.leagueSettingsPg,
      teamByeRequests: pgSchema.teamByeRequestsPg,
      gameResults: pgSchema.gameResultsPg,
      gameLineups: pgSchema.gameLineupsPg,
      teamMembers: pgSchema.teamMembersPg,
      leagueMemberRoles: pgSchema.leagueMemberRolesPg,
      leagueRoster: pgSchema.leagueRosterPg,
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
    } as DrizzleSchema;
  } else {
    throw new Error(`Unsupported database type: ${config.type}`);
  }

  return { db: dbInstance!, schema: schema! };
}

export function resetDrizzleDb() {
  dbInstance = null;
  schema = null;
}

