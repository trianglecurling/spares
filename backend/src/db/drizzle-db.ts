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
  personalAccessTokens: typeof pgSchema.personalAccessTokensPg;
  webauthnCredentials: typeof pgSchema.webauthnCredentialsPg;
  webauthnChallenges: typeof pgSchema.webauthnChallengesPg;
  roles: typeof pgSchema.rolesPg;
  roleScopeRules: typeof pgSchema.roleScopeRulesPg;
  memberRoleAssignments: typeof pgSchema.memberRoleAssignmentsPg;
  memberAccountAccessDelegations: typeof pgSchema.memberAccountAccessDelegationsPg;
  curlingSeasons: typeof pgSchema.curlingSeasonsPg;
  curlingSessions: typeof pgSchema.curlingSessionsPg;
  leagues: typeof pgSchema.leaguesPg;
  registrationStateTransitions: typeof pgSchema.registrationStateTransitionsPg;
  curlingRegistrations: typeof pgSchema.curlingRegistrationsPg;
  curlingLeagueSabbaticals: typeof pgSchema.curlingLeagueSabbaticalsPg;
  registrationPolicyAcceptances: typeof pgSchema.registrationPolicyAcceptancesPg;
  registrationSelections: typeof pgSchema.registrationSelectionsPg;
  registrationLeaguePriorities: typeof pgSchema.registrationLeaguePrioritiesPg;
  financialAssistanceRequests: typeof pgSchema.financialAssistanceRequestsPg;
  registrationInvoices: typeof pgSchema.registrationInvoicesPg;
  registrationInvoiceLineItems: typeof pgSchema.registrationInvoiceLineItemsPg;
  registrationPaymentItemNames: typeof pgSchema.registrationPaymentItemNamesPg;
  registrationPriceSettings: typeof pgSchema.registrationPriceSettingsPg;
  registrationDiscountSettings: typeof pgSchema.registrationDiscountSettingsPg;
  registrationEarlyAccessSettings: typeof pgSchema.registrationEarlyAccessSettingsPg;
  registrationPaymentDeadlines: typeof pgSchema.registrationPaymentDeadlinesPg;
  seasonMemberships: typeof pgSchema.seasonMembershipsPg;
  curlingIcePrivileges: typeof pgSchema.curlingIcePrivilegesPg;
  curlingSabbaticalSessions: typeof pgSchema.curlingSabbaticalSessionsPg;
  leagueWaitlists: typeof pgSchema.leagueWaitlistsPg;
  waitlistEntries: typeof pgSchema.waitlistEntriesPg;
  waitlistOffers: typeof pgSchema.waitlistOffersPg;
  waitlistAuditEvents: typeof pgSchema.waitlistAuditEventsPg;
  registrationOutboundMessages: typeof pgSchema.registrationOutboundMessagesPg;
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
  leagueEntryPoints: typeof pgSchema.leagueEntryPointsPg;
  leagueEntryTeams: typeof pgSchema.leagueEntryTeamsPg;
  leagueEntryTeamMembers: typeof pgSchema.leagueEntryTeamMembersPg;
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
  outboundEmails: typeof pgSchema.outboundEmailsPg;
  paymentOrders: typeof pgSchema.paymentOrdersPg;
  paymentTransactions: typeof pgSchema.paymentTransactionsPg;
  paymentEvents: typeof pgSchema.paymentEventsPg;
  refunds: typeof pgSchema.refundsPg;
  webhooks: typeof pgSchema.webhooksPg;
  webhookDeliveries: typeof pgSchema.webhookDeliveriesPg;
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
  buildingAccessConfig: typeof pgSchema.buildingAccessConfigPg;
  publicContactRecipients: typeof pgSchema.publicContactRecipientsPg;
  dashboardSections: typeof pgSchema.dashboardSectionsPg;
  mailingLists: typeof pgSchema.mailingListsPg;
  mauticMembershipSyncStatus: typeof pgSchema.mauticMembershipSyncStatusPg;
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
  boardMeetingMinutes: typeof pgSchema.boardMeetingMinutesPg;
  eventCategories: typeof pgSchema.eventCategoriesPg;
  eventTransferGroups: typeof pgSchema.eventTransferGroupsPg;
  events: typeof pgSchema.eventsPg;
  eventTimespans: typeof pgSchema.eventTimespansPg;
  eventLocations: typeof pgSchema.eventLocationsPg;
  eventCategoryAssignments: typeof pgSchema.eventCategoryAssignmentsPg;
  eventOwners: typeof pgSchema.eventOwnersPg;
  eventRegistrationFields: typeof pgSchema.eventRegistrationFieldsPg;
  eventRegistrations: typeof pgSchema.eventRegistrationsPg;
  eventWaitlistOffers: typeof pgSchema.eventWaitlistOffersPg;
  eventRegistrationMembers: typeof pgSchema.eventRegistrationMembersPg;
  eventRegistrationFieldValues: typeof pgSchema.eventRegistrationFieldValuesPg;
  eventSpecialLinks: typeof pgSchema.eventSpecialLinksPg;
  volunteerPrograms: typeof pgSchema.volunteerProgramsPg;
  volunteerProgramManagers: typeof pgSchema.volunteerProgramManagersPg;
  volunteerCredentials: typeof pgSchema.volunteerCredentialsPg;
  volunteerCredentialManagers: typeof pgSchema.volunteerCredentialManagersPg;
  volunteerRoles: typeof pgSchema.volunteerRolesPg;
  volunteerRoleCredentials: typeof pgSchema.volunteerRoleCredentialsPg;
  memberVolunteerCredentials: typeof pgSchema.memberVolunteerCredentialsPg;
  volunteerShifts: typeof pgSchema.volunteerShiftsPg;
  volunteerShiftExceptions: typeof pgSchema.volunteerShiftExceptionsPg;
  volunteerShiftRoles: typeof pgSchema.volunteerShiftRolesPg;
  volunteerSignups: typeof pgSchema.volunteerSignupsPg;
  expenseReports: typeof pgSchema.expenseReportsPg;
  expenseReceipts: typeof pgSchema.expenseReceiptsPg;
  expenseReportNotes: typeof pgSchema.expenseReportNotesPg;
  expenseReportChanges: typeof pgSchema.expenseReportChangesPg;
};

