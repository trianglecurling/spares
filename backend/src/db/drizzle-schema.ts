import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { pgTable, text as textPg, integer as integerPg, timestamp, time, date, index as indexPg, uniqueIndex as uniqueIndexPg } from 'drizzle-orm/pg-core';

// We'll create schemas for both SQLite and PostgreSQL
// The application will use the appropriate one based on database type

// ========== SQLite Schema ==========
export const membersSqlite = sqliteTable('members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  // If set (YYYY-MM-DD), member is valid through that date (inclusive). Null = no expiry.
  valid_through: text('valid_through'),
  // Spare-only members can participate as spares, but cannot create spare requests.
  spare_only: integer('spare_only').default(0).notNull(),
  is_admin: integer('is_admin').default(0).notNull(),
  is_server_admin: integer('is_server_admin').default(0).notNull(),
  opted_in_sms: integer('opted_in_sms').default(0).notNull(),
  email_subscribed: integer('email_subscribed').default(1).notNull(),
  first_login_completed: integer('first_login_completed').default(0).notNull(),
  email_visible: integer('email_visible').default(0).notNull(),
  phone_visible: integer('phone_visible').default(0).notNull(),
  theme_preference: text('theme_preference').default('system'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  emailIdx: index('idx_members_email').on(table.email),
  phoneIdx: index('idx_members_phone').on(table.phone),
}));

export const authCodesSqlite = sqliteTable('auth_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  contact: text('contact').notNull(),
  code: text('code').notNull(),
  expires_at: text('expires_at').notNull(),
  used: integer('used').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  contactIdx: index('idx_auth_codes_contact').on(table.contact),
  codeIdx: index('idx_auth_codes_code').on(table.code),
}));

export const authTokensSqlite = sqliteTable('auth_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expires_at: text('expires_at').notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  tokenIdx: index('idx_auth_tokens_token').on(table.token),
  memberIdIdx: index('idx_auth_tokens_member_id').on(table.member_id),
}));

export const leaguesSqlite = sqliteTable('leagues', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  day_of_week: integer('day_of_week').notNull(),
  format: text('format').notNull().$type<'teams' | 'doubles'>(),
  start_date: text('start_date').notNull(),
  end_date: text('end_date').notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
});

export const leagueDrawTimesSqlite = sqliteTable('league_draw_times', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  league_id: integer('league_id').notNull().references(() => leaguesSqlite.id, { onDelete: 'cascade' }),
  draw_time: text('draw_time').notNull(),
}, (table) => ({
  leagueIdIdx: index('idx_league_draw_times_league_id').on(table.league_id),
}));

export const leagueExceptionsSqlite = sqliteTable('league_exceptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  league_id: integer('league_id').notNull().references(() => leaguesSqlite.id, { onDelete: 'cascade' }),
  exception_date: text('exception_date').notNull(), // YYYY-MM-DD
}, (table) => ({
  leagueIdIdx: index('idx_league_exceptions_league_id').on(table.league_id),
  uniqueLeagueExceptionDate: uniqueIndex('league_exceptions_league_id_exception_date_unique').on(table.league_id, table.exception_date),
}));

export const sheetsSqlite = sqliteTable('sheets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  sort_order: integer('sort_order').default(0).notNull(),
  is_active: integer('is_active').default(1).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  uniqueName: uniqueIndex('sheets_name_unique').on(table.name),
  activeIdx: index('idx_sheets_is_active').on(table.is_active),
  sortIdx: index('idx_sheets_sort_order').on(table.sort_order),
}));

export const leagueDivisionsSqlite = sqliteTable('league_divisions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  league_id: integer('league_id').notNull().references(() => leaguesSqlite.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sort_order: integer('sort_order').default(0).notNull(),
  is_default: integer('is_default').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  leagueIdIdx: index('idx_league_divisions_league_id').on(table.league_id),
  sortIdx: index('idx_league_divisions_league_id_sort').on(table.league_id, table.sort_order),
  uniqueLeagueName: uniqueIndex('league_divisions_league_id_name_unique').on(table.league_id, table.name),
}));

