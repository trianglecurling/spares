import { drizzle } from 'drizzle-orm/bun-sqlite';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Database } from 'bun:sqlite';
import { Pool } from 'pg';
import { getDatabaseConfig } from './config.js';
import * as sqliteSchema from './drizzle-schema.js';
import * as pgSchema from './drizzle-schema.js';

type PgSchema = {
  members: typeof pgSchema.membersPg;
  authCodes: typeof pgSchema.authCodesPg;
  authTokens: typeof pgSchema.authTokensPg;
  roles: typeof pgSchema.rolesPg;
  roleScopeRules: typeof pgSchema.roleScopeRulesPg;
  memberRoleAssignments: typeof pgSchema.memberRoleAssignmentsPg;
  memberAccountAccessDelegations: typeof pgSchema.memberAccountAccessDelegationsPg;
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
  paymentOrders: typeof pgSchema.paymentOrdersPg;
  paymentTransactions: typeof pgSchema.paymentTransactionsPg;
  paymentEvents: typeof pgSchema.paymentEventsPg;
  refunds: typeof pgSchema.refundsPg;
  dailyActivity: typeof pgSchema.dailyActivityPg;
  calendarEvents: typeof pgSchema.calendarEventsPg;
  calendarEventLocations: typeof pgSchema.calendarEventLocationsPg;
  calendarEventExceptions: typeof pgSchema.calendarEventExceptionsPg;
  iceBookings: typeof pgSchema.iceBookingsPg;
  articles: typeof pgSchema.articlesPg;
  articleVersions: typeof pgSchema.articleVersionsPg;
  permalinks: typeof pgSchema.permalinksPg;
  permalinkHits: typeof pgSchema.permalinkHitsPg;
  siteConfig: typeof pgSchema.siteConfigPg;
  showcaseImages: typeof pgSchema.showcaseImagesPg;
  menuItems: typeof pgSchema.menuItemsPg;
  files: typeof pgSchema.filesPg;
  sponsorshipLevels: typeof pgSchema.sponsorshipLevelsPg;
  sponsors: typeof pgSchema.sponsorsPg;
  sponsorships: typeof pgSchema.sponsorshipsPg;
  governanceSettings: typeof pgSchema.governanceSettingsPg;
  governanceBoardMembers: typeof pgSchema.governanceBoardMembersPg;
  governanceCommittees: typeof pgSchema.governanceCommitteesPg;
  governanceCommitteeChairs: typeof pgSchema.governanceCommitteeChairsPg;
  governanceBoardMemberCommittees: typeof pgSchema.governanceBoardMemberCommitteesPg;
  governanceOfficers: typeof pgSchema.governanceOfficersPg;
  eventCategories: typeof pgSchema.eventCategoriesPg;
  events: typeof pgSchema.eventsPg;
  eventTimespans: typeof pgSchema.eventTimespansPg;
  eventLocations: typeof pgSchema.eventLocationsPg;
  eventCategoryAssignments: typeof pgSchema.eventCategoryAssignmentsPg;
  eventOwners: typeof pgSchema.eventOwnersPg;
  eventRegistrationFields: typeof pgSchema.eventRegistrationFieldsPg;
  eventRegistrations: typeof pgSchema.eventRegistrationsPg;
  eventRegistrationMembers: typeof pgSchema.eventRegistrationMembersPg;
  eventRegistrationFieldValues: typeof pgSchema.eventRegistrationFieldValuesPg;
  eventSpecialLinks: typeof pgSchema.eventSpecialLinksPg;
  eventTournamentTeams: typeof pgSchema.eventTournamentTeamsPg;
  eventTournamentRosterSlots: typeof pgSchema.eventTournamentRosterSlotsPg;
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
    sqlite.run('PRAGMA journal_mode = WAL;');
    sqlite.run('PRAGMA foreign_keys = ON;');
    
    dbInstance = drizzle({ client: sqlite }) as unknown as DrizzleDb;
    schema = {
      members: sqliteSchema.membersSqlite,
      authCodes: sqliteSchema.authCodesSqlite,
      authTokens: sqliteSchema.authTokensSqlite,
      roles: sqliteSchema.rolesSqlite,
      roleScopeRules: sqliteSchema.roleScopeRulesSqlite,
      memberRoleAssignments: sqliteSchema.memberRoleAssignmentsSqlite,
      memberAccountAccessDelegations: sqliteSchema.memberAccountAccessDelegationsSqlite,
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
      paymentOrders: sqliteSchema.paymentOrdersSqlite,
      paymentTransactions: sqliteSchema.paymentTransactionsSqlite,
      paymentEvents: sqliteSchema.paymentEventsSqlite,
      refunds: sqliteSchema.refundsSqlite,
      dailyActivity: sqliteSchema.dailyActivitySqlite,
      calendarEvents: sqliteSchema.calendarEventsSqlite,
      calendarEventLocations: sqliteSchema.calendarEventLocationsSqlite,
      calendarEventExceptions: sqliteSchema.calendarEventExceptionsSqlite,
      iceBookings: sqliteSchema.iceBookingsSqlite,
      articles: sqliteSchema.articlesSqlite,
      articleVersions: sqliteSchema.articleVersionsSqlite,
      permalinks: sqliteSchema.permalinksSqlite,
      permalinkHits: sqliteSchema.permalinkHitsSqlite,
      siteConfig: sqliteSchema.siteConfigSqlite,
      showcaseImages: sqliteSchema.showcaseImagesSqlite,
      menuItems: sqliteSchema.menuItemsSqlite,
      files: sqliteSchema.filesSqlite,
      sponsorshipLevels: sqliteSchema.sponsorshipLevelsSqlite,
      sponsors: sqliteSchema.sponsorsSqlite,
      sponsorships: sqliteSchema.sponsorshipsSqlite,
      governanceSettings: sqliteSchema.governanceSettingsSqlite,
      governanceBoardMembers: sqliteSchema.governanceBoardMembersSqlite,
      governanceCommittees: sqliteSchema.governanceCommitteesSqlite,
      governanceCommitteeChairs: sqliteSchema.governanceCommitteeChairsSqlite,
      governanceBoardMemberCommittees: sqliteSchema.governanceBoardMemberCommitteesSqlite,
      governanceOfficers: sqliteSchema.governanceOfficersSqlite,
      eventCategories: sqliteSchema.eventCategoriesSqlite,
      events: sqliteSchema.eventsSqlite,
      eventTimespans: sqliteSchema.eventTimespansSqlite,
      eventLocations: sqliteSchema.eventLocationsSqlite,
      eventCategoryAssignments: sqliteSchema.eventCategoryAssignmentsSqlite,
      eventOwners: sqliteSchema.eventOwnersSqlite,
      eventRegistrationFields: sqliteSchema.eventRegistrationFieldsSqlite,
      eventRegistrations: sqliteSchema.eventRegistrationsSqlite,
      eventRegistrationMembers: sqliteSchema.eventRegistrationMembersSqlite,
      eventRegistrationFieldValues: sqliteSchema.eventRegistrationFieldValuesSqlite,
      eventSpecialLinks: sqliteSchema.eventSpecialLinksSqlite,
      eventTournamentTeams: sqliteSchema.eventTournamentTeamsSqlite,
      eventTournamentRosterSlots: sqliteSchema.eventTournamentRosterSlotsSqlite,
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
      roles: pgSchema.rolesPg,
      roleScopeRules: pgSchema.roleScopeRulesPg,
      memberRoleAssignments: pgSchema.memberRoleAssignmentsPg,
      memberAccountAccessDelegations: pgSchema.memberAccountAccessDelegationsPg,
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
      paymentOrders: pgSchema.paymentOrdersPg,
      paymentTransactions: pgSchema.paymentTransactionsPg,
      paymentEvents: pgSchema.paymentEventsPg,
      refunds: pgSchema.refundsPg,
      dailyActivity: pgSchema.dailyActivityPg,
      calendarEvents: pgSchema.calendarEventsPg,
      calendarEventLocations: pgSchema.calendarEventLocationsPg,
      calendarEventExceptions: pgSchema.calendarEventExceptionsPg,
      iceBookings: pgSchema.iceBookingsPg,
      articles: pgSchema.articlesPg,
      articleVersions: pgSchema.articleVersionsPg,
      permalinks: pgSchema.permalinksPg,
      permalinkHits: pgSchema.permalinkHitsPg,
      siteConfig: pgSchema.siteConfigPg,
      showcaseImages: pgSchema.showcaseImagesPg,
      menuItems: pgSchema.menuItemsPg,
      files: pgSchema.filesPg,
      sponsorshipLevels: pgSchema.sponsorshipLevelsPg,
      sponsors: pgSchema.sponsorsPg,
      sponsorships: pgSchema.sponsorshipsPg,
      governanceSettings: pgSchema.governanceSettingsPg,
      governanceBoardMembers: pgSchema.governanceBoardMembersPg,
      governanceCommittees: pgSchema.governanceCommitteesPg,
      governanceCommitteeChairs: pgSchema.governanceCommitteeChairsPg,
      governanceBoardMemberCommittees: pgSchema.governanceBoardMemberCommitteesPg,
      governanceOfficers: pgSchema.governanceOfficersPg,
      eventCategories: pgSchema.eventCategoriesPg,
      events: pgSchema.eventsPg,
      eventTimespans: pgSchema.eventTimespansPg,
      eventLocations: pgSchema.eventLocationsPg,
      eventCategoryAssignments: pgSchema.eventCategoryAssignmentsPg,
      eventOwners: pgSchema.eventOwnersPg,
      eventRegistrationFields: pgSchema.eventRegistrationFieldsPg,
      eventRegistrations: pgSchema.eventRegistrationsPg,
      eventRegistrationMembers: pgSchema.eventRegistrationMembersPg,
      eventRegistrationFieldValues: pgSchema.eventRegistrationFieldValuesPg,
      eventSpecialLinks: pgSchema.eventSpecialLinksPg,
      eventTournamentTeams: pgSchema.eventTournamentTeamsPg,
      eventTournamentRosterSlots: pgSchema.eventTournamentRosterSlotsPg,
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