type DrizzleDb = NodePgDatabase<PgSchema>;
type DrizzleSchema = PgSchema;

let dbInstance: DrizzleDb | null = null;
let schema: DrizzleSchema | null = null;
let sqliteClient: Database | null = null;
let pgPool: Pool | null = null;

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
    sqliteClient = sqlite;

    dbInstance = drizzle({ client: sqlite }) as unknown as DrizzleDb;
    schema = {
      members: sqliteSchema.membersSqlite,
      authCodes: sqliteSchema.authCodesSqlite,
      authTokens: sqliteSchema.authTokensSqlite,
      personalAccessTokens: sqliteSchema.personalAccessTokensSqlite,
      webauthnCredentials: sqliteSchema.webauthnCredentialsSqlite,
      webauthnChallenges: sqliteSchema.webauthnChallengesSqlite,
      roles: sqliteSchema.rolesSqlite,
      roleScopeRules: sqliteSchema.roleScopeRulesSqlite,
      memberRoleAssignments: sqliteSchema.memberRoleAssignmentsSqlite,
      memberAccountAccessDelegations: sqliteSchema.memberAccountAccessDelegationsSqlite,
      curlingSeasons: sqliteSchema.curlingSeasonsSqlite,
      curlingSessions: sqliteSchema.curlingSessionsSqlite,
      leagues: sqliteSchema.leaguesSqlite,
      registrationStateTransitions: sqliteSchema.registrationStateTransitionsSqlite,
      curlingRegistrations: sqliteSchema.curlingRegistrationsSqlite,
      curlingLeagueSabbaticals: sqliteSchema.curlingLeagueSabbaticalsSqlite,
      registrationPolicyAcceptances: sqliteSchema.registrationPolicyAcceptancesSqlite,
      registrationSelections: sqliteSchema.registrationSelectionsSqlite,
      registrationLeaguePriorities: sqliteSchema.registrationLeaguePrioritiesSqlite,
      financialAssistanceRequests: sqliteSchema.financialAssistanceRequestsSqlite,
      registrationInvoices: sqliteSchema.registrationInvoicesSqlite,
      registrationInvoiceLineItems: sqliteSchema.registrationInvoiceLineItemsSqlite,
      registrationPaymentItemNames: sqliteSchema.registrationPaymentItemNamesSqlite,
      registrationPriceSettings: sqliteSchema.registrationPriceSettingsSqlite,
      registrationDiscountSettings: sqliteSchema.registrationDiscountSettingsSqlite,
      registrationEarlyAccessSettings: sqliteSchema.registrationEarlyAccessSettingsSqlite,
      registrationPaymentDeadlines: sqliteSchema.registrationPaymentDeadlinesSqlite,
      seasonMemberships: sqliteSchema.seasonMembershipsSqlite,
      curlingIcePrivileges: sqliteSchema.curlingIcePrivilegesSqlite,
      curlingSabbaticalSessions: sqliteSchema.curlingSabbaticalSessionsSqlite,
      leagueWaitlists: sqliteSchema.leagueWaitlistsSqlite,
      waitlistEntries: sqliteSchema.waitlistEntriesSqlite,
      waitlistOffers: sqliteSchema.waitlistOffersSqlite,
      waitlistAuditEvents: sqliteSchema.waitlistAuditEventsSqlite,
      registrationOutboundMessages: sqliteSchema.registrationOutboundMessagesSqlite,
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
      leagueEntryPoints: sqliteSchema.leagueEntryPointsSqlite,
      leagueEntryTeams: sqliteSchema.leagueEntryTeamsSqlite,
      leagueEntryTeamMembers: sqliteSchema.leagueEntryTeamMembersSqlite,
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
      outboundEmails: sqliteSchema.outboundEmailsSqlite,
      paymentOrders: sqliteSchema.paymentOrdersSqlite,
      paymentTransactions: sqliteSchema.paymentTransactionsSqlite,
      paymentEvents: sqliteSchema.paymentEventsSqlite,
      refunds: sqliteSchema.refundsSqlite,
      webhooks: sqliteSchema.webhooksSqlite,
      webhookDeliveries: sqliteSchema.webhookDeliveriesSqlite,
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
      buildingAccessConfig: sqliteSchema.buildingAccessConfigSqlite,
      publicContactRecipients: sqliteSchema.publicContactRecipientsSqlite,
      dashboardSections: sqliteSchema.dashboardSectionsSqlite,
      mailingLists: sqliteSchema.mailingListsSqlite,
      mauticMembershipSyncStatus: sqliteSchema.mauticMembershipSyncStatusSqlite,
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
      boardMeetingMinutes: sqliteSchema.boardMeetingMinutesSqlite,
      eventCategories: sqliteSchema.eventCategoriesSqlite,
      eventTransferGroups: sqliteSchema.eventTransferGroupsSqlite,
      events: sqliteSchema.eventsSqlite,
      eventTimespans: sqliteSchema.eventTimespansSqlite,
      eventLocations: sqliteSchema.eventLocationsSqlite,
      eventCategoryAssignments: sqliteSchema.eventCategoryAssignmentsSqlite,
      eventOwners: sqliteSchema.eventOwnersSqlite,
      eventRegistrationFields: sqliteSchema.eventRegistrationFieldsSqlite,
      eventRegistrations: sqliteSchema.eventRegistrationsSqlite,
      eventWaitlistOffers: sqliteSchema.eventWaitlistOffersSqlite,
      eventRegistrationMembers: sqliteSchema.eventRegistrationMembersSqlite,
      eventRegistrationFieldValues: sqliteSchema.eventRegistrationFieldValuesSqlite,
      eventSpecialLinks: sqliteSchema.eventSpecialLinksSqlite,
      volunteerPrograms: sqliteSchema.volunteerProgramsSqlite,
      volunteerProgramManagers: sqliteSchema.volunteerProgramManagersSqlite,
      volunteerCredentials: sqliteSchema.volunteerCredentialsSqlite,
      volunteerCredentialManagers: sqliteSchema.volunteerCredentialManagersSqlite,
      volunteerRoles: sqliteSchema.volunteerRolesSqlite,
      volunteerRoleCredentials: sqliteSchema.volunteerRoleCredentialsSqlite,
      memberVolunteerCredentials: sqliteSchema.memberVolunteerCredentialsSqlite,
      volunteerShifts: sqliteSchema.volunteerShiftsSqlite,
      volunteerShiftExceptions: sqliteSchema.volunteerShiftExceptionsSqlite,
      volunteerShiftRoles: sqliteSchema.volunteerShiftRolesSqlite,
      volunteerSignups: sqliteSchema.volunteerSignupsSqlite,
      expenseReports: sqliteSchema.expenseReportsSqlite,
      expenseReceipts: sqliteSchema.expenseReceiptsSqlite,
      expenseReportNotes: sqliteSchema.expenseReportNotesSqlite,
      expenseReportChanges: sqliteSchema.expenseReportChangesSqlite,
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
    pgPool = pool;

    dbInstance = drizzlePg(pool);
    schema = {
      members: pgSchema.membersPg,
      authCodes: pgSchema.authCodesPg,
      authTokens: pgSchema.authTokensPg,
      personalAccessTokens: pgSchema.personalAccessTokensPg,
      webauthnCredentials: pgSchema.webauthnCredentialsPg,
      webauthnChallenges: pgSchema.webauthnChallengesPg,
      roles: pgSchema.rolesPg,
      roleScopeRules: pgSchema.roleScopeRulesPg,
      memberRoleAssignments: pgSchema.memberRoleAssignmentsPg,
      memberAccountAccessDelegations: pgSchema.memberAccountAccessDelegationsPg,
      curlingSeasons: pgSchema.curlingSeasonsPg,
      curlingSessions: pgSchema.curlingSessionsPg,
      leagues: pgSchema.leaguesPg,
      registrationStateTransitions: pgSchema.registrationStateTransitionsPg,
      curlingRegistrations: pgSchema.curlingRegistrationsPg,
      curlingLeagueSabbaticals: pgSchema.curlingLeagueSabbaticalsPg,
      registrationPolicyAcceptances: pgSchema.registrationPolicyAcceptancesPg,
      registrationSelections: pgSchema.registrationSelectionsPg,
      registrationLeaguePriorities: pgSchema.registrationLeaguePrioritiesPg,
      financialAssistanceRequests: pgSchema.financialAssistanceRequestsPg,
      registrationInvoices: pgSchema.registrationInvoicesPg,
      registrationInvoiceLineItems: pgSchema.registrationInvoiceLineItemsPg,
      registrationPaymentItemNames: pgSchema.registrationPaymentItemNamesPg,
      registrationPriceSettings: pgSchema.registrationPriceSettingsPg,
      registrationDiscountSettings: pgSchema.registrationDiscountSettingsPg,
      registrationEarlyAccessSettings: pgSchema.registrationEarlyAccessSettingsPg,
      registrationPaymentDeadlines: pgSchema.registrationPaymentDeadlinesPg,
      seasonMemberships: pgSchema.seasonMembershipsPg,
      curlingIcePrivileges: pgSchema.curlingIcePrivilegesPg,
      curlingSabbaticalSessions: pgSchema.curlingSabbaticalSessionsPg,
      leagueWaitlists: pgSchema.leagueWaitlistsPg,
      waitlistEntries: pgSchema.waitlistEntriesPg,
      waitlistOffers: pgSchema.waitlistOffersPg,
      waitlistAuditEvents: pgSchema.waitlistAuditEventsPg,
      registrationOutboundMessages: pgSchema.registrationOutboundMessagesPg,
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
      leagueEntryPoints: pgSchema.leagueEntryPointsPg,
      leagueEntryTeams: pgSchema.leagueEntryTeamsPg,
      leagueEntryTeamMembers: pgSchema.leagueEntryTeamMembersPg,
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
      outboundEmails: pgSchema.outboundEmailsPg,
      paymentOrders: pgSchema.paymentOrdersPg,
      paymentTransactions: pgSchema.paymentTransactionsPg,
      paymentEvents: pgSchema.paymentEventsPg,
      refunds: pgSchema.refundsPg,
      webhooks: pgSchema.webhooksPg,
      webhookDeliveries: pgSchema.webhookDeliveriesPg,
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
      buildingAccessConfig: pgSchema.buildingAccessConfigPg,
      publicContactRecipients: pgSchema.publicContactRecipientsPg,
      dashboardSections: pgSchema.dashboardSectionsPg,
      mailingLists: pgSchema.mailingListsPg,
      mauticMembershipSyncStatus: pgSchema.mauticMembershipSyncStatusPg,
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
      boardMeetingMinutes: pgSchema.boardMeetingMinutesPg,
      eventCategories: pgSchema.eventCategoriesPg,
      eventTransferGroups: pgSchema.eventTransferGroupsPg,
      events: pgSchema.eventsPg,
      eventTimespans: pgSchema.eventTimespansPg,
      eventLocations: pgSchema.eventLocationsPg,
      eventCategoryAssignments: pgSchema.eventCategoryAssignmentsPg,
      eventOwners: pgSchema.eventOwnersPg,
      eventRegistrationFields: pgSchema.eventRegistrationFieldsPg,
      eventRegistrations: pgSchema.eventRegistrationsPg,
      eventWaitlistOffers: pgSchema.eventWaitlistOffersPg,
      eventRegistrationMembers: pgSchema.eventRegistrationMembersPg,
      eventRegistrationFieldValues: pgSchema.eventRegistrationFieldValuesPg,
      eventSpecialLinks: pgSchema.eventSpecialLinksPg,
      volunteerPrograms: pgSchema.volunteerProgramsPg,
      volunteerProgramManagers: pgSchema.volunteerProgramManagersPg,
      volunteerCredentials: pgSchema.volunteerCredentialsPg,
      volunteerCredentialManagers: pgSchema.volunteerCredentialManagersPg,
      volunteerRoles: pgSchema.volunteerRolesPg,
      volunteerRoleCredentials: pgSchema.volunteerRoleCredentialsPg,
      memberVolunteerCredentials: pgSchema.memberVolunteerCredentialsPg,
      volunteerShifts: pgSchema.volunteerShiftsPg,
      volunteerShiftExceptions: pgSchema.volunteerShiftExceptionsPg,
      volunteerShiftRoles: pgSchema.volunteerShiftRolesPg,
      volunteerSignups: pgSchema.volunteerSignupsPg,
      expenseReports: pgSchema.expenseReportsPg,
      expenseReceipts: pgSchema.expenseReceiptsPg,
      expenseReportNotes: pgSchema.expenseReportNotesPg,
      expenseReportChanges: pgSchema.expenseReportChangesPg,
    } as DrizzleSchema;
  } else {
    throw new Error(`Unsupported database type: ${config.type}`);
  }

  return { db: dbInstance!, schema: schema! };
}

export function resetDrizzleDb() {
  void closeDrizzleDb();
}

/** Close the SQLite handle or Postgres pool so CLI scripts can exit. */
export async function closeDrizzleDb(): Promise<void> {
  const pool = pgPool;
  const sqlite = sqliteClient;
  pgPool = null;
  sqliteClient = null;
  dbInstance = null;
  schema = null;
  sqlite?.close();
  if (pool) {
    await pool.end();
  }
}