export const leagueTeamsSqlite = sqliteTable('league_teams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  league_id: integer('league_id').notNull().references(() => leaguesSqlite.id, { onDelete: 'cascade' }),
  division_id: integer('division_id').notNull().references(() => leagueDivisionsSqlite.id, { onDelete: 'cascade' }),
  name: text('name'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  leagueIdIdx: index('idx_league_teams_league_id').on(table.league_id),
  divisionIdIdx: index('idx_league_teams_division_id').on(table.division_id),
}));

export const teamMembersSqlite = sqliteTable('team_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  team_id: integer('team_id').notNull().references(() => leagueTeamsSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  role: text('role').notNull().$type<'lead' | 'second' | 'third' | 'fourth' | 'player1' | 'player2'>(),
  is_skip: integer('is_skip').default(0).notNull(),
  is_vice: integer('is_vice').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  teamIdIdx: index('idx_team_members_team_id').on(table.team_id),
  memberIdIdx: index('idx_team_members_member_id').on(table.member_id),
  uniqueTeamMember: uniqueIndex('team_members_team_id_member_id_unique').on(table.team_id, table.member_id),
}));

export const leagueMemberRolesSqlite = sqliteTable('league_member_roles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  league_id: integer('league_id').references(() => leaguesSqlite.id, { onDelete: 'cascade' }),
  role: text('role').notNull().$type<'league_manager' | 'league_administrator'>(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  memberIdIdx: index('idx_league_member_roles_member_id').on(table.member_id),
  leagueIdIdx: index('idx_league_member_roles_league_id').on(table.league_id),
  uniqueMemberLeagueRole: uniqueIndex('league_member_roles_member_id_league_id_role_unique').on(
    table.member_id,
    table.league_id,
    table.role
  ),
}));

export const leagueRosterSqlite = sqliteTable('league_roster', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  league_id: integer('league_id').notNull().references(() => leaguesSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  leagueIdIdx: index('idx_league_roster_league_id').on(table.league_id),
  memberIdIdx: index('idx_league_roster_member_id').on(table.member_id),
  uniqueLeagueMember: uniqueIndex('league_roster_league_id_member_id_unique').on(table.league_id, table.member_id),
}));

export const memberAvailabilitySqlite = sqliteTable('member_availability', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  league_id: integer('league_id').notNull().references(() => leaguesSqlite.id, { onDelete: 'cascade' }),
  available: integer('available').default(0).notNull(),
  can_skip: integer('can_skip').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  memberIdIdx: index('idx_member_availability_member_id').on(table.member_id),
  leagueIdIdx: index('idx_member_availability_league_id').on(table.league_id),
  uniqueMemberLeague: uniqueIndex('member_availability_member_id_league_id_unique').on(table.member_id, table.league_id),
}));

export const spareRequestsSqlite = sqliteTable('spare_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requester_id: integer('requester_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  league_id: integer('league_id').references(() => leaguesSqlite.id, { onDelete: 'set null' }),
  requested_for_name: text('requested_for_name').notNull(),
  requested_for_member_id: integer('requested_for_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  game_date: text('game_date').notNull(),
  game_time: text('game_time').notNull(),
  position: text('position').$type<'lead' | 'second' | 'vice' | 'skip' | null>(),
  message: text('message'),
  request_type: text('request_type').notNull().$type<'public' | 'private'>(),
  status: text('status').default('open').notNull().$type<'open' | 'filled' | 'cancelled'>(),
  filled_by_member_id: integer('filled_by_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  cancelled_by_member_id: integer('cancelled_by_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  filled_at: text('filled_at'),
  notification_generation: integer('notification_generation').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
  notifications_sent_at: text('notifications_sent_at'),
  had_cancellation: integer('had_cancellation').default(0).notNull(),
  notification_status: text('notification_status').$type<'in_progress' | 'completed' | 'paused' | null>(),
  next_notification_at: text('next_notification_at'),
  notification_paused: integer('notification_paused').default(0).notNull(),
  all_invites_declined_notified: integer('all_invites_declined_notified').default(0).notNull(),
}, (table) => ({
  requesterIdIdx: index('idx_spare_requests_requester_id').on(table.requester_id),
  requestedForMemberIdIdx: index('idx_spare_requests_requested_for_member_id').on(table.requested_for_member_id),
  cancelledByMemberIdIdx: index('idx_spare_requests_cancelled_by_member_id').on(table.cancelled_by_member_id),
  leagueIdIdx: index('idx_spare_requests_league_id').on(table.league_id),
  gameDateIdx: index('idx_spare_requests_game_date').on(table.game_date),
  statusIdx: index('idx_spare_requests_status').on(table.status),
}));

export const spareRequestInvitationsSqlite = sqliteTable('spare_request_invitations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  spare_request_id: integer('spare_request_id').notNull().references(() => spareRequestsSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  declined_at: text('declined_at'),
  decline_comment: text('decline_comment'),
}, (table) => ({
  requestIdIdx: index('idx_spare_request_invitations_request_id').on(table.spare_request_id),
  memberIdIdx: index('idx_spare_request_invitations_member_id').on(table.member_id),
  uniqueRequestMember: uniqueIndex('spare_request_invitations_spare_request_id_member_id_unique').on(table.spare_request_id, table.member_id),
}));

