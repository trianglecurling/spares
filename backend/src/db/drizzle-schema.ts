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
  is_admin: integer('is_admin').default(0).notNull(),
  opted_in_sms: integer('opted_in_sms').default(0).notNull(),
  email_subscribed: integer('email_subscribed').default(1).notNull(),
  first_login_completed: integer('first_login_completed').default(0).notNull(),
  email_visible: integer('email_visible').default(0).notNull(),
  phone_visible: integer('phone_visible').default(0).notNull(),
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
  requested_for_name: text('requested_for_name').notNull(),
  game_date: text('game_date').notNull(),
  game_time: text('game_time').notNull(),
  position: text('position').$type<'lead' | 'second' | 'vice' | 'skip' | null>(),
  message: text('message'),
  request_type: text('request_type').notNull().$type<'public' | 'private'>(),
  status: text('status').default('open').notNull().$type<'open' | 'filled' | 'cancelled'>(),
  filled_by_member_id: integer('filled_by_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  filled_at: text('filled_at'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
  notifications_sent_at: text('notifications_sent_at'),
  had_cancellation: integer('had_cancellation').default(0).notNull(),
  notification_status: text('notification_status').$type<'in_progress' | 'completed' | 'paused' | null>(),
  next_notification_at: text('next_notification_at'),
  notification_paused: integer('notification_paused').default(0).notNull(),
}, (table) => ({
  requesterIdIdx: index('idx_spare_requests_requester_id').on(table.requester_id),
  gameDateIdx: index('idx_spare_requests_game_date').on(table.game_date),
  statusIdx: index('idx_spare_requests_status').on(table.status),
}));

export const spareRequestInvitationsSqlite = sqliteTable('spare_request_invitations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  spare_request_id: integer('spare_request_id').notNull().references(() => spareRequestsSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  requestIdIdx: index('idx_spare_request_invitations_request_id').on(table.spare_request_id),
  memberIdIdx: index('idx_spare_request_invitations_member_id').on(table.member_id),
  uniqueRequestMember: uniqueIndex('spare_request_invitations_spare_request_id_member_id_unique').on(table.spare_request_id, table.member_id),
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
  test_mode: integer('test_mode').default(0).notNull(),
  test_current_time: text('test_current_time'),
  notification_delay_seconds: integer('notification_delay_seconds').default(180).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
});

export const spareRequestNotificationQueueSqlite = sqliteTable('spare_request_notification_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  spare_request_id: integer('spare_request_id').notNull().references(() => spareRequestsSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  queue_order: integer('queue_order').notNull(),
  notified_at: text('notified_at'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  requestIdIdx: index('idx_notification_queue_request_id').on(table.spare_request_id),
  orderIdx: index('idx_notification_queue_order').on(table.spare_request_id, table.queue_order),
  notifiedIdx: index('idx_notification_queue_notified').on(table.spare_request_id, table.notified_at),
  uniqueRequestMember: uniqueIndex('spare_request_notification_queue_spare_request_id_member_id_unique').on(table.spare_request_id, table.member_id),
}));

// ========== PostgreSQL Schema ==========
export const membersPg = pgTable('members', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  name: textPg('name').notNull(),
  email: textPg('email').notNull(),
  phone: textPg('phone'),
  is_admin: integerPg('is_admin').default(0).notNull(),
  opted_in_sms: integerPg('opted_in_sms').default(0).notNull(),
  email_subscribed: integerPg('email_subscribed').default(1).notNull(),
  first_login_completed: integerPg('first_login_completed').default(0).notNull(),
  email_visible: integerPg('email_visible').default(0).notNull(),
  phone_visible: integerPg('phone_visible').default(0).notNull(),
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
  requested_for_name: textPg('requested_for_name').notNull(),
  game_date: date('game_date').notNull(),
  game_time: time('game_time').notNull(),
  position: textPg('position').$type<'lead' | 'second' | 'vice' | 'skip' | null>(),
  message: textPg('message'),
  request_type: textPg('request_type').notNull().$type<'public' | 'private'>(),
  status: textPg('status').default('open').notNull().$type<'open' | 'filled' | 'cancelled'>(),
  filled_by_member_id: integerPg('filled_by_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  filled_at: timestamp('filled_at', { withTimezone: false }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
  notifications_sent_at: timestamp('notifications_sent_at', { withTimezone: false }),
  had_cancellation: integerPg('had_cancellation').default(0).notNull(),
  notification_status: textPg('notification_status').$type<'in_progress' | 'completed' | 'paused' | null>(),
  next_notification_at: timestamp('next_notification_at', { withTimezone: false }),
  notification_paused: integerPg('notification_paused').default(0).notNull(),
}, (table) => ({
  requesterIdIdx: indexPg('idx_spare_requests_requester_id').on(table.requester_id),
  gameDateIdx: indexPg('idx_spare_requests_game_date').on(table.game_date),
  statusIdx: indexPg('idx_spare_requests_status').on(table.status),
}));

export const spareRequestInvitationsPg = pgTable('spare_request_invitations', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  spare_request_id: integerPg('spare_request_id').notNull().references(() => spareRequestsPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  requestIdIdx: indexPg('idx_spare_request_invitations_request_id').on(table.spare_request_id),
  memberIdIdx: indexPg('idx_spare_request_invitations_member_id').on(table.member_id),
  uniqueRequestMember: uniqueIndexPg('spare_request_invitations_spare_request_id_member_id_unique').on(table.spare_request_id, table.member_id),
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
  test_mode: integerPg('test_mode').default(0).notNull(),
  test_current_time: timestamp('test_current_time', { withTimezone: false }),
  notification_delay_seconds: integerPg('notification_delay_seconds').default(180).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});

export const spareRequestNotificationQueuePg = pgTable('spare_request_notification_queue', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  spare_request_id: integerPg('spare_request_id').notNull().references(() => spareRequestsPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  queue_order: integerPg('queue_order').notNull(),
  notified_at: timestamp('notified_at', { withTimezone: false }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  requestIdIdx: indexPg('idx_notification_queue_request_id').on(table.spare_request_id),
  orderIdx: indexPg('idx_notification_queue_order').on(table.spare_request_id, table.queue_order),
  notifiedIdx: indexPg('idx_notification_queue_notified').on(table.spare_request_id, table.notified_at),
  uniqueRequestMember: uniqueIndexPg('spare_request_notification_queue_spare_request_id_member_id_unique').on(table.spare_request_id, table.member_id),
}));