export const spareRequestCcsSqlite = sqliteTable('spare_request_ccs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  spare_request_id: integer('spare_request_id').notNull().references(() => spareRequestsSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  requestIdIdx: index('idx_spare_request_ccs_request_id').on(table.spare_request_id),
  memberIdIdx: index('idx_spare_request_ccs_member_id').on(table.member_id),
  uniqueRequestMember: uniqueIndex('spare_request_ccs_spare_request_id_member_id_unique').on(table.spare_request_id, table.member_id),
}));

export const spareResponsesSqlite = sqliteTable('spare_responses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  spare_request_id: integer('spare_request_id').notNull().references(() => spareRequestsSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  comment: text('comment'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  requestIdIdx: index('idx_spare_responses_request_id').on(table.spare_request_id),
  memberIdIdx: index('idx_spare_responses_member_id').on(table.member_id),
  uniqueRequestMember: uniqueIndex('spare_responses_spare_request_id_member_id_unique').on(table.spare_request_id, table.member_id),
}));

export const serverConfigSqlite = sqliteTable('server_config', {
  id: integer('id').primaryKey(),
  twilio_api_key_sid: text('twilio_api_key_sid'),
  twilio_api_key_secret: text('twilio_api_key_secret'),
  twilio_account_sid: text('twilio_account_sid'),
  twilio_campaign_sid: text('twilio_campaign_sid'),
  azure_connection_string: text('azure_connection_string'),
  azure_sender_email: text('azure_sender_email'),
  azure_sender_display_name: text('azure_sender_display_name'),
  dashboard_alert_title: text('dashboard_alert_title'),
  dashboard_alert_body: text('dashboard_alert_body'),
  dashboard_alert_expires_at: text('dashboard_alert_expires_at'),
  dashboard_alert_variant: text('dashboard_alert_variant'),
  dashboard_alert_icon: text('dashboard_alert_icon'),
  test_mode: integer('test_mode').default(0).notNull(),
  disable_email: integer('disable_email').default(0).notNull(),
  disable_sms: integer('disable_sms').default(0).notNull(),
  frontend_otel_enabled: integer('frontend_otel_enabled').default(1).notNull(),
  capture_frontend_logs: integer('capture_frontend_logs').default(1).notNull(),
  capture_backend_logs: integer('capture_backend_logs').default(1).notNull(),
  test_current_time: text('test_current_time'),
  notification_delay_seconds: integer('notification_delay_seconds').default(180).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
});

export const spareRequestNotificationQueueSqlite = sqliteTable('spare_request_notification_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  spare_request_id: integer('spare_request_id').notNull().references(() => spareRequestsSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  queue_order: integer('queue_order').notNull(),
  claimed_at: text('claimed_at'),
  notified_at: text('notified_at'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  requestIdIdx: index('idx_notification_queue_request_id').on(table.spare_request_id),
  orderIdx: index('idx_notification_queue_order').on(table.spare_request_id, table.queue_order),
  notifiedIdx: index('idx_notification_queue_notified').on(table.spare_request_id, table.notified_at),
  claimedIdx: index('idx_notification_queue_claimed').on(table.spare_request_id, table.claimed_at),
  uniqueRequestMember: uniqueIndex('spare_request_notification_queue_spare_request_id_member_id_unique').on(table.spare_request_id, table.member_id),
}));

export const spareRequestNotificationDeliveriesSqlite = sqliteTable('spare_request_notification_deliveries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  spare_request_id: integer('spare_request_id').notNull().references(() => spareRequestsSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  notification_generation: integer('notification_generation').notNull(),
  channel: text('channel').notNull().$type<'email' | 'sms'>(),
  kind: text('kind').notNull(),
  claimed_at: text('claimed_at'),
  sent_at: text('sent_at'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  reqIdx: index('idx_spare_request_notification_deliveries_req').on(table.spare_request_id),
  memberIdx: index('idx_spare_request_notification_deliveries_member').on(table.member_id),
  claimedIdx: index('idx_spare_request_notification_deliveries_claimed').on(table.spare_request_id, table.claimed_at),
  sentIdx: index('idx_spare_request_notification_deliveries_sent').on(table.spare_request_id, table.sent_at),
  uniqueKey: uniqueIndex('spare_request_notification_deliveries_unique_key').on(
    table.spare_request_id,
    table.member_id,
    table.notification_generation,
    table.channel,
    table.kind
  ),
}));

export const feedbackSqlite = sqliteTable('feedback', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  category: text('category').notNull().$type<'suggestion' | 'problem' | 'question' | 'general'>(),
  body: text('body').notNull(),
  email: text('email'),
  member_id: integer('member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  page_path: text('page_path'),
  user_agent: text('user_agent'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  createdAtIdx: index('idx_feedback_created_at').on(table.created_at),
  memberIdIdx: index('idx_feedback_member_id').on(table.member_id),
  categoryIdx: index('idx_feedback_category').on(table.category),
}));

// Observability / analytics events (best-effort logging)
export const observabilityEventsSqlite = sqliteTable('observability_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  event_type: text('event_type').notNull(),
  member_id: integer('member_id'),
  related_id: integer('related_id'),
  meta: text('meta'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  createdAtIdx: index('idx_observability_events_created_at').on(table.created_at),
  eventTypeIdx: index('idx_observability_events_event_type').on(table.event_type),
  memberIdIdx: index('idx_observability_events_member_id').on(table.member_id),
}));

// Daily active users table (one row per member per day; duplicates ignored)
export const dailyActivitySqlite = sqliteTable('daily_activity', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  activity_date: text('activity_date').notNull(), // YYYY-MM-DD
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  uniqueMemberDay: uniqueIndex('daily_activity_member_id_activity_date_unique').on(table.member_id, table.activity_date),
  activityDateIdx: index('idx_daily_activity_activity_date').on(table.activity_date),
  memberIdIdx: index('idx_daily_activity_member_id').on(table.member_id),
}));

// ========== PostgreSQL Schema ==========
export const membersPg = pgTable('members', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  name: textPg('name').notNull(),
  email: textPg('email').notNull(),
  phone: textPg('phone'),
  valid_through: date('valid_through'),
  spare_only: integerPg('spare_only').default(0).notNull(),
  is_admin: integerPg('is_admin').default(0).notNull(),
  is_server_admin: integerPg('is_server_admin').default(0).notNull(),
  opted_in_sms: integerPg('opted_in_sms').default(0).notNull(),
  email_subscribed: integerPg('email_subscribed').default(1).notNull(),
  first_login_completed: integerPg('first_login_completed').default(0).notNull(),
  email_visible: integerPg('email_visible').default(0).notNull(),
  phone_visible: integerPg('phone_visible').default(0).notNull(),
  theme_preference: textPg('theme_preference').default('system'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  emailIdx: indexPg('idx_members_email').on(table.email),
  phoneIdx: indexPg('idx_members_phone').on(table.phone),
}));

export const authCodesPg = pgTable('auth_codes', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  contact: textPg('contact').notNull(),
  code: textPg('code').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: false }).notNull(),
  used: integerPg('used').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  contactIdx: indexPg('idx_auth_codes_contact').on(table.contact),
  codeIdx: indexPg('idx_auth_codes_code').on(table.code),
}));

export const authTokensPg = pgTable('auth_tokens', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  token: textPg('token').notNull().unique(),
  expires_at: timestamp('expires_at', { withTimezone: false }).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  tokenIdx: indexPg('idx_auth_tokens_token').on(table.token),
  memberIdIdx: indexPg('idx_auth_tokens_member_id').on(table.member_id),
}));

export const leaguesPg = pgTable('leagues', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  name: textPg('name').notNull(),
  day_of_week: integerPg('day_of_week').notNull(),
  format: textPg('format').notNull().$type<'teams' | 'doubles'>(),
  start_date: date('start_date').notNull(),
  end_date: date('end_date').notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});

export const leagueDrawTimesPg = pgTable('league_draw_times', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  league_id: integerPg('league_id').notNull().references(() => leaguesPg.id, { onDelete: 'cascade' }),
  draw_time: time('draw_time').notNull(),
}, (table) => ({
  leagueIdIdx: indexPg('idx_league_draw_times_league_id').on(table.league_id),
}));

export const leagueExceptionsPg = pgTable('league_exceptions', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  league_id: integerPg('league_id').notNull().references(() => leaguesPg.id, { onDelete: 'cascade' }),
  exception_date: date('exception_date').notNull(),
}, (table) => ({
  leagueIdIdx: indexPg('idx_league_exceptions_league_id').on(table.league_id),
  uniqueLeagueExceptionDate: uniqueIndexPg('league_exceptions_league_id_exception_date_unique').on(table.league_id, table.exception_date),
}));

export const sheetsPg = pgTable('sheets', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  name: textPg('name').notNull(),
  sort_order: integerPg('sort_order').default(0).notNull(),
  is_active: integerPg('is_active').default(1).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  uniqueName: uniqueIndexPg('sheets_name_unique').on(table.name),
  activeIdx: indexPg('idx_sheets_is_active').on(table.is_active),
  sortIdx: indexPg('idx_sheets_sort_order').on(table.sort_order),
}));

export const leagueDivisionsPg = pgTable('league_divisions', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  league_id: integerPg('league_id').notNull().references(() => leaguesPg.id, { onDelete: 'cascade' }),
  name: textPg('name').notNull(),
  sort_order: integerPg('sort_order').default(0).notNull(),
  is_default: integerPg('is_default').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  leagueIdIdx: indexPg('idx_league_divisions_league_id').on(table.league_id),
  sortIdx: indexPg('idx_league_divisions_league_id_sort').on(table.league_id, table.sort_order),
  uniqueLeagueName: uniqueIndexPg('league_divisions_league_id_name_unique').on(table.league_id, table.name),
}));

export const leagueTeamsPg = pgTable('league_teams', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  league_id: integerPg('league_id').notNull().references(() => leaguesPg.id, { onDelete: 'cascade' }),
  division_id: integerPg('division_id').notNull().references(() => leagueDivisionsPg.id, { onDelete: 'cascade' }),
  name: textPg('name'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  leagueIdIdx: indexPg('idx_league_teams_league_id').on(table.league_id),
  divisionIdIdx: indexPg('idx_league_teams_division_id').on(table.division_id),
}));

export const teamMembersPg = pgTable('team_members', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  team_id: integerPg('team_id').notNull().references(() => leagueTeamsPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  role: textPg('role').notNull().$type<'lead' | 'second' | 'third' | 'fourth' | 'player1' | 'player2'>(),
  is_skip: integerPg('is_skip').default(0).notNull(),
  is_vice: integerPg('is_vice').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  teamIdIdx: indexPg('idx_team_members_team_id').on(table.team_id),
  memberIdIdx: indexPg('idx_team_members_member_id').on(table.member_id),
  uniqueTeamMember: uniqueIndexPg('team_members_team_id_member_id_unique').on(table.team_id, table.member_id),
}));

export const leagueMemberRolesPg = pgTable('league_member_roles', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  league_id: integerPg('league_id').references(() => leaguesPg.id, { onDelete: 'cascade' }),
  role: textPg('role').notNull().$type<'league_manager' | 'league_administrator'>(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  memberIdIdx: indexPg('idx_league_member_roles_member_id').on(table.member_id),
  leagueIdIdx: indexPg('idx_league_member_roles_league_id').on(table.league_id),
  uniqueMemberLeagueRole: uniqueIndexPg('league_member_roles_member_id_league_id_role_unique').on(
    table.member_id,
    table.league_id,
    table.role
  ),
}));

export const leagueRosterPg = pgTable('league_roster', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  league_id: integerPg('league_id').notNull().references(() => leaguesPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  leagueIdIdx: indexPg('idx_league_roster_league_id').on(table.league_id),
  memberIdIdx: indexPg('idx_league_roster_member_id').on(table.member_id),
  uniqueLeagueMember: uniqueIndexPg('league_roster_league_id_member_id_unique').on(table.league_id, table.member_id),
}));

export const memberAvailabilityPg = pgTable('member_availability', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  league_id: integerPg('league_id').notNull().references(() => leaguesPg.id, { onDelete: 'cascade' }),
  available: integerPg('available').default(0).notNull(),
  can_skip: integerPg('can_skip').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  memberIdIdx: indexPg('idx_member_availability_member_id').on(table.member_id),
  leagueIdIdx: indexPg('idx_member_availability_league_id').on(table.league_id),
  uniqueMemberLeague: uniqueIndexPg('member_availability_member_id_league_id_unique').on(table.member_id, table.league_id),
}));

export const spareRequestsPg = pgTable('spare_requests', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  requester_id: integerPg('requester_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  league_id: integerPg('league_id').references(() => leaguesPg.id, { onDelete: 'set null' }),
  requested_for_name: textPg('requested_for_name').notNull(),
  requested_for_member_id: integerPg('requested_for_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  game_date: date('game_date').notNull(),
  game_time: time('game_time').notNull(),
  position: textPg('position').$type<'lead' | 'second' | 'vice' | 'skip' | null>(),
  message: textPg('message'),
  request_type: textPg('request_type').notNull().$type<'public' | 'private'>(),
  status: textPg('status').default('open').notNull().$type<'open' | 'filled' | 'cancelled'>(),
  filled_by_member_id: integerPg('filled_by_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  cancelled_by_member_id: integerPg('cancelled_by_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  filled_at: timestamp('filled_at', { withTimezone: false }),
  notification_generation: integerPg('notification_generation').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
  notifications_sent_at: timestamp('notifications_sent_at', { withTimezone: false }),
  had_cancellation: integerPg('had_cancellation').default(0).notNull(),
  notification_status: textPg('notification_status').$type<'in_progress' | 'completed' | 'paused' | null>(),
  next_notification_at: timestamp('next_notification_at', { withTimezone: false }),
  notification_paused: integerPg('notification_paused').default(0).notNull(),
  all_invites_declined_notified: integerPg('all_invites_declined_notified').default(0).notNull(),
}, (table) => ({
  requesterIdIdx: indexPg('idx_spare_requests_requester_id').on(table.requester_id),
  requestedForMemberIdIdx: indexPg('idx_spare_requests_requested_for_member_id').on(table.requested_for_member_id),
  cancelledByMemberIdIdx: indexPg('idx_spare_requests_cancelled_by_member_id').on(table.cancelled_by_member_id),
  leagueIdIdx: indexPg('idx_spare_requests_league_id').on(table.league_id),
  gameDateIdx: indexPg('idx_spare_requests_game_date').on(table.game_date),
  statusIdx: indexPg('idx_spare_requests_status').on(table.status),
}));

export const spareRequestInvitationsPg = pgTable('spare_request_invitations', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  spare_request_id: integerPg('spare_request_id').notNull().references(() => spareRequestsPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  declined_at: timestamp('declined_at', { withTimezone: false }),
  decline_comment: textPg('decline_comment'),
}, (table) => ({
  requestIdIdx: indexPg('idx_spare_request_invitations_request_id').on(table.spare_request_id),
  memberIdIdx: indexPg('idx_spare_request_invitations_member_id').on(table.member_id),
  uniqueRequestMember: uniqueIndexPg('spare_request_invitations_spare_request_id_member_id_unique').on(table.spare_request_id, table.member_id),
}));

export const spareRequestCcsPg = pgTable('spare_request_ccs', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  spare_request_id: integerPg('spare_request_id').notNull().references(() => spareRequestsPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  requestIdIdx: indexPg('idx_spare_request_ccs_request_id').on(table.spare_request_id),
  memberIdIdx: indexPg('idx_spare_request_ccs_member_id').on(table.member_id),
  uniqueRequestMember: uniqueIndexPg('spare_request_ccs_spare_request_id_member_id_unique').on(table.spare_request_id, table.member_id),
}));

export const spareResponsesPg = pgTable('spare_responses', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  spare_request_id: integerPg('spare_request_id').notNull().references(() => spareRequestsPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  comment: textPg('comment'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  requestIdIdx: indexPg('idx_spare_responses_request_id').on(table.spare_request_id),
  memberIdIdx: indexPg('idx_spare_responses_member_id').on(table.member_id),
  uniqueRequestMember: uniqueIndexPg('spare_responses_spare_request_id_member_id_unique').on(table.spare_request_id, table.member_id),
}));

export const serverConfigPg = pgTable('server_config', {
  id: integerPg('id').primaryKey(),
  twilio_api_key_sid: textPg('twilio_api_key_sid'),
  twilio_api_key_secret: textPg('twilio_api_key_secret'),
  twilio_account_sid: textPg('twilio_account_sid'),
  twilio_campaign_sid: textPg('twilio_campaign_sid'),
  azure_connection_string: textPg('azure_connection_string'),
  azure_sender_email: textPg('azure_sender_email'),
  azure_sender_display_name: textPg('azure_sender_display_name'),
  dashboard_alert_title: textPg('dashboard_alert_title'),
  dashboard_alert_body: textPg('dashboard_alert_body'),
  dashboard_alert_expires_at: timestamp('dashboard_alert_expires_at', { withTimezone: false }),
  dashboard_alert_variant: textPg('dashboard_alert_variant'),
  dashboard_alert_icon: textPg('dashboard_alert_icon'),
  test_mode: integerPg('test_mode').default(0).notNull(),
  disable_email: integerPg('disable_email').default(0).notNull(),
  disable_sms: integerPg('disable_sms').default(0).notNull(),
  frontend_otel_enabled: integerPg('frontend_otel_enabled').default(1).notNull(),
  capture_frontend_logs: integerPg('capture_frontend_logs').default(1).notNull(),
  capture_backend_logs: integerPg('capture_backend_logs').default(1).notNull(),
  test_current_time: timestamp('test_current_time', { withTimezone: false }),
  notification_delay_seconds: integerPg('notification_delay_seconds').default(180).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});

export const spareRequestNotificationQueuePg = pgTable('spare_request_notification_queue', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  spare_request_id: integerPg('spare_request_id').notNull().references(() => spareRequestsPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  queue_order: integerPg('queue_order').notNull(),
  claimed_at: timestamp('claimed_at', { withTimezone: false }),
  notified_at: timestamp('notified_at', { withTimezone: false }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  requestIdIdx: indexPg('idx_notification_queue_request_id').on(table.spare_request_id),
  orderIdx: indexPg('idx_notification_queue_order').on(table.spare_request_id, table.queue_order),
  notifiedIdx: indexPg('idx_notification_queue_notified').on(table.spare_request_id, table.notified_at),
  claimedIdx: indexPg('idx_notification_queue_claimed').on(table.spare_request_id, table.claimed_at),
  uniqueRequestMember: uniqueIndexPg('spare_request_notification_queue_spare_request_id_member_id_unique').on(table.spare_request_id, table.member_id),
}));

export const spareRequestNotificationDeliveriesPg = pgTable('spare_request_notification_deliveries', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  spare_request_id: integerPg('spare_request_id').notNull().references(() => spareRequestsPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  notification_generation: integerPg('notification_generation').notNull(),
  channel: textPg('channel').notNull().$type<'email' | 'sms'>(),
  kind: textPg('kind').notNull(),
  claimed_at: timestamp('claimed_at', { withTimezone: false }),
  sent_at: timestamp('sent_at', { withTimezone: false }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  reqIdx: indexPg('idx_spare_request_notification_deliveries_req').on(table.spare_request_id),
  memberIdx: indexPg('idx_spare_request_notification_deliveries_member').on(table.member_id),
  claimedIdx: indexPg('idx_spare_request_notification_deliveries_claimed').on(table.spare_request_id, table.claimed_at),
  sentIdx: indexPg('idx_spare_request_notification_deliveries_sent').on(table.spare_request_id, table.sent_at),
  uniqueKey: uniqueIndexPg('spare_request_notification_deliveries_unique_key').on(
    table.spare_request_id,
    table.member_id,
    table.notification_generation,
    table.channel,
    table.kind
  ),
}));

export const feedbackPg = pgTable('feedback', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  category: textPg('category').notNull().$type<'suggestion' | 'problem' | 'question' | 'general'>(),
  body: textPg('body').notNull(),
  email: textPg('email'),
  member_id: integerPg('member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  page_path: textPg('page_path'),
  user_agent: textPg('user_agent'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  createdAtIdx: indexPg('idx_feedback_created_at').on(table.created_at),
  memberIdIdx: indexPg('idx_feedback_member_id').on(table.member_id),
  categoryIdx: indexPg('idx_feedback_category').on(table.category),
}));

export const observabilityEventsPg = pgTable('observability_events', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  event_type: textPg('event_type').notNull(),
  member_id: integerPg('member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  related_id: integerPg('related_id'),
  meta: textPg('meta'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  createdAtIdx: indexPg('idx_observability_events_created_at').on(table.created_at),
  eventTypeIdx: indexPg('idx_observability_events_event_type').on(table.event_type),
  memberIdIdx: indexPg('idx_observability_events_member_id').on(table.member_id),
}));

export const dailyActivityPg = pgTable('daily_activity', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  activity_date: textPg('activity_date').notNull(), // YYYY-MM-DD
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  uniqueMemberDay: uniqueIndexPg('daily_activity_member_id_activity_date_unique').on(table.member_id, table.activity_date),
  activityDateIdx: indexPg('idx_daily_activity_activity_date').on(table.activity_date),
  memberIdIdx: indexPg('idx_daily_activity_member_id').on(table.member_id),
}));

// Export schema objects for use in database initialization
export const sqliteSchema = {
  members: membersSqlite,
  authCodes: authCodesSqlite,
  authTokens: authTokensSqlite,
  leagues: leaguesSqlite,
  leagueDrawTimes: leagueDrawTimesSqlite,
  leagueExceptions: leagueExceptionsSqlite,
  sheets: sheetsSqlite,
  leagueDivisions: leagueDivisionsSqlite,
  leagueTeams: leagueTeamsSqlite,
  teamMembers: teamMembersSqlite,
  leagueMemberRoles: leagueMemberRolesSqlite,
  leagueRoster: leagueRosterSqlite,
  memberAvailability: memberAvailabilitySqlite,
  spareRequests: spareRequestsSqlite,
  spareRequestInvitations: spareRequestInvitationsSqlite,
  spareRequestCcs: spareRequestCcsSqlite,
  spareResponses: spareResponsesSqlite,
  serverConfig: serverConfigSqlite,
  spareRequestNotificationQueue: spareRequestNotificationQueueSqlite,
  spareRequestNotificationDeliveries: spareRequestNotificationDeliveriesSqlite,
  feedback: feedbackSqlite,
  observabilityEvents: observabilityEventsSqlite,
  dailyActivity: dailyActivitySqlite,
};

export const pgSchema = {
  members: membersPg,
  authCodes: authCodesPg,
  authTokens: authTokensPg,
  leagues: leaguesPg,
  leagueDrawTimes: leagueDrawTimesPg,
  leagueExceptions: leagueExceptionsPg,
  sheets: sheetsPg,
  leagueDivisions: leagueDivisionsPg,
  leagueTeams: leagueTeamsPg,
  teamMembers: teamMembersPg,
  leagueMemberRoles: leagueMemberRolesPg,
  leagueRoster: leagueRosterPg,
  memberAvailability: memberAvailabilityPg,
  spareRequests: spareRequestsPg,
  spareRequestInvitations: spareRequestInvitationsPg,
  spareRequestCcs: spareRequestCcsPg,
  spareResponses: spareResponsesPg,
  serverConfig: serverConfigPg,
  spareRequestNotificationQueue: spareRequestNotificationQueuePg,
  spareRequestNotificationDeliveries: spareRequestNotificationDeliveriesPg,
  feedback: feedbackPg,
  observabilityEvents: observabilityEventsPg,
  dailyActivity: dailyActivityPg,
};
