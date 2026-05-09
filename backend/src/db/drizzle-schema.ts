import { sql, eq } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex, real } from 'drizzle-orm/sqlite-core';
import {
  pgTable,
  text as textPg,
  integer as integerPg,
  timestamp,
  time,
  date,
  index as indexPg,
  uniqueIndex as uniqueIndexPg,
  doublePrecision,
  jsonb,
} from 'drizzle-orm/pg-core';

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
  // Social members have membership without ice privileges (no sparing or league roster).
  social_member: integer('social_member').default(0).notNull(),
  is_admin: integer('is_admin').default(0).notNull(),
  is_server_admin: integer('is_server_admin').default(0).notNull(),
  is_calendar_admin: integer('is_calendar_admin').default(0).notNull(),
  is_content_admin: integer('is_content_admin').default(0).notNull(),
  is_sponsor_admin: integer('is_sponsor_admin').default(0).notNull(),
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

export const rolesSqlite = sqliteTable('roles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  is_system: integer('is_system').default(0).notNull(),
  is_computed: integer('is_computed').default(0).notNull(),
  is_assignable: integer('is_assignable').default(1).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  codeIdx: index('idx_roles_code').on(table.code),
  systemIdx: index('idx_roles_is_system').on(table.is_system),
}));

export const roleScopeRulesSqlite = sqliteTable('role_scope_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  role_id: integer('role_id').notNull().references(() => rolesSqlite.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  effect: text('effect').notNull().$type<'allow' | 'deny'>(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  roleIdIdx: index('idx_role_scope_rules_role_id').on(table.role_id),
  scopeIdx: index('idx_role_scope_rules_scope').on(table.scope),
  uniqueRoleScope: uniqueIndex('role_scope_rules_role_id_scope_unique').on(table.role_id, table.scope),
}));

export const memberRoleAssignmentsSqlite = sqliteTable('member_role_assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  role_id: integer('role_id').notNull().references(() => rolesSqlite.id, { onDelete: 'cascade' }),
  resource_type: text('resource_type'),
  resource_id: integer('resource_id'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  memberIdIdx: index('idx_member_role_assignments_member_id').on(table.member_id),
  roleIdIdx: index('idx_member_role_assignments_role_id').on(table.role_id),
  resourceIdx: index('idx_member_role_assignments_resource').on(table.resource_type, table.resource_id),
  uniqueMemberRoleContext: uniqueIndex('member_role_assignments_member_role_resource_unique').on(
    table.member_id,
    table.role_id,
    table.resource_type,
    table.resource_id
  ),
}));

export const memberAccountAccessDelegationsSqlite = sqliteTable('member_account_access_delegations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  grantor_member_id: integer('grantor_member_id')
    .notNull()
    .references(() => membersSqlite.id, { onDelete: 'cascade' }),
  grantee_member_id: integer('grantee_member_id')
    .notNull()
    .references(() => membersSqlite.id, { onDelete: 'cascade' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  grantorGranteeUnique: uniqueIndex('member_account_access_grantor_grantee_unique').on(
    table.grantor_member_id,
    table.grantee_member_id
  ),
  granteeIdx: index('idx_member_account_access_delegations_grantee').on(table.grantee_member_id),
}));

// ---------- Curling season / league registration (Phase 1) ----------
export type RegistrationPeriodStateSqlite = 'closed' | 'priority' | 'open';
export type CurlingRegistrationStatusSqlite =
  | 'draft'
  | 'submitted'
  | 'awaiting_staff_review'
  | 'awaiting_placement'
  | 'awaiting_payment'
  | 'payment_started'
  | 'paid'
  | 'confirmed'
  | 'cancelled';
export type CurlingMembershipOptionSqlite = 'none' | 'regular' | 'social' | 'regular_spare_only' | 'junior_recreational';
export type CurlingExperienceTypeSqlite = 'none_or_minimal' | 'specified_years' | 'known_existing';
export type CurlingRegistrationPaymentStatusSqlite =
  | 'unpaid'
  | 'checkout_started'
  | 'paid'
  | 'deferred'
  | 'failed'
  | 'refunded';

export type PolicyAcceptanceKindSqlite = 'code_of_conduct' | 'maapp' | 'privacy';
export type CurlingRegistrationSelectionKindSqlite =
  | 'guaranteed_return'
  | 'sabbatical'
  | 'drop'
  | 'return_subject_to_availability'
  | 'waitlist_add'
  | 'waitlist_replace'
  | 'third_league_interest'
  | 'byot_request'
  | 'junior_recreational'
  | 'spare_only';
export type CurlingRegistrationSelectionStatusSqlite =
  | 'draft'
  | 'pending'
  | 'confirmed'
  | 'waitlisted'
  | 'offered'
  | 'accepted'
  | 'declined'
  | 'placed'
  | 'not_placed'
  | 'dropped'
  | 'cancelled';

export type SeasonMembershipTypeSqlite = 'regular' | 'social' | 'junior_recreational';
export type SeasonMembershipStatusSqlite = 'pending' | 'active' | 'cancelled' | 'refunded' | 'expired';
export type IcePrivilegeSourceSqlite = 'league' | 'spare_only' | 'program' | 'staff_adjustment';

export type LeagueRosterPlacementStatusSqlite = 'pending' | 'active' | 'cancelled' | 'removed' | 'completed';
export type LeagueRosterPlacementTypeSqlite =
  | 'guaranteed_return'
  | 'new_placement'
  | 'waitlist_add'
  | 'waitlist_replace'
  | 'byot'
  | 'staff_manual'
  | 'temporary_sabbatical_fill';

export type CurlingLeagueSabbaticalStatusSqlite =
  | 'active'
  | 'returning'
  | 'released'
  | 'expired'
  | 'staff_overridden'
  | 'cancelled';

export type WaitlistEntryTypeSqlite = 'add' | 'replace';
export type WaitlistEntryStatusSqlite =
  | 'active'
  | 'offered'
  | 'accepted'
  | 'declined'
  | 'placed'
  | 'removed'
  | 'moved_to_bottom'
  | 'rolled_over'
  | 'cancelled';

export type WaitlistOfferKindSqlite = 'permanent' | 'temporary_sabbatical_fill';
export type WaitlistOfferStatusSqlite = 'pending' | 'accepted' | 'declined' | 'expired_accepted' | 'cancelled';

export type WaitlistAuditSourceSqlite =
  | 'registration_submission'
  | 'waitlist_rollover'
  | 'staff_action'
  | 'offer_response'
  | 'offer_expiration'
  | 'placement_process'
  | 'system_cleanup';

export type WaitlistAuditActionSqlite =
  | 'entry_created'
  | 'entry_removed'
  | 'entry_reordered'
  | 'entry_rolled_over'
  | 'entry_converted_add_to_replace'
  | 'entry_converted_replace_to_add'
  | 'replacement_league_changed'
  | 'offer_sent'
  | 'offer_accepted'
  | 'offer_declined'
  | 'offer_expired_accepted'
  | 'decline_count_changed'
  | 'entry_moved_to_bottom'
  | 'entry_placed'
  | 'staff_correction';

export type CurlingDiscountTypeSqlite = 'student' | 'reciprocal' | 'winter_only';
export type CurlingDiscountAmountTypeSqlite = 'dollar' | 'percent';
export type CurlingDiscountScopeSqlite = 'regular_membership' | 'eligible_invoice_items';

export type RegistrationInvoiceStatusSqlite =
  | 'draft'
  | 'deferred'
  | 'awaiting_payment'
  | 'checkout_started'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export type RegistrationInvoiceLineKindSqlite =
  | 'regular_membership_fee'
  | 'social_membership_fee'
  | 'league_fee'
  | 'spare_only_fee'
  | 'sabbatical_fee'
  | 'junior_recreational_fee'
  | 'student_discount'
  | 'reciprocal_discount'
  | 'winter_only_discount'
  | 'sabbatical_fill_discount'
  | 'financial_assistance_discount'
  | 'manual_adjustment';

export type FinancialAssistanceStatusSqlite = 'pending' | 'approved' | 'partially_approved' | 'denied' | 'withdrawn';

export type IcePrivilegeRowStatusSqlite = 'pending' | 'active' | 'inactive' | 'cancelled';

export const curlingSeasonsSqlite = sqliteTable('curling_seasons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  start_date: text('start_date').notNull(),
  end_date: text('end_date').notNull(),
  membership_starts_date: text('membership_starts_date').notNull(),
  membership_ends_date: text('membership_ends_date').notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
});

export const curlingSessionsSqlite = sqliteTable('curling_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  season_id: integer('season_id')
    .notNull()
    .references(() => curlingSeasonsSqlite.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  start_date: text('start_date').notNull(),
  end_date: text('end_date').notNull(),
  sort_order_within_season: integer('sort_order_within_season').default(0).notNull(),
  is_first_session_of_season: integer('is_first_session_of_season').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  seasonIdx: index('idx_curling_sessions_season_id').on(table.season_id),
  seasonSortIdx: index('idx_curling_sessions_season_sort').on(table.season_id, table.sort_order_within_season),
}));

export const leaguesSqlite = sqliteTable('leagues', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  session_id: integer('session_id').references(() => curlingSessionsSqlite.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  day_of_week: integer('day_of_week').notNull(),
  format: text('format').notNull().$type<'teams' | 'doubles'>(),
  start_date: text('start_date').notNull(),
  end_date: text('end_date').notNull(),
  league_type: text('league_type').notNull().default('standard').$type<'standard' | 'bring_your_own_team'>(),
  capacity_type: text('capacity_type').notNull().default('individual').$type<'individual' | 'team'>(),
  capacity_value: integer('capacity_value').default(0).notNull(),
  registration_fee_minor: integer('registration_fee_minor').default(0).notNull(),
  requires_club_membership: integer('requires_club_membership').default(1).notNull(),
  is_instructional: integer('is_instructional').default(0).notNull(),
  min_experience_years: integer('min_experience_years'),
  min_age: integer('min_age'),
  max_age: integer('max_age'),
  first_day_of_play: text('first_day_of_play'),
  last_day_of_play: text('last_day_of_play'),
  allows_waitlist: integer('allows_waitlist').default(1).notNull(),
  allows_sabbatical: integer('allows_sabbatical').default(1).notNull(),
  predecessor_league_id: integer('predecessor_league_id'),
  successor_league_id: integer('successor_league_id'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  sessionIdx: index('idx_leagues_session_id').on(table.session_id),
  predIdx: index('idx_leagues_predecessor_league_id').on(table.predecessor_league_id),
  succIdx: index('idx_leagues_successor_league_id').on(table.successor_league_id),
  leagueTypeIdx: index('idx_leagues_league_type').on(table.league_type),
}));

export const registrationPeriodsSqlite = sqliteTable('registration_periods', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  season_id: integer('season_id')
    .notNull()
    .references(() => curlingSeasonsSqlite.id, { onDelete: 'cascade' }),
  session_id: integer('session_id')
    .notNull()
    .references(() => curlingSessionsSqlite.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  current_state: text('current_state').notNull().default('closed').$type<RegistrationPeriodStateSqlite>(),
  priority_opens_at: text('priority_opens_at'),
  priority_closes_at: text('priority_closes_at'),
  open_registration_opens_at: text('open_registration_opens_at'),
  registration_closes_at: text('registration_closes_at'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  seasonIdx: index('idx_registration_periods_season_id').on(table.season_id),
  sessionIdx: index('idx_registration_periods_session_id').on(table.session_id),
  stateIdx: index('idx_registration_periods_current_state').on(table.current_state),
}));

export const curlingRegistrationsSqlite = sqliteTable('curling_registrations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  registration_period_id: integer('registration_period_id')
    .notNull()
    .references(() => registrationPeriodsSqlite.id, { onDelete: 'restrict' }),
  season_id: integer('season_id')
    .notNull()
    .references(() => curlingSeasonsSqlite.id, { onDelete: 'restrict' }),
  session_id: integer('session_id')
    .notNull()
    .references(() => curlingSessionsSqlite.id, { onDelete: 'restrict' }),
  curler_member_id: integer('curler_member_id')
    .notNull()
    .references(() => membersSqlite.id, { onDelete: 'restrict' }),
  submitted_by_member_id: integer('submitted_by_member_id')
    .notNull()
    .references(() => membersSqlite.id, { onDelete: 'restrict' }),
  registering_for_self: integer('registering_for_self').default(1).notNull(),
  returning_member_answer: integer('returning_member_answer'),
  status: text('status').notNull().default('draft').$type<CurlingRegistrationStatusSqlite>(),
  membership_option: text('membership_option')
    .notNull()
    .default('none')
    .$type<CurlingMembershipOptionSqlite>(),
  experience_type: text('experience_type')
    .notNull()
    .default('none_or_minimal')
    .$type<CurlingExperienceTypeSqlite>(),
  self_reported_experience_years: real('self_reported_experience_years'),
  student_discount_claimed: integer('student_discount_claimed').default(0).notNull(),
  student_institution: text('student_institution'),
  reciprocal_discount_claimed: integer('reciprocal_discount_claimed').default(0).notNull(),
  reciprocal_club_name: text('reciprocal_club_name'),
  winter_only_discount_applied: integer('winter_only_discount_applied').default(0).notNull(),
  junior_assistance_requested_percent: real('junior_assistance_requested_percent'),
  junior_assistance_decision: text('junior_assistance_decision'),
  deferred_payment: integer('deferred_payment').default(0).notNull(),
  deferred_payment_reason: text('deferred_payment_reason'),
  stripe_checkout_session_id: text('stripe_checkout_session_id'),
  payment_status: text('payment_status')
    .notNull()
    .default('unpaid')
    .$type<CurlingRegistrationPaymentStatusSqlite>(),
  submitted_at: text('submitted_at'),
  paid_at: text('paid_at'),
  cancelled_at: text('cancelled_at'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  periodIdx: index('idx_curling_registrations_registration_period_id').on(table.registration_period_id),
  seasonIdx: index('idx_curling_registrations_season_id').on(table.season_id),
  sessionIdx: index('idx_curling_registrations_session_id').on(table.session_id),
  curlerIdx: index('idx_curling_registrations_curler_member_id').on(table.curler_member_id),
  submitterIdx: index('idx_curling_registrations_submitted_by_member_id').on(table.submitted_by_member_id),
  statusIdx: index('idx_curling_registrations_status').on(table.status),
  payIdx: index('idx_curling_registrations_payment_status').on(table.payment_status),
}));

export const curlingLeagueSabbaticalsSqlite = sqliteTable('curling_league_sabbaticals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  member_id: integer('member_id')
    .notNull()
    .references(() => membersSqlite.id, { onDelete: 'restrict' }),
  lineage_key: text('lineage_key'),
  original_league_id: integer('original_league_id')
    .notNull()
    .references(() => leaguesSqlite.id, { onDelete: 'restrict' }),
  current_league_id: integer('current_league_id')
    .notNull()
    .references(() => leaguesSqlite.id, { onDelete: 'restrict' }),
  source_registration_id: integer('source_registration_id').references(() => curlingRegistrationsSqlite.id, {
    onDelete: 'set null',
  }),
  first_sabbatical_league_id: integer('first_sabbatical_league_id')
    .notNull()
    .references(() => leaguesSqlite.id, { onDelete: 'restrict' }),
  first_sabbatical_start_date: text('first_sabbatical_start_date').notNull(),
  status: text('status').notNull().default('active').$type<CurlingLeagueSabbaticalStatusSqlite>(),
  staff_override: integer('staff_override').default(0).notNull(),
  staff_override_reason: text('staff_override_reason'),
  released_at: text('released_at'),
  released_reason: text('released_reason'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  memberIdx: index('idx_curling_league_sabbaticals_member_id').on(table.member_id),
  leagueIdx: index('idx_curling_league_sabbaticals_current_league_id').on(table.current_league_id),
  statusIdx: index('idx_curling_league_sabbaticals_status').on(table.status),
  firstStartIdx: index('idx_curling_league_sabbaticals_first_start').on(table.first_sabbatical_start_date),
}));

export const registrationPolicyAcceptancesSqlite = sqliteTable('registration_policy_acceptances', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  registration_id: integer('registration_id')
    .notNull()
    .references(() => curlingRegistrationsSqlite.id, { onDelete: 'cascade' }),
  policy_type: text('policy_type').notNull().$type<PolicyAcceptanceKindSqlite>(),
  policy_url: text('policy_url').notNull(),
  accepted_by_member_id: integer('accepted_by_member_id')
    .notNull()
    .references(() => membersSqlite.id, { onDelete: 'restrict' }),
  accepted_for_member_id: integer('accepted_for_member_id')
    .notNull()
    .references(() => membersSqlite.id, { onDelete: 'restrict' }),
  accepted_at: text('accepted_at').notNull(),
  policy_version: text('policy_version'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  regIdx: index('idx_registration_policy_acceptances_registration_id').on(table.registration_id),
}));

export const registrationSelectionsSqlite = sqliteTable('registration_selections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  registration_id: integer('registration_id')
    .notNull()
    .references(() => curlingRegistrationsSqlite.id, { onDelete: 'cascade' }),
  league_id: integer('league_id').references(() => leaguesSqlite.id, { onDelete: 'set null' }),
  selection_type: text('selection_type').notNull().$type<CurlingRegistrationSelectionKindSqlite>(),
  rank: integer('rank'),
  replaces_league_id: integer('replaces_league_id').references(() => leaguesSqlite.id, { onDelete: 'set null' }),
  related_sabbatical_id: integer('related_sabbatical_id').references(() => curlingLeagueSabbaticalsSqlite.id, {
    onDelete: 'set null',
  }),
  is_temporary_sabbatical_fill: integer('is_temporary_sabbatical_fill').default(0).notNull(),
  byot_teammate_text: text('byot_teammate_text'),
  status: text('status').notNull().default('draft').$type<CurlingRegistrationSelectionStatusSqlite>(),
  fee_amount_minor_snapshot: integer('fee_amount_minor_snapshot').default(0).notNull(),
  discount_amount_minor_snapshot: integer('discount_amount_minor_snapshot').default(0).notNull(),
  notes: text('notes'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  regIdx: index('idx_registration_selections_registration_id').on(table.registration_id),
  leagueIdx: index('idx_registration_selections_league_id').on(table.league_id),
  typeIdx: index('idx_registration_selections_selection_type').on(table.selection_type),
  statusIdx: index('idx_registration_selections_status').on(table.status),
}));

export const financialAssistanceRequestsSqlite = sqliteTable('financial_assistance_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  registration_id: integer('registration_id')
    .notNull()
    .references(() => curlingRegistrationsSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id')
    .notNull()
    .references(() => membersSqlite.id, { onDelete: 'restrict' }),
  requested_percentage: real('requested_percentage').notNull(),
  approved_percentage: real('approved_percentage'),
  status: text('status').notNull().default('pending').$type<FinancialAssistanceStatusSqlite>(),
  reviewed_by_member_id: integer('reviewed_by_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  reviewed_at: text('reviewed_at'),
  staff_notes: text('staff_notes'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  regIdx: index('idx_financial_assistance_requests_registration_id').on(table.registration_id),
}));

export const registrationInvoicesSqlite = sqliteTable('registration_invoices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  registration_id: integer('registration_id')
    .notNull()
    .references(() => curlingRegistrationsSqlite.id, { onDelete: 'cascade' }),
  payer_member_id: integer('payer_member_id')
    .notNull()
    .references(() => membersSqlite.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('draft').$type<RegistrationInvoiceStatusSqlite>(),
  subtotal_minor: integer('subtotal_minor').default(0).notNull(),
  discount_minor: integer('discount_minor').default(0).notNull(),
  total_minor: integer('total_minor').default(0).notNull(),
  currency: text('currency').notNull().default('usd'),
  deferred: integer('deferred').default(0).notNull(),
  deferred_reason: text('deferred_reason'),
  stripe_checkout_session_id: text('stripe_checkout_session_id'),
  stripe_payment_intent_id: text('stripe_payment_intent_id'),
  payment_order_id: integer('payment_order_id'),
  paid_at: text('paid_at'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  regIdx: index('idx_registration_invoices_registration_id').on(table.registration_id),
  payerIdx: index('idx_registration_invoices_payer_member_id').on(table.payer_member_id),
  statusIdx: index('idx_registration_invoices_status').on(table.status),
  checkoutIdx: index('idx_registration_invoices_stripe_checkout_session_id').on(table.stripe_checkout_session_id),
}));

export const registrationInvoiceLineItemsSqlite = sqliteTable('registration_invoice_line_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invoice_id: integer('invoice_id')
    .notNull()
    .references(() => registrationInvoicesSqlite.id, { onDelete: 'cascade' }),
  line_type: text('line_type').notNull().$type<RegistrationInvoiceLineKindSqlite>(),
  description: text('description').notNull(),
  related_league_id: integer('related_league_id').references(() => leaguesSqlite.id, { onDelete: 'set null' }),
  related_selection_id: integer('related_selection_id').references(() => registrationSelectionsSqlite.id, {
    onDelete: 'set null',
  }),
  amount_minor: integer('amount_minor').notNull(),
  discount_eligible: integer('discount_eligible').default(1).notNull(),
  sort_order: integer('sort_order').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  invoiceIdx: index('idx_registration_invoice_line_items_invoice_id').on(table.invoice_id),
}));

export const registrationPriceConfigsSqlite = sqliteTable('registration_price_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  season_id: integer('season_id')
    .notNull()
    .references(() => curlingSeasonsSqlite.id, { onDelete: 'cascade' }),
  session_id: integer('session_id').references(() => curlingSessionsSqlite.id, { onDelete: 'cascade' }),
  regular_membership_fee_minor: integer('regular_membership_fee_minor').default(0).notNull(),
  social_membership_fee_minor: integer('social_membership_fee_minor').default(0).notNull(),
  spare_only_ice_privilege_fee_minor: integer('spare_only_ice_privilege_fee_minor').default(0).notNull(),
  sabbatical_fee_minor: integer('sabbatical_fee_minor').default(0).notNull(),
  junior_recreational_fee_minor: integer('junior_recreational_fee_minor').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  seasonIdx: index('idx_registration_price_configs_season_id').on(table.season_id),
  sessionIdx: index('idx_registration_price_configs_session_id').on(table.session_id),
}));

export const registrationDiscountConfigsSqlite = sqliteTable('registration_discount_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  season_id: integer('season_id')
    .notNull()
    .references(() => curlingSeasonsSqlite.id, { onDelete: 'cascade' }),
  discount_type: text('discount_type').notNull().$type<CurlingDiscountTypeSqlite>(),
  amount_type: text('amount_type').notNull().$type<CurlingDiscountAmountTypeSqlite>(),
  amount_value: real('amount_value').notNull(),
  applies_to_scope: text('applies_to_scope').notNull().$type<CurlingDiscountScopeSqlite>(),
  active: integer('active').default(1).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  seasonIdx: index('idx_registration_discount_configs_season_id').on(table.season_id),
}));

export const seasonMembershipsSqlite = sqliteTable('season_memberships', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  member_id: integer('member_id')
    .notNull()
    .references(() => membersSqlite.id, { onDelete: 'restrict' }),
  season_id: integer('season_id')
    .notNull()
    .references(() => curlingSeasonsSqlite.id, { onDelete: 'cascade' }),
  membership_type: text('membership_type').notNull().$type<SeasonMembershipTypeSqlite>(),
  starts_at: text('starts_at').notNull(),
  ends_at: text('ends_at').notNull(),
  source_registration_id: integer('source_registration_id').references(() => curlingRegistrationsSqlite.id, {
    onDelete: 'set null',
  }),
  payment_order_id: integer('payment_order_id'),
  status: text('status').notNull().default('pending').$type<SeasonMembershipStatusSqlite>(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  memberIdx: index('idx_season_memberships_member_id').on(table.member_id),
  seasonIdx: index('idx_season_memberships_season_id').on(table.season_id),
}));

export const curlingIcePrivilegesSqlite = sqliteTable('curling_ice_privileges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  member_id: integer('member_id')
    .notNull()
    .references(() => membersSqlite.id, { onDelete: 'restrict' }),
  season_id: integer('season_id')
    .notNull()
    .references(() => curlingSeasonsSqlite.id, { onDelete: 'cascade' }),
  session_id: integer('session_id')
    .notNull()
    .references(() => curlingSessionsSqlite.id, { onDelete: 'cascade' }),
  source_type: text('source_type').notNull().$type<IcePrivilegeSourceSqlite>(),
  source_registration_id: integer('source_registration_id').references(() => curlingRegistrationsSqlite.id, {
    onDelete: 'set null',
  }),
  source_league_id: integer('source_league_id').references(() => leaguesSqlite.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending').$type<IcePrivilegeRowStatusSqlite>(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  memberIdx: index('idx_curling_ice_privileges_member_id').on(table.member_id),
}));

export const curlingSabbaticalSessionsSqlite = sqliteTable('curling_sabbatical_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sabbatical_id: integer('sabbatical_id')
    .notNull()
    .references(() => curlingLeagueSabbaticalsSqlite.id, { onDelete: 'cascade' }),
  league_id: integer('league_id')
    .notNull()
    .references(() => leaguesSqlite.id, { onDelete: 'restrict' }),
  registration_id: integer('registration_id').references(() => curlingRegistrationsSqlite.id, { onDelete: 'set null' }),
  fee_amount_minor: integer('fee_amount_minor').default(0).notNull(),
  payment_status: text('payment_status').notNull().default('unpaid'),
  starts_at: text('starts_at'),
  ends_at: text('ends_at'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  sabIdx: index('idx_curling_sabbatical_sessions_sabbatical_id').on(table.sabbatical_id),
}));

export const waitlistEntriesSqlite = sqliteTable('waitlist_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  member_id: integer('member_id')
    .notNull()
    .references(() => membersSqlite.id, { onDelete: 'cascade' }),
  league_id: integer('league_id')
    .notNull()
    .references(() => leaguesSqlite.id, { onDelete: 'cascade' }),
  source_registration_id: integer('source_registration_id').references(() => curlingRegistrationsSqlite.id, {
    onDelete: 'set null',
  }),
  entry_type: text('entry_type').notNull().$type<WaitlistEntryTypeSqlite>(),
  replaces_league_id: integer('replaces_league_id').references(() => leaguesSqlite.id, { onDelete: 'set null' }),
  position_sort_key: text('position_sort_key').notNull(),
  joined_at: text('joined_at').notNull(),
  decline_count: integer('decline_count').default(0).notNull(),
  status: text('status').notNull().default('active').$type<WaitlistEntryStatusSqlite>(),
  rolled_over_from_waitlist_entry_id: integer('rolled_over_from_waitlist_entry_id'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  leagueIdx: index('idx_waitlist_entries_league_id').on(table.league_id),
  memberIdx: index('idx_waitlist_entries_member_id').on(table.member_id),
  statusIdx: index('idx_waitlist_entries_status').on(table.status),
  entryTypeIdx: index('idx_waitlist_entries_entry_type').on(table.entry_type),
  posIdx: index('idx_waitlist_entries_position_sort_key').on(table.position_sort_key),
  joinedIdx: index('idx_waitlist_entries_joined_at').on(table.joined_at),
  sourceRegIdx: index('idx_waitlist_entries_source_registration_id').on(table.source_registration_id),
  replacesIdx: index('idx_waitlist_entries_replaces_league_id').on(table.replaces_league_id),
  activeMemberLeaguePartial: uniqueIndex('idx_waitlist_entries_active_member_league').on(
    table.member_id,
    table.league_id
  ).where(eq(table.status, 'active')),
}));

export const waitlistOffersSqlite = sqliteTable('waitlist_offers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  waitlist_entry_id: integer('waitlist_entry_id')
    .notNull()
    .references(() => waitlistEntriesSqlite.id, { onDelete: 'cascade' }),
  league_id: integer('league_id')
    .notNull()
    .references(() => leaguesSqlite.id, { onDelete: 'restrict' }),
  member_id: integer('member_id')
    .notNull()
    .references(() => membersSqlite.id, { onDelete: 'restrict' }),
  offer_type: text('offer_type').notNull().$type<WaitlistOfferKindSqlite>(),
  status: text('status').notNull().default('pending').$type<WaitlistOfferStatusSqlite>(),
  offered_at: text('offered_at').notNull(),
  expires_at: text('expires_at').notNull(),
  responded_at: text('responded_at'),
  response_source: text('response_source'),
  offered_by_member_id: integer('offered_by_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  source_registration_id: integer('source_registration_id').references(() => curlingRegistrationsSqlite.id, {
    onDelete: 'set null',
  }),
  payment_link_id: text('payment_link_id'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  entryIdx: index('idx_waitlist_offers_waitlist_entry_id').on(table.waitlist_entry_id),
  leagueIdx: index('idx_waitlist_offers_league_id').on(table.league_id),
  memberIdx: index('idx_waitlist_offers_member_id').on(table.member_id),
  statusIdx: index('idx_waitlist_offers_status').on(table.status),
  expiresIdx: index('idx_waitlist_offers_expires_at').on(table.expires_at),
}));

export const waitlistAuditEventsSqlite = sqliteTable('waitlist_audit_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  waitlist_entry_id: integer('waitlist_entry_id').references(() => waitlistEntriesSqlite.id, {
    onDelete: 'set null',
  }),
  league_id: integer('league_id').references(() => leaguesSqlite.id, { onDelete: 'set null' }),
  member_id: integer('member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  actor_member_id: integer('actor_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  source: text('source').notNull().$type<WaitlistAuditSourceSqlite>(),
  action: text('action').notNull().$type<WaitlistAuditActionSqlite>(),
  reason: text('reason'),
  before_json: text('before_json'),
  after_json: text('after_json'),
  metadata_json: text('metadata_json'),
  created_at: text('created_at').notNull(),
}, (table) => ({
  entryIdx: index('idx_waitlist_audit_events_waitlist_entry_id').on(table.waitlist_entry_id),
  leagueIdx: index('idx_waitlist_audit_events_league_id').on(table.league_id),
  memberIdx: index('idx_waitlist_audit_events_member_id').on(table.member_id),
  actorIdx: index('idx_waitlist_audit_events_actor_member_id').on(table.actor_member_id),
  createdIdx: index('idx_waitlist_audit_events_created_at').on(table.created_at),
  actionIdx: index('idx_waitlist_audit_events_action').on(table.action),
}));

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

export const leagueExtraDrawsSqlite = sqliteTable('league_extra_draws', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  league_id: integer('league_id').notNull().references(() => leaguesSqlite.id, { onDelete: 'cascade' }),
  draw_date: text('draw_date').notNull(), // YYYY-MM-DD
  draw_time: text('draw_time').notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  leagueIdIdx: index('idx_league_extra_draws_league_id').on(table.league_id),
  dateTimeIdx: index('idx_league_extra_draws_date_time').on(table.league_id, table.draw_date, table.draw_time),
  uniqueDraw: uniqueIndex('league_extra_draws_league_id_date_time_unique').on(
    table.league_id,
    table.draw_date,
    table.draw_time
  ),
}));

export const drawSheetAvailabilitySqlite = sqliteTable('draw_sheet_availability', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  league_id: integer('league_id').notNull().references(() => leaguesSqlite.id, { onDelete: 'cascade' }),
  draw_date: text('draw_date').notNull(),
  draw_time: text('draw_time').notNull(),
  sheet_id: integer('sheet_id').notNull().references(() => sheetsSqlite.id, { onDelete: 'cascade' }),
  is_available: integer('is_available').default(1).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  leagueIdIdx: index('idx_draw_sheet_availability_league_id').on(table.league_id),
  drawIdx: index('idx_draw_sheet_availability_draw').on(table.league_id, table.draw_date, table.draw_time),
  sheetIdx: index('idx_draw_sheet_availability_sheet_id').on(table.sheet_id),
  uniqueDrawSheet: uniqueIndex('draw_sheet_availability_unique').on(
    table.league_id,
    table.draw_date,
    table.draw_time,
    table.sheet_id
  ),
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
  prefer_late_draw: integer('prefer_late_draw').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  leagueIdIdx: index('idx_league_teams_league_id').on(table.league_id),
  divisionIdIdx: index('idx_league_teams_division_id').on(table.division_id),
}));

export const gamesSqlite = sqliteTable('games', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  league_id: integer('league_id').notNull().references(() => leaguesSqlite.id, { onDelete: 'cascade' }),
  team1_id: integer('team1_id').notNull().references(() => leagueTeamsSqlite.id, { onDelete: 'restrict' }),
  team2_id: integer('team2_id').notNull().references(() => leagueTeamsSqlite.id, { onDelete: 'restrict' }),
  game_date: text('game_date'),
  game_time: text('game_time'),
  sheet_id: integer('sheet_id').references(() => sheetsSqlite.id, { onDelete: 'set null' }),
  status: text('status').default('unscheduled').notNull().$type<'scheduled' | 'unscheduled'>(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  leagueIdIdx: index('idx_games_league_id').on(table.league_id),
  team1Idx: index('idx_games_team1_id').on(table.team1_id),
  team2Idx: index('idx_games_team2_id').on(table.team2_id),
  sheetIdx: index('idx_games_sheet_id').on(table.sheet_id),
  leagueScheduleIdx: index('idx_games_league_date_time').on(table.league_id, table.game_date, table.game_time),
  sheetScheduleIdx: uniqueIndex('games_sheet_date_time_unique').on(table.sheet_id, table.game_date, table.game_time),
}));

export const leagueSettingsSqlite = sqliteTable('league_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  league_id: integer('league_id').notNull().references(() => leaguesSqlite.id, { onDelete: 'cascade' }),
  head_to_head_first: integer('head_to_head_first').default(0).notNull(),
  result_labels: text('result_labels'), // JSON array of strings, e.g. ["Win/Loss", "Score"]
  collect_bye_requests: integer('collect_bye_requests').default(1).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  leagueIdIdx: index('idx_league_settings_league_id').on(table.league_id),
  uniqueLeague: uniqueIndex('league_settings_league_id_unique').on(table.league_id),
}));

export const teamByeRequestsSqlite = sqliteTable('team_bye_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  team_id: integer('team_id').notNull().references(() => leagueTeamsSqlite.id, { onDelete: 'cascade' }),
  draw_date: text('draw_date').notNull(),
  priority: integer('priority').notNull(),
  note: text('note'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  teamIdIdx: index('idx_team_bye_requests_team_id').on(table.team_id),
  drawDateIdx: index('idx_team_bye_requests_draw_date').on(table.draw_date),
}));

export const gameResultsSqlite = sqliteTable('game_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  game_id: integer('game_id').notNull().references(() => gamesSqlite.id, { onDelete: 'cascade' }),
  team_id: integer('team_id').notNull().references(() => leagueTeamsSqlite.id, { onDelete: 'cascade' }),
  result_order: integer('result_order').notNull(),
  value: integer('value').notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  gameIdIdx: index('idx_game_results_game_id').on(table.game_id),
  teamIdIdx: index('idx_game_results_team_id').on(table.team_id),
  standingsIdx: index('idx_game_results_game_team').on(table.game_id, table.team_id),
}));

export const gameLineupsSqlite = sqliteTable('game_lineups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  game_id: integer('game_id').notNull().references(() => gamesSqlite.id, { onDelete: 'cascade' }),
  team_id: integer('team_id').notNull().references(() => leagueTeamsSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  role: text('role').notNull().$type<'lead' | 'second' | 'third' | 'fourth' | 'player1' | 'player2'>(),
  is_spare: integer('is_spare').default(0).notNull(),
  sparing_for_member_id: integer('sparing_for_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  gameIdIdx: index('idx_game_lineups_game_id').on(table.game_id),
  teamIdIdx: index('idx_game_lineups_team_id').on(table.team_id),
  memberIdIdx: index('idx_game_lineups_member_id').on(table.member_id),
  statsIdx: index('idx_game_lineups_member_stats').on(table.member_id),
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
  source_registration_id: integer('source_registration_id').references(() => curlingRegistrationsSqlite.id, {
    onDelete: 'set null',
  }),
  status: text('status').default('active').notNull().$type<LeagueRosterPlacementStatusSqlite>(),
  placement_type: text('placement_type').$type<LeagueRosterPlacementTypeSqlite>(),
  is_temporary_sabbatical_fill: integer('is_temporary_sabbatical_fill').default(0).notNull(),
  related_sabbatical_id: integer('related_sabbatical_id').references(() => curlingLeagueSabbaticalsSqlite.id, {
    onDelete: 'set null',
  }),
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
  game_id: integer('game_id').references(() => gamesSqlite.id, { onDelete: 'set null' }),
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
  gameIdIdx: index('idx_spare_requests_game_id').on(table.game_id),
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

export const paymentOrdersSqlite = sqliteTable('payment_orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  order_token: text('order_token').notNull().unique(),
  provider: text('provider').notNull().$type<'stripe' | 'paypal' | 'square'>(),
  subject_type: text('subject_type').notNull().$type<
    'donation' | 'membership' | 'event_registration' | 'curling_registration'
  >(),
  subject_id: integer('subject_id'),
  amount_minor: integer('amount_minor').notNull(),
  currency: text('currency').notNull().default('usd'),
  status: text('status')
    .notNull()
    .default('created')
    .$type<'created' | 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded'>(),
  status_reason: text('status_reason'),
  provider_order_id: text('provider_order_id'),
  metadata: text('metadata'),
  created_by_member_id: integer('created_by_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  completed_at: text('completed_at'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  statusIdx: index('idx_payment_orders_status').on(table.status),
  subjectIdx: index('idx_payment_orders_subject').on(table.subject_type, table.subject_id),
  providerOrderIdx: uniqueIndex('payment_orders_provider_provider_order_id_unique').on(table.provider, table.provider_order_id),
}));

export const paymentTransactionsSqlite = sqliteTable('payment_transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  payment_order_id: integer('payment_order_id').notNull().references(() => paymentOrdersSqlite.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().$type<'stripe' | 'paypal' | 'square'>(),
  provider_transaction_id: text('provider_transaction_id').notNull(),
  transaction_type: text('transaction_type').notNull().$type<'charge' | 'capture' | 'refund' | 'adjustment'>(),
  amount_minor: integer('amount_minor').notNull(),
  currency: text('currency').notNull().default('usd'),
  fee_minor: integer('fee_minor'),
  status: text('status')
    .notNull()
    .default('pending')
    .$type<'created' | 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded'>(),
  occurred_at: text('occurred_at'),
  metadata: text('metadata'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  orderIdx: index('idx_payment_transactions_order_id').on(table.payment_order_id),
  statusIdx: index('idx_payment_transactions_status').on(table.status),
  providerTxnIdx: uniqueIndex('payment_transactions_provider_transaction_id_unique').on(
    table.provider,
    table.provider_transaction_id
  ),
}));

export const paymentEventsSqlite = sqliteTable('payment_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  provider: text('provider').notNull().$type<'stripe' | 'paypal' | 'square'>(),
  provider_event_id: text('provider_event_id').notNull(),
  event_type: text('event_type').notNull(),
  payment_order_id: integer('payment_order_id').references(() => paymentOrdersSqlite.id, { onDelete: 'set null' }),
  processing_status: text('processing_status')
    .notNull()
    .default('received')
    .$type<'received' | 'processed' | 'ignored' | 'failed'>(),
  raw_payload: text('raw_payload').notNull(),
  received_at: text('received_at').default(sql`datetime('now')`).notNull(),
  processed_at: text('processed_at'),
}, (table) => ({
  providerEventIdx: uniqueIndex('payment_events_provider_event_unique').on(table.provider, table.provider_event_id),
  orderIdx: index('idx_payment_events_order_id').on(table.payment_order_id),
  statusIdx: index('idx_payment_events_processing_status').on(table.processing_status),
}));

export const refundsSqlite = sqliteTable('refunds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  payment_order_id: integer('payment_order_id').notNull().references(() => paymentOrdersSqlite.id, { onDelete: 'cascade' }),
  payment_transaction_id: integer('payment_transaction_id').references(() => paymentTransactionsSqlite.id, { onDelete: 'set null' }),
  provider: text('provider').notNull().$type<'stripe' | 'paypal' | 'square'>(),
  amount_minor: integer('amount_minor').notNull(),
  currency: text('currency').notNull().default('usd'),
  reason: text('reason'),
  status: text('status')
    .notNull()
    .default('requested')
    .$type<'requested' | 'approved' | 'rejected' | 'processing' | 'succeeded' | 'failed'>(),
  requested_by_member_id: integer('requested_by_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  approved_by_member_id: integer('approved_by_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  provider_refund_id: text('provider_refund_id'),
  provider_response: text('provider_response'),
  processed_at: text('processed_at'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  orderIdx: index('idx_refunds_order_id').on(table.payment_order_id),
  statusIdx: index('idx_refunds_status').on(table.status),
  providerRefundIdx: uniqueIndex('refunds_provider_refund_id_unique').on(table.provider, table.provider_refund_id),
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

// Calendar events (direct entries)
export const calendarEventsSqlite = sqliteTable('calendar_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source').default('direct').notNull().$type<'direct'>(),
  type_id: text('type_id').notNull(),
  title: text('title').notNull(),
  start_dt: text('start_dt').notNull(),
  end_dt: text('end_dt').notNull(),
  all_day: integer('all_day').default(0).notNull(),
  recurrence_rule: text('recurrence_rule'),
  parent_event_id: integer('parent_event_id'),
  recurrence_date: text('recurrence_date'),
  description: text('description'),
  article_id: integer('article_id'),
  created_by_member_id: integer('created_by_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  startDtIdx: index('idx_calendar_events_start_dt').on(table.start_dt),
  parentIdIdx: index('idx_calendar_events_parent_id').on(table.parent_event_id),
  recurrenceIdx: index('idx_calendar_events_recurrence_date').on(table.parent_event_id, table.recurrence_date),
}));

export const calendarEventLocationsSqlite = sqliteTable('calendar_event_locations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  event_id: integer('event_id').notNull().references(() => calendarEventsSqlite.id, { onDelete: 'cascade' }),
  location_type: text('location_type').notNull().$type<'sheet' | 'warm-room' | 'exterior' | 'offsite' | 'virtual'>(),
  sheet_id: integer('sheet_id').references(() => sheetsSqlite.id, { onDelete: 'cascade' }),
}, (table) => ({
  eventIdIdx: index('idx_calendar_event_locations_event_id').on(table.event_id),
}));

export const calendarEventExceptionsSqlite = sqliteTable('calendar_event_exceptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  parent_event_id: integer('parent_event_id').notNull().references(() => calendarEventsSqlite.id, { onDelete: 'cascade' }),
  exception_date: text('exception_date').notNull(),
}, (table) => ({
  parentIdIdx: index('idx_calendar_event_exceptions_parent_id').on(table.parent_event_id),
  uniqueParentDate: uniqueIndex('calendar_event_exceptions_parent_date_unique').on(table.parent_event_id, table.exception_date),
}));

export const iceBookingsSqlite = sqliteTable('ice_bookings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  sheet_id: integer('sheet_id').notNull().references(() => sheetsSqlite.id, { onDelete: 'cascade' }),
  start_dt: text('start_dt').notNull(),
  end_dt: text('end_dt').notNull(),
  purpose: text('purpose')
    .notNull()
    .$type<'practice' | 'makeup_game' | 'guests_new' | 'guests_experienced' | 'other'>(),
  purpose_other: text('purpose_other'),
  guest_names: text('guest_names'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  memberIdx: index('idx_ice_bookings_member_id').on(table.member_id),
  sheetIdx: index('idx_ice_bookings_sheet_id').on(table.sheet_id),
  rangeIdx: index('idx_ice_bookings_sheet_range').on(table.sheet_id, table.start_dt, table.end_dt),
}));

// Articles (Markdown or HTML content, public pages)
export const articlesSqlite = sqliteTable('articles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  content_type: text('content_type').default('markdown').notNull(),
  content: text('content').notNull(),
  snippet: text('snippet'),
  featured: integer('featured').default(0).notNull(),
  featured_sort_order: integer('featured_sort_order').default(0).notNull(),
  published_at: text('published_at'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
  created_by_member_id: integer('created_by_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
}, (table) => ({
  slugIdx: index('idx_articles_slug').on(table.slug),
  featuredIdx: index('idx_articles_featured').on(table.featured),
  publishedIdx: index('idx_articles_published_at').on(table.published_at),
}));

export const articleVersionsSqlite = sqliteTable('article_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  article_id: integer('article_id').notNull().references(() => articlesSqlite.id, { onDelete: 'cascade' }),
  version_number: integer('version_number').notNull(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  content_type: text('content_type').default('markdown').notNull(),
  content: text('content').notNull(),
  revision_note: text('revision_note'),
  is_small_edit: integer('is_small_edit').default(0).notNull(),
  snippet: text('snippet'),
  featured: integer('featured').default(0).notNull(),
  published_at: text('published_at'),
  saved_by_member_id: integer('saved_by_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  articleIdx: index('idx_article_versions_article_id').on(table.article_id),
  articleVersionUnique: uniqueIndex('article_versions_article_id_version_number_unique').on(table.article_id, table.version_number),
  createdIdx: index('idx_article_versions_created_at').on(table.created_at),
}));

// Site config (club branding, contact - public-facing)
export const siteConfigSqlite = sqliteTable('site_config', {
  id: integer('id').primaryKey(),
  club_name: text('club_name'),
  logo_url: text('logo_url'),
  contact_email: text('contact_email'),
  contact_phone: text('contact_phone'),
  footer_markdown: text('footer_markdown'),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
});

// Showcase images for homepage (URLs only)
export const showcaseImagesSqlite = sqliteTable('showcase_images', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  url: text('url').notNull(),
  caption: text('caption'),
  sort_order: integer('sort_order').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  sortIdx: index('idx_showcase_images_sort_order').on(table.sort_order),
}));

// Short permalinks → redirect to internal or external URLs (/go/:slug)
export const permalinksSqlite = sqliteTable('permalinks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  label: text('label'),
  notes: text('notes'),
  destination_url: text('destination_url').notNull(),
  destination_may_change: integer('destination_may_change').default(0).notNull(),
  /** YOURLS (or other) pre-migration click total; added to totalHits and uniqueVisitors in admin stats. */
  legacy_click_count: integer('legacy_click_count').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  slugIdx: index('idx_permalinks_slug').on(table.slug),
}));

export const permalinkHitsSqlite = sqliteTable('permalink_hits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  permalink_id: integer('permalink_id').notNull().references(() => permalinksSqlite.id, { onDelete: 'cascade' }),
  occurred_at: text('occurred_at').default(sql`datetime('now')`).notNull(),
  visitor_id: text('visitor_id').notNull(),
  member_id: integer('member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  referrer_domain: text('referrer_domain'),
}, (table) => ({
  permalinkIdx: index('idx_permalink_hits_permalink_id').on(table.permalink_id),
  occurredIdx: index('idx_permalink_hits_occurred_at').on(table.occurred_at),
}));

// Menu items for dynamic navigation (hierarchical)
export const menuItemsSqlite = sqliteTable('menu_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  menu_type: text('menu_type').default('navbar').notNull(),
  parent_id: integer('parent_id'),
  label: text('label').notNull(),
  sort_order: integer('sort_order').default(0).notNull(),
  link_type: text('link_type').$type<'internal' | 'external'>(),
  url: text('url'),
  open_in_new_tab: integer('open_in_new_tab').default(0).notNull(),
  article_id: integer('article_id').references(() => articlesSqlite.id, { onDelete: 'set null' }),
  use_article_title_for_label: integer('use_article_title_for_label').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  menuTypeIdx: index('idx_menu_items_menu_type').on(table.menu_type),
  parentIdIdx: index('idx_menu_items_parent_id').on(table.parent_id),
  sortOrderIdx: index('idx_menu_items_sort_order').on(table.sort_order),
  articleIdIdx: index('idx_menu_items_article_id').on(table.article_id),
}));

export const filesSqlite = sqliteTable('files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  storage_key: text('storage_key').notNull().unique(),
  original_filename: text('original_filename').notNull(),
  display_name: text('display_name'),
  description: text('description'),
  mime_type: text('mime_type').notNull(),
  byte_size: integer('byte_size').notNull(),
  visibility: text('visibility').default('public').notNull().$type<'public' | 'authenticated'>(),
  checksum_sha256: text('checksum_sha256'),
  thumbnail_storage_key: text('thumbnail_storage_key'),
  thumbnail_mime_type: text('thumbnail_mime_type'),
  thumbnail_byte_size: integer('thumbnail_byte_size'),
  thumbnail_checksum_sha256: text('thumbnail_checksum_sha256'),
  uploaded_by_member_id: integer('uploaded_by_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  suspected_orphan: integer('suspected_orphan').default(0).notNull(),
  last_referenced_at: text('last_referenced_at'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  storageKeyIdx: uniqueIndex('files_storage_key_unique').on(table.storage_key),
  visibilityIdx: index('idx_files_visibility').on(table.visibility),
  uploadedByIdx: index('idx_files_uploaded_by_member_id').on(table.uploaded_by_member_id),
  createdAtIdx: index('idx_files_created_at').on(table.created_at),
  suspectedOrphanIdx: index('idx_files_suspected_orphan').on(table.suspected_orphan),
}));

export const sponsorshipLevelsSqlite = sqliteTable('sponsorship_levels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  amount: integer('amount').notNull(),
  sort_order: integer('sort_order').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  sortIdx: index('idx_sponsorship_levels_sort_order').on(table.sort_order),
  uniqueName: uniqueIndex('sponsorship_levels_name_unique').on(table.name),
}));

export const sponsorsSqlite = sqliteTable('sponsors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  website_url: text('website_url').notNull(),
  logo_file_id: integer('logo_file_id').references(() => filesSqlite.id, { onDelete: 'set null' }),
  contact_name: text('contact_name'),
  contact_email: text('contact_email'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  nameIdx: index('idx_sponsors_name').on(table.name),
}));

export const sponsorshipsSqlite = sqliteTable('sponsorships', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sponsor_id: integer('sponsor_id').notNull().references(() => sponsorsSqlite.id, { onDelete: 'cascade' }),
  sponsorship_level_id: integer('sponsorship_level_id').notNull().references(() => sponsorshipLevelsSqlite.id, { onDelete: 'restrict' }),
  start_date: text('start_date'),
  end_date: text('end_date'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  sponsorIdx: index('idx_sponsorships_sponsor_id').on(table.sponsor_id),
  levelIdx: index('idx_sponsorships_sponsorship_level_id').on(table.sponsorship_level_id),
  datesIdx: index('idx_sponsorships_dates').on(table.start_date, table.end_date),
}));

export const governanceSettingsSqlite = sqliteTable('governance_settings', {
  id: integer('id').primaryKey(),
  fiscal_year_start_mmdd: text('fiscal_year_start_mmdd').notNull(), // MM-DD
  board_turnover_mmdd: text('board_turnover_mmdd').notNull(), // MM-DD
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
});

export const governanceBoardMembersSqlite = sqliteTable('governance_board_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  public_email: text('public_email'),
  first_fiscal_year: integer('first_fiscal_year').notNull(),
  last_fiscal_year: integer('last_fiscal_year').notNull(),
  manual_inactive: integer('manual_inactive').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  memberIdx: index('idx_governance_board_members_member_id').on(table.member_id),
  uniqueMember: uniqueIndex('governance_board_members_member_id_unique').on(table.member_id),
}));

export const governanceCommitteesSqlite = sqliteTable('governance_committees', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  contact_info: text('contact_info'),
  responsibilities: text('responsibilities'),
  board_liaison_board_member_id: integer('board_liaison_board_member_id').references(
    () => governanceBoardMembersSqlite.id,
    { onDelete: 'set null' }
  ),
  sort_order: integer('sort_order').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  uniqueName: uniqueIndex('governance_committees_name_unique').on(table.name),
  liaisonIdx: index('idx_governance_committees_liaison_id').on(table.board_liaison_board_member_id),
  sortIdx: index('idx_governance_committees_sort_order').on(table.sort_order),
}));

export const governanceCommitteeChairsSqlite = sqliteTable('governance_committee_chairs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  committee_id: integer('committee_id').notNull().references(() => governanceCommitteesSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  public_email: text('public_email'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  committeeIdx: index('idx_governance_committee_chairs_committee_id').on(table.committee_id),
  memberIdx: index('idx_governance_committee_chairs_member_id').on(table.member_id),
  uniqueCommitteeMember: uniqueIndex('governance_committee_chairs_committee_id_member_id_unique').on(
    table.committee_id,
    table.member_id
  ),
}));

export const governanceBoardMemberCommitteesSqlite = sqliteTable('governance_board_member_committees', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  board_member_id: integer('board_member_id').notNull().references(() => governanceBoardMembersSqlite.id, { onDelete: 'cascade' }),
  committee_id: integer('committee_id').notNull().references(() => governanceCommitteesSqlite.id, { onDelete: 'cascade' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  boardMemberIdx: index('idx_governance_board_member_committees_board_member_id').on(table.board_member_id),
  committeeIdx: index('idx_governance_board_member_committees_committee_id').on(table.committee_id),
  uniqueBoardMemberCommittee: uniqueIndex('governance_board_member_committees_board_member_id_committee_id_unique').on(
    table.board_member_id,
    table.committee_id
  ),
}));

export const governanceOfficersSqlite = sqliteTable('governance_officers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  position: text('position').notNull().$type<'president' | 'vice_president' | 'treasurer' | 'secretary'>(),
  board_member_id: integer('board_member_id').notNull().references(() => governanceBoardMembersSqlite.id, { onDelete: 'cascade' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  uniquePosition: uniqueIndex('governance_officers_position_unique').on(table.position),
  uniqueBoardMember: uniqueIndex('governance_officers_board_member_id_unique').on(table.board_member_id),
  boardMemberIdx: index('idx_governance_officers_board_member_id').on(table.board_member_id),
}));

// ========== Events System (SQLite) ==========

export type EventVisibility = 'public' | 'active_members' | 'ice_members';
export type EventRegistrationStatus = 'confirmed' | 'pending_payment' | 'waitlisted' | 'cancelled';
export type EventFieldType =
  | 'text'
  | 'number'
  | 'checkbox'
  | 'dropdown'
  | 'radio'
  | 'subheading'
  | 'preset_phone'
  | 'preset_address'
  | 'preset_team_four'
  | 'preset_team_doubles'
  | 'preset_dob';
export type EventFieldScope = 'group' | 'individual';

export const eventCategoriesSqlite = sqliteTable('event_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  sort_order: integer('sort_order').default(0).notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  slugIdx: uniqueIndex('event_categories_slug_unique').on(table.slug),
}));

export const eventsSqlite = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  article_id: integer('article_id').references(() => articlesSqlite.id, { onDelete: 'set null' }),
  image_file_id: integer('image_file_id').references(() => filesSqlite.id, { onDelete: 'set null' }),
  visibility: text('visibility').default('public').notNull().$type<EventVisibility>(),
  published: integer('published').default(0).notNull(),
  capacity: integer('capacity'),
  fee_minor: integer('fee_minor').default(0).notNull(),
  /** When set, logged-in members pay this per-person amount instead of fee_minor. */
  member_fee_minor: integer('member_fee_minor'),
  currency: text('currency').default('usd').notNull(),
  registration_start: text('registration_start'),
  registration_cutoff: text('registration_cutoff'),
  cancellation_cutoff: text('cancellation_cutoff'),
  allow_group_registration: integer('allow_group_registration').default(0).notNull(),
  max_group_size: integer('max_group_size'),
  enable_waitlist: integer('enable_waitlist').default(1).notNull(),
  /** Matches calendar DEFAULT_EVENT_TYPES ids shown on the club calendar. */
  calendar_type_id: text('calendar_type_id').default('other').notNull(),
  /** When 1, bonspiel team list is shown on the public event page (when type is bonspiel). */
  tournament_teams_published: integer('tournament_teams_published').default(0).notNull(),
  /** When 1, bonspiel draw is shown on the public event page (when type is bonspiel). */
  tournament_draw_published: integer('tournament_draw_published').default(0).notNull(),
  /** Bonspiel roster shape: fours (5 positions) or doubles (2). */
  tournament_format: text('tournament_format').$type<'fours' | 'doubles' | null>(),
  /** Versioned bonspiel bracket/draw graph JSON (see eventTournamentDrawSchema). */
  tournament_draw_json: text('tournament_draw_json'),
  terms_article_id: integer('terms_article_id').references(() => articlesSqlite.id, { onDelete: 'set null' }),
  created_by_member_id: integer('created_by_member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  slugIdx: uniqueIndex('events_slug_unique').on(table.slug),
  publishedIdx: index('idx_events_published').on(table.published),
  visibilityIdx: index('idx_events_visibility').on(table.visibility),
}));

export const eventTimespansSqlite = sqliteTable('event_timespans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  event_id: integer('event_id').notNull().references(() => eventsSqlite.id, { onDelete: 'cascade' }),
  start_dt: text('start_dt').notNull(),
  end_dt: text('end_dt').notNull(),
  sort_order: integer('sort_order').default(0).notNull(),
}, (table) => ({
  eventIdx: index('idx_event_timespans_event_id').on(table.event_id),
  startIdx: index('idx_event_timespans_start_dt').on(table.start_dt),
}));

export const eventLocationsSqlite = sqliteTable('event_locations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  event_id: integer('event_id').notNull().references(() => eventsSqlite.id, { onDelete: 'cascade' }),
  location_type: text('location_type').notNull().$type<'sheet' | 'warm-room' | 'exterior' | 'offsite' | 'virtual'>(),
  sheet_id: integer('sheet_id').references(() => sheetsSqlite.id, { onDelete: 'cascade' }),
}, (table) => ({
  eventIdx: index('idx_event_locations_event_id').on(table.event_id),
}));

export const eventCategoryAssignmentsSqlite = sqliteTable('event_category_assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  event_id: integer('event_id').notNull().references(() => eventsSqlite.id, { onDelete: 'cascade' }),
  category_id: integer('category_id').notNull().references(() => eventCategoriesSqlite.id, { onDelete: 'cascade' }),
}, (table) => ({
  eventIdx: index('idx_event_category_assignments_event_id').on(table.event_id),
  categoryIdx: index('idx_event_category_assignments_category_id').on(table.category_id),
  uniqueAssignment: uniqueIndex('event_category_assignments_event_category_unique').on(table.event_id, table.category_id),
}));

export const eventOwnersSqlite = sqliteTable('event_owners', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  event_id: integer('event_id').notNull().references(() => eventsSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id').notNull().references(() => membersSqlite.id, { onDelete: 'cascade' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  eventIdx: index('idx_event_owners_event_id').on(table.event_id),
  memberIdx: index('idx_event_owners_member_id').on(table.member_id),
  uniqueOwner: uniqueIndex('event_owners_event_member_unique').on(table.event_id, table.member_id),
}));

export const eventRegistrationFieldsSqlite = sqliteTable('event_registration_fields', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  event_id: integer('event_id').notNull().references(() => eventsSqlite.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  field_type: text('field_type').notNull().$type<EventFieldType>(),
  scope: text('scope').default('group').notNull().$type<EventFieldScope>(),
  required: integer('required').default(0).notNull(),
  options: text('options'),
  sort_order: integer('sort_order').default(0).notNull(),
}, (table) => ({
  eventIdx: index('idx_event_registration_fields_event_id').on(table.event_id),
}));

export const eventRegistrationsSqlite = sqliteTable('event_registrations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  event_id: integer('event_id').notNull().references(() => eventsSqlite.id, { onDelete: 'cascade' }),
  member_id: integer('member_id').references(() => membersSqlite.id, { onDelete: 'set null' }),
  contact_name: text('contact_name').notNull(),
  contact_email: text('contact_email').notNull(),
  status: text('status').default('pending_payment').notNull().$type<EventRegistrationStatus>(),
  group_size: integer('group_size').default(1).notNull(),
  payment_order_id: integer('payment_order_id'),
  special_link_id: integer('special_link_id'),
  waitlist_position: integer('waitlist_position'),
  registered_at: text('registered_at').default(sql`datetime('now')`).notNull(),
  cancelled_at: text('cancelled_at'),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  eventIdx: index('idx_event_registrations_event_id').on(table.event_id),
  memberIdx: index('idx_event_registrations_member_id').on(table.member_id),
  statusIdx: index('idx_event_registrations_status').on(table.status),
}));

export const eventRegistrationMembersSqlite = sqliteTable('event_registration_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  registration_id: integer('registration_id').notNull().references(() => eventRegistrationsSqlite.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email'),
  sort_order: integer('sort_order').default(0).notNull(),
}, (table) => ({
  registrationIdx: index('idx_event_registration_members_registration_id').on(table.registration_id),
}));

export const eventRegistrationFieldValuesSqlite = sqliteTable('event_registration_field_values', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  registration_id: integer('registration_id').notNull().references(() => eventRegistrationsSqlite.id, { onDelete: 'cascade' }),
  field_id: integer('field_id').notNull().references(() => eventRegistrationFieldsSqlite.id, { onDelete: 'cascade' }),
  registration_member_id: integer('registration_member_id').references(() => eventRegistrationMembersSqlite.id, { onDelete: 'cascade' }),
  value: text('value'),
}, (table) => ({
  registrationIdx: index('idx_event_reg_field_values_registration_id').on(table.registration_id),
  fieldIdx: index('idx_event_reg_field_values_field_id').on(table.field_id),
}));

export const eventSpecialLinksSqlite = sqliteTable('event_special_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  event_id: integer('event_id').notNull().references(() => eventsSqlite.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  label: text('label'),
  override_fee_minor: integer('override_fee_minor'),
  max_group_size: integer('max_group_size'),
  bypass_capacity: integer('bypass_capacity').default(0).notNull(),
  ignore_registration_dates: integer('ignore_registration_dates').default(0).notNull(),
  used: integer('used').default(0).notNull(),
  invalidated: integer('invalidated').default(0).notNull(),
  used_by_registration_id: integer('used_by_registration_id').references(() => eventRegistrationsSqlite.id, { onDelete: 'set null' }),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  eventIdx: index('idx_event_special_links_event_id').on(table.event_id),
  tokenIdx: uniqueIndex('event_special_links_token_unique').on(table.token),
}));

export const eventTournamentTeamsSqlite = sqliteTable('event_tournament_teams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  event_id: integer('event_id').notNull().references(() => eventsSqlite.id, { onDelete: 'cascade' }),
  sort_order: integer('sort_order').default(0).notNull(),
  team_name: text('team_name'),
  home_club: text('home_club'),
  vice_slot_code: text('vice_slot_code').notNull(),
  skip_slot_code: text('skip_slot_code').notNull(),
  created_at: text('created_at').default(sql`datetime('now')`).notNull(),
  updated_at: text('updated_at').default(sql`datetime('now')`).notNull(),
}, (table) => ({
  eventIdx: index('idx_event_tournament_teams_event_id').on(table.event_id),
}));

export const eventTournamentRosterSlotsSqlite = sqliteTable('event_tournament_roster_slots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  team_id: integer('team_id').notNull().references(() => eventTournamentTeamsSqlite.id, { onDelete: 'cascade' }),
  slot_code: text('slot_code').notNull(),
  player_name: text('player_name'),
  email: text('email'),
  notes: text('notes'),
}, (table) => ({
  teamIdx: index('idx_event_tournament_roster_team_id').on(table.team_id),
  uniqueSlot: uniqueIndex('event_tournament_roster_team_slot_unique').on(table.team_id, table.slot_code),
}));

// ========== PostgreSQL Schema ==========
export const membersPg = pgTable('members', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  name: textPg('name').notNull(),
  email: textPg('email').notNull(),
  phone: textPg('phone'),
  valid_through: date('valid_through'),
  spare_only: integerPg('spare_only').default(0).notNull(),
  social_member: integerPg('social_member').default(0).notNull(),
  is_admin: integerPg('is_admin').default(0).notNull(),
  is_server_admin: integerPg('is_server_admin').default(0).notNull(),
  is_calendar_admin: integerPg('is_calendar_admin').default(0).notNull(),
  is_content_admin: integerPg('is_content_admin').default(0).notNull(),
  is_sponsor_admin: integerPg('is_sponsor_admin').default(0).notNull(),
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

export const rolesPg = pgTable('roles', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  code: textPg('code').notNull().unique(),
  name: textPg('name').notNull(),
  description: textPg('description'),
  is_system: integerPg('is_system').default(0).notNull(),
  is_computed: integerPg('is_computed').default(0).notNull(),
  is_assignable: integerPg('is_assignable').default(1).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  codeIdx: indexPg('idx_roles_code').on(table.code),
  systemIdx: indexPg('idx_roles_is_system').on(table.is_system),
}));

export const roleScopeRulesPg = pgTable('role_scope_rules', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  role_id: integerPg('role_id').notNull().references(() => rolesPg.id, { onDelete: 'cascade' }),
  scope: textPg('scope').notNull(),
  effect: textPg('effect').notNull().$type<'allow' | 'deny'>(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  roleIdIdx: indexPg('idx_role_scope_rules_role_id').on(table.role_id),
  scopeIdx: indexPg('idx_role_scope_rules_scope').on(table.scope),
  uniqueRoleScope: uniqueIndexPg('role_scope_rules_role_id_scope_unique').on(table.role_id, table.scope),
}));

export const memberRoleAssignmentsPg = pgTable('member_role_assignments', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  role_id: integerPg('role_id').notNull().references(() => rolesPg.id, { onDelete: 'cascade' }),
  resource_type: textPg('resource_type'),
  resource_id: integerPg('resource_id'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  memberIdIdx: indexPg('idx_member_role_assignments_member_id').on(table.member_id),
  roleIdIdx: indexPg('idx_member_role_assignments_role_id').on(table.role_id),
  resourceIdx: indexPg('idx_member_role_assignments_resource').on(table.resource_type, table.resource_id),
  uniqueMemberRoleContext: uniqueIndexPg('member_role_assignments_member_role_resource_unique').on(
    table.member_id,
    table.role_id,
    table.resource_type,
    table.resource_id
  ),
}));

export const memberAccountAccessDelegationsPg = pgTable('member_account_access_delegations', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  grantor_member_id: integerPg('grantor_member_id')
    .notNull()
    .references(() => membersPg.id, { onDelete: 'cascade' }),
  grantee_member_id: integerPg('grantee_member_id')
    .notNull()
    .references(() => membersPg.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  grantorGranteeUnique: uniqueIndexPg('member_account_access_grantor_grantee_unique').on(
    table.grantor_member_id,
    table.grantee_member_id
  ),
  granteeIdx: indexPg('idx_member_account_access_delegations_grantee').on(table.grantee_member_id),
}));

export const curlingSeasonsPg = pgTable('curling_seasons', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  name: textPg('name').notNull(),
  start_date: date('start_date').notNull(),
  end_date: date('end_date').notNull(),
  membership_starts_date: date('membership_starts_date').notNull(),
  membership_ends_date: date('membership_ends_date').notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});

export const curlingSessionsPg = pgTable('curling_sessions', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  season_id: integerPg('season_id')
    .notNull()
    .references(() => curlingSeasonsPg.id, { onDelete: 'restrict' }),
  name: textPg('name').notNull(),
  start_date: date('start_date').notNull(),
  end_date: date('end_date').notNull(),
  sort_order_within_season: integerPg('sort_order_within_season').default(0).notNull(),
  is_first_session_of_season: integerPg('is_first_session_of_season').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  seasonIdx: indexPg('idx_curling_sessions_season_id').on(table.season_id),
  seasonSortIdx: indexPg('idx_curling_sessions_season_sort').on(table.season_id, table.sort_order_within_season),
}));

export const leaguesPg = pgTable('leagues', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  session_id: integerPg('session_id').references(() => curlingSessionsPg.id, { onDelete: 'set null' }),
  name: textPg('name').notNull(),
  day_of_week: integerPg('day_of_week').notNull(),
  format: textPg('format').notNull().$type<'teams' | 'doubles'>(),
  start_date: date('start_date').notNull(),
  end_date: date('end_date').notNull(),
  league_type: textPg('league_type').notNull().default('standard').$type<'standard' | 'bring_your_own_team'>(),
  capacity_type: textPg('capacity_type').notNull().default('individual').$type<'individual' | 'team'>(),
  capacity_value: integerPg('capacity_value').default(0).notNull(),
  registration_fee_minor: integerPg('registration_fee_minor').default(0).notNull(),
  requires_club_membership: integerPg('requires_club_membership').default(1).notNull(),
  is_instructional: integerPg('is_instructional').default(0).notNull(),
  min_experience_years: integerPg('min_experience_years'),
  min_age: integerPg('min_age'),
  max_age: integerPg('max_age'),
  first_day_of_play: date('first_day_of_play'),
  last_day_of_play: date('last_day_of_play'),
  allows_waitlist: integerPg('allows_waitlist').default(1).notNull(),
  allows_sabbatical: integerPg('allows_sabbatical').default(1).notNull(),
  predecessor_league_id: integerPg('predecessor_league_id'),
  successor_league_id: integerPg('successor_league_id'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  sessionIdx: indexPg('idx_leagues_session_id').on(table.session_id),
  predIdx: indexPg('idx_leagues_predecessor_league_id').on(table.predecessor_league_id),
  succIdx: indexPg('idx_leagues_successor_league_id').on(table.successor_league_id),
  leagueTypeIdx: indexPg('idx_leagues_league_type').on(table.league_type),
}));

export const registrationPeriodsPg = pgTable('registration_periods', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  season_id: integerPg('season_id')
    .notNull()
    .references(() => curlingSeasonsPg.id, { onDelete: 'cascade' }),
  session_id: integerPg('session_id')
    .notNull()
    .references(() => curlingSessionsPg.id, { onDelete: 'cascade' }),
  name: textPg('name').notNull(),
  current_state: textPg('current_state').notNull().default('closed').$type<RegistrationPeriodStateSqlite>(),
  priority_opens_at: timestamp('priority_opens_at', { withTimezone: false }),
  priority_closes_at: timestamp('priority_closes_at', { withTimezone: false }),
  open_registration_opens_at: timestamp('open_registration_opens_at', { withTimezone: false }),
  registration_closes_at: timestamp('registration_closes_at', { withTimezone: false }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  seasonIdx: indexPg('idx_registration_periods_season_id').on(table.season_id),
  sessionIdx: indexPg('idx_registration_periods_session_id').on(table.session_id),
  stateIdx: indexPg('idx_registration_periods_current_state').on(table.current_state),
}));

export const curlingRegistrationsPg = pgTable('curling_registrations', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  registration_period_id: integerPg('registration_period_id')
    .notNull()
    .references(() => registrationPeriodsPg.id, { onDelete: 'restrict' }),
  season_id: integerPg('season_id')
    .notNull()
    .references(() => curlingSeasonsPg.id, { onDelete: 'restrict' }),
  session_id: integerPg('session_id')
    .notNull()
    .references(() => curlingSessionsPg.id, { onDelete: 'restrict' }),
  curler_member_id: integerPg('curler_member_id')
    .notNull()
    .references(() => membersPg.id, { onDelete: 'restrict' }),
  submitted_by_member_id: integerPg('submitted_by_member_id')
    .notNull()
    .references(() => membersPg.id, { onDelete: 'restrict' }),
  registering_for_self: integerPg('registering_for_self').default(1).notNull(),
  returning_member_answer: integerPg('returning_member_answer'),
  status: textPg('status').notNull().default('draft').$type<CurlingRegistrationStatusSqlite>(),
  membership_option: textPg('membership_option')
    .notNull()
    .default('none')
    .$type<CurlingMembershipOptionSqlite>(),
  experience_type: textPg('experience_type')
    .notNull()
    .default('none_or_minimal')
    .$type<CurlingExperienceTypeSqlite>(),
  self_reported_experience_years: doublePrecision('self_reported_experience_years'),
  student_discount_claimed: integerPg('student_discount_claimed').default(0).notNull(),
  student_institution: textPg('student_institution'),
  reciprocal_discount_claimed: integerPg('reciprocal_discount_claimed').default(0).notNull(),
  reciprocal_club_name: textPg('reciprocal_club_name'),
  winter_only_discount_applied: integerPg('winter_only_discount_applied').default(0).notNull(),
  junior_assistance_requested_percent: doublePrecision('junior_assistance_requested_percent'),
  junior_assistance_decision: textPg('junior_assistance_decision'),
  deferred_payment: integerPg('deferred_payment').default(0).notNull(),
  deferred_payment_reason: textPg('deferred_payment_reason'),
  stripe_checkout_session_id: textPg('stripe_checkout_session_id'),
  payment_status: textPg('payment_status')
    .notNull()
    .default('unpaid')
    .$type<CurlingRegistrationPaymentStatusSqlite>(),
  submitted_at: timestamp('submitted_at', { withTimezone: false }),
  paid_at: timestamp('paid_at', { withTimezone: false }),
  cancelled_at: timestamp('cancelled_at', { withTimezone: false }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  periodIdx: indexPg('idx_curling_registrations_registration_period_id').on(table.registration_period_id),
  seasonIdx: indexPg('idx_curling_registrations_season_id').on(table.season_id),
  sessionIdx: indexPg('idx_curling_registrations_session_id').on(table.session_id),
  curlerIdx: indexPg('idx_curling_registrations_curler_member_id').on(table.curler_member_id),
  submitterIdx: indexPg('idx_curling_registrations_submitted_by_member_id').on(table.submitted_by_member_id),
  statusIdx: indexPg('idx_curling_registrations_status').on(table.status),
  payIdx: indexPg('idx_curling_registrations_payment_status').on(table.payment_status),
}));

export const curlingLeagueSabbaticalsPg = pgTable('curling_league_sabbaticals', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  member_id: integerPg('member_id')
    .notNull()
    .references(() => membersPg.id, { onDelete: 'restrict' }),
  lineage_key: textPg('lineage_key'),
  original_league_id: integerPg('original_league_id')
    .notNull()
    .references(() => leaguesPg.id, { onDelete: 'restrict' }),
  current_league_id: integerPg('current_league_id')
    .notNull()
    .references(() => leaguesPg.id, { onDelete: 'restrict' }),
  source_registration_id: integerPg('source_registration_id').references(() => curlingRegistrationsPg.id, {
    onDelete: 'set null',
  }),
  first_sabbatical_league_id: integerPg('first_sabbatical_league_id')
    .notNull()
    .references(() => leaguesPg.id, { onDelete: 'restrict' }),
  first_sabbatical_start_date: date('first_sabbatical_start_date').notNull(),
  status: textPg('status').notNull().default('active').$type<CurlingLeagueSabbaticalStatusSqlite>(),
  staff_override: integerPg('staff_override').default(0).notNull(),
  staff_override_reason: textPg('staff_override_reason'),
  released_at: timestamp('released_at', { withTimezone: false }),
  released_reason: textPg('released_reason'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  memberIdx: indexPg('idx_curling_league_sabbaticals_member_id').on(table.member_id),
  leagueIdx: indexPg('idx_curling_league_sabbaticals_current_league_id').on(table.current_league_id),
  statusIdx: indexPg('idx_curling_league_sabbaticals_status').on(table.status),
  firstStartIdx: indexPg('idx_curling_league_sabbaticals_first_start').on(table.first_sabbatical_start_date),
}));

export const registrationPolicyAcceptancesPg = pgTable('registration_policy_acceptances', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  registration_id: integerPg('registration_id')
    .notNull()
    .references(() => curlingRegistrationsPg.id, { onDelete: 'cascade' }),
  policy_type: textPg('policy_type').notNull().$type<PolicyAcceptanceKindSqlite>(),
  policy_url: textPg('policy_url').notNull(),
  accepted_by_member_id: integerPg('accepted_by_member_id')
    .notNull()
    .references(() => membersPg.id, { onDelete: 'restrict' }),
  accepted_for_member_id: integerPg('accepted_for_member_id')
    .notNull()
    .references(() => membersPg.id, { onDelete: 'restrict' }),
  accepted_at: timestamp('accepted_at', { withTimezone: false }).notNull(),
  policy_version: textPg('policy_version'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  regIdx: indexPg('idx_registration_policy_acceptances_registration_id').on(table.registration_id),
}));

export const registrationSelectionsPg = pgTable('registration_selections', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  registration_id: integerPg('registration_id')
    .notNull()
    .references(() => curlingRegistrationsPg.id, { onDelete: 'cascade' }),
  league_id: integerPg('league_id').references(() => leaguesPg.id, { onDelete: 'set null' }),
  selection_type: textPg('selection_type').notNull().$type<CurlingRegistrationSelectionKindSqlite>(),
  rank: integerPg('rank'),
  replaces_league_id: integerPg('replaces_league_id').references(() => leaguesPg.id, { onDelete: 'set null' }),
  related_sabbatical_id: integerPg('related_sabbatical_id').references(() => curlingLeagueSabbaticalsPg.id, {
    onDelete: 'set null',
  }),
  is_temporary_sabbatical_fill: integerPg('is_temporary_sabbatical_fill').default(0).notNull(),
  byot_teammate_text: textPg('byot_teammate_text'),
  status: textPg('status').notNull().default('draft').$type<CurlingRegistrationSelectionStatusSqlite>(),
  fee_amount_minor_snapshot: integerPg('fee_amount_minor_snapshot').default(0).notNull(),
  discount_amount_minor_snapshot: integerPg('discount_amount_minor_snapshot').default(0).notNull(),
  notes: textPg('notes'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  regIdx: indexPg('idx_registration_selections_registration_id').on(table.registration_id),
  leagueIdx: indexPg('idx_registration_selections_league_id').on(table.league_id),
  typeIdx: indexPg('idx_registration_selections_selection_type').on(table.selection_type),
  statusIdx: indexPg('idx_registration_selections_status').on(table.status),
}));

export const financialAssistanceRequestsPg = pgTable('financial_assistance_requests', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  registration_id: integerPg('registration_id')
    .notNull()
    .references(() => curlingRegistrationsPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id')
    .notNull()
    .references(() => membersPg.id, { onDelete: 'restrict' }),
  requested_percentage: doublePrecision('requested_percentage').notNull(),
  approved_percentage: doublePrecision('approved_percentage'),
  status: textPg('status').notNull().default('pending').$type<FinancialAssistanceStatusSqlite>(),
  reviewed_by_member_id: integerPg('reviewed_by_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  reviewed_at: timestamp('reviewed_at', { withTimezone: false }),
  staff_notes: textPg('staff_notes'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  regIdx: indexPg('idx_financial_assistance_requests_registration_id').on(table.registration_id),
}));

export const registrationInvoicesPg = pgTable('registration_invoices', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  registration_id: integerPg('registration_id')
    .notNull()
    .references(() => curlingRegistrationsPg.id, { onDelete: 'cascade' }),
  payer_member_id: integerPg('payer_member_id')
    .notNull()
    .references(() => membersPg.id, { onDelete: 'restrict' }),
  status: textPg('status').notNull().default('draft').$type<RegistrationInvoiceStatusSqlite>(),
  subtotal_minor: integerPg('subtotal_minor').default(0).notNull(),
  discount_minor: integerPg('discount_minor').default(0).notNull(),
  total_minor: integerPg('total_minor').default(0).notNull(),
  currency: textPg('currency').notNull().default('usd'),
  deferred: integerPg('deferred').default(0).notNull(),
  deferred_reason: textPg('deferred_reason'),
  stripe_checkout_session_id: textPg('stripe_checkout_session_id'),
  stripe_payment_intent_id: textPg('stripe_payment_intent_id'),
  payment_order_id: integerPg('payment_order_id'),
  paid_at: timestamp('paid_at', { withTimezone: false }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  regIdx: indexPg('idx_registration_invoices_registration_id').on(table.registration_id),
  payerIdx: indexPg('idx_registration_invoices_payer_member_id').on(table.payer_member_id),
  statusIdx: indexPg('idx_registration_invoices_status').on(table.status),
  checkoutIdx: indexPg('idx_registration_invoices_stripe_checkout_session_id').on(table.stripe_checkout_session_id),
}));

export const registrationInvoiceLineItemsPg = pgTable('registration_invoice_line_items', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  invoice_id: integerPg('invoice_id')
    .notNull()
    .references(() => registrationInvoicesPg.id, { onDelete: 'cascade' }),
  line_type: textPg('line_type').notNull().$type<RegistrationInvoiceLineKindSqlite>(),
  description: textPg('description').notNull(),
  related_league_id: integerPg('related_league_id').references(() => leaguesPg.id, { onDelete: 'set null' }),
  related_selection_id: integerPg('related_selection_id').references(() => registrationSelectionsPg.id, {
    onDelete: 'set null',
  }),
  amount_minor: integerPg('amount_minor').notNull(),
  discount_eligible: integerPg('discount_eligible').default(1).notNull(),
  sort_order: integerPg('sort_order').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  invoiceIdx: indexPg('idx_registration_invoice_line_items_invoice_id').on(table.invoice_id),
}));

export const registrationPriceConfigsPg = pgTable('registration_price_configs', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  season_id: integerPg('season_id')
    .notNull()
    .references(() => curlingSeasonsPg.id, { onDelete: 'cascade' }),
  session_id: integerPg('session_id').references(() => curlingSessionsPg.id, { onDelete: 'cascade' }),
  regular_membership_fee_minor: integerPg('regular_membership_fee_minor').default(0).notNull(),
  social_membership_fee_minor: integerPg('social_membership_fee_minor').default(0).notNull(),
  spare_only_ice_privilege_fee_minor: integerPg('spare_only_ice_privilege_fee_minor').default(0).notNull(),
  sabbatical_fee_minor: integerPg('sabbatical_fee_minor').default(0).notNull(),
  junior_recreational_fee_minor: integerPg('junior_recreational_fee_minor').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  seasonIdx: indexPg('idx_registration_price_configs_season_id').on(table.season_id),
  sessionIdx: indexPg('idx_registration_price_configs_session_id').on(table.session_id),
}));

export const registrationDiscountConfigsPg = pgTable('registration_discount_configs', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  season_id: integerPg('season_id')
    .notNull()
    .references(() => curlingSeasonsPg.id, { onDelete: 'cascade' }),
  discount_type: textPg('discount_type').notNull().$type<CurlingDiscountTypeSqlite>(),
  amount_type: textPg('amount_type').notNull().$type<CurlingDiscountAmountTypeSqlite>(),
  amount_value: doublePrecision('amount_value').notNull(),
  applies_to_scope: textPg('applies_to_scope').notNull().$type<CurlingDiscountScopeSqlite>(),
  active: integerPg('active').default(1).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  seasonIdx: indexPg('idx_registration_discount_configs_season_id').on(table.season_id),
}));

export const seasonMembershipsPg = pgTable('season_memberships', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  member_id: integerPg('member_id')
    .notNull()
    .references(() => membersPg.id, { onDelete: 'restrict' }),
  season_id: integerPg('season_id')
    .notNull()
    .references(() => curlingSeasonsPg.id, { onDelete: 'cascade' }),
  membership_type: textPg('membership_type').notNull().$type<SeasonMembershipTypeSqlite>(),
  starts_at: timestamp('starts_at', { withTimezone: false }).notNull(),
  ends_at: timestamp('ends_at', { withTimezone: false }).notNull(),
  source_registration_id: integerPg('source_registration_id').references(() => curlingRegistrationsPg.id, {
    onDelete: 'set null',
  }),
  payment_order_id: integerPg('payment_order_id'),
  status: textPg('status').notNull().default('pending').$type<SeasonMembershipStatusSqlite>(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  memberIdx: indexPg('idx_season_memberships_member_id').on(table.member_id),
  seasonIdx: indexPg('idx_season_memberships_season_id').on(table.season_id),
}));

export const curlingIcePrivilegesPg = pgTable('curling_ice_privileges', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  member_id: integerPg('member_id')
    .notNull()
    .references(() => membersPg.id, { onDelete: 'restrict' }),
  season_id: integerPg('season_id')
    .notNull()
    .references(() => curlingSeasonsPg.id, { onDelete: 'cascade' }),
  session_id: integerPg('session_id')
    .notNull()
    .references(() => curlingSessionsPg.id, { onDelete: 'cascade' }),
  source_type: textPg('source_type').notNull().$type<IcePrivilegeSourceSqlite>(),
  source_registration_id: integerPg('source_registration_id').references(() => curlingRegistrationsPg.id, {
    onDelete: 'set null',
  }),
  source_league_id: integerPg('source_league_id').references(() => leaguesPg.id, { onDelete: 'set null' }),
  status: textPg('status').notNull().default('pending').$type<IcePrivilegeRowStatusSqlite>(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  memberIdx: indexPg('idx_curling_ice_privileges_member_id').on(table.member_id),
}));

export const curlingSabbaticalSessionsPg = pgTable('curling_sabbatical_sessions', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  sabbatical_id: integerPg('sabbatical_id')
    .notNull()
    .references(() => curlingLeagueSabbaticalsPg.id, { onDelete: 'cascade' }),
  league_id: integerPg('league_id')
    .notNull()
    .references(() => leaguesPg.id, { onDelete: 'restrict' }),
  registration_id: integerPg('registration_id').references(() => curlingRegistrationsPg.id, { onDelete: 'set null' }),
  fee_amount_minor: integerPg('fee_amount_minor').default(0).notNull(),
  payment_status: textPg('payment_status').notNull().default('unpaid'),
  starts_at: timestamp('starts_at', { withTimezone: false }),
  ends_at: timestamp('ends_at', { withTimezone: false }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  sabIdx: indexPg('idx_curling_sabbatical_sessions_sabbatical_id').on(table.sabbatical_id),
}));

export const waitlistEntriesPg = pgTable('waitlist_entries', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  member_id: integerPg('member_id')
    .notNull()
    .references(() => membersPg.id, { onDelete: 'cascade' }),
  league_id: integerPg('league_id')
    .notNull()
    .references(() => leaguesPg.id, { onDelete: 'cascade' }),
  source_registration_id: integerPg('source_registration_id').references(() => curlingRegistrationsPg.id, {
    onDelete: 'set null',
  }),
  entry_type: textPg('entry_type').notNull().$type<WaitlistEntryTypeSqlite>(),
  replaces_league_id: integerPg('replaces_league_id').references(() => leaguesPg.id, { onDelete: 'set null' }),
  position_sort_key: textPg('position_sort_key').notNull(),
  joined_at: timestamp('joined_at', { withTimezone: false }).notNull(),
  decline_count: integerPg('decline_count').default(0).notNull(),
  status: textPg('status').notNull().default('active').$type<WaitlistEntryStatusSqlite>(),
  rolled_over_from_waitlist_entry_id: integerPg('rolled_over_from_waitlist_entry_id'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  leagueIdx: indexPg('idx_waitlist_entries_league_id').on(table.league_id),
  memberIdx: indexPg('idx_waitlist_entries_member_id').on(table.member_id),
  statusIdx: indexPg('idx_waitlist_entries_status').on(table.status),
  entryTypeIdx: indexPg('idx_waitlist_entries_entry_type').on(table.entry_type),
  posIdx: indexPg('idx_waitlist_entries_position_sort_key').on(table.position_sort_key),
  joinedIdx: indexPg('idx_waitlist_entries_joined_at').on(table.joined_at),
  sourceRegIdx: indexPg('idx_waitlist_entries_source_registration_id').on(table.source_registration_id),
  replacesIdx: indexPg('idx_waitlist_entries_replaces_league_id').on(table.replaces_league_id),
  activeMemberLeaguePartial: uniqueIndexPg('idx_waitlist_entries_active_member_league').on(
    table.member_id,
    table.league_id
  ).where(eq(table.status, 'active')),
}));

export const waitlistOffersPg = pgTable('waitlist_offers', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  waitlist_entry_id: integerPg('waitlist_entry_id')
    .notNull()
    .references(() => waitlistEntriesPg.id, { onDelete: 'cascade' }),
  league_id: integerPg('league_id')
    .notNull()
    .references(() => leaguesPg.id, { onDelete: 'restrict' }),
  member_id: integerPg('member_id')
    .notNull()
    .references(() => membersPg.id, { onDelete: 'restrict' }),
  offer_type: textPg('offer_type').notNull().$type<WaitlistOfferKindSqlite>(),
  status: textPg('status').notNull().default('pending').$type<WaitlistOfferStatusSqlite>(),
  offered_at: timestamp('offered_at', { withTimezone: false }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: false }).notNull(),
  responded_at: timestamp('responded_at', { withTimezone: false }),
  response_source: textPg('response_source'),
  offered_by_member_id: integerPg('offered_by_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  source_registration_id: integerPg('source_registration_id').references(() => curlingRegistrationsPg.id, {
    onDelete: 'set null',
  }),
  payment_link_id: textPg('payment_link_id'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  entryIdx: indexPg('idx_waitlist_offers_waitlist_entry_id').on(table.waitlist_entry_id),
  leagueIdx: indexPg('idx_waitlist_offers_league_id').on(table.league_id),
  memberIdx: indexPg('idx_waitlist_offers_member_id').on(table.member_id),
  statusIdx: indexPg('idx_waitlist_offers_status').on(table.status),
  expiresIdx: indexPg('idx_waitlist_offers_expires_at').on(table.expires_at),
}));

export const waitlistAuditEventsPg = pgTable('waitlist_audit_events', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  waitlist_entry_id: integerPg('waitlist_entry_id').references(() => waitlistEntriesPg.id, {
    onDelete: 'set null',
  }),
  league_id: integerPg('league_id').references(() => leaguesPg.id, { onDelete: 'set null' }),
  member_id: integerPg('member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  actor_member_id: integerPg('actor_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  source: textPg('source').notNull().$type<WaitlistAuditSourceSqlite>(),
  action: textPg('action').notNull().$type<WaitlistAuditActionSqlite>(),
  reason: textPg('reason'),
  before_json: jsonb('before_json'),
  after_json: jsonb('after_json'),
  metadata_json: jsonb('metadata_json'),
  created_at: timestamp('created_at', { withTimezone: false }).notNull(),
}, (table) => ({
  entryIdx: indexPg('idx_waitlist_audit_events_waitlist_entry_id').on(table.waitlist_entry_id),
  leagueIdx: indexPg('idx_waitlist_audit_events_league_id').on(table.league_id),
  memberIdx: indexPg('idx_waitlist_audit_events_member_id').on(table.member_id),
  actorIdx: indexPg('idx_waitlist_audit_events_actor_member_id').on(table.actor_member_id),
  createdIdx: indexPg('idx_waitlist_audit_events_created_at').on(table.created_at),
  actionIdx: indexPg('idx_waitlist_audit_events_action').on(table.action),
}));

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

export const leagueExtraDrawsPg = pgTable('league_extra_draws', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  league_id: integerPg('league_id').notNull().references(() => leaguesPg.id, { onDelete: 'cascade' }),
  draw_date: date('draw_date').notNull(),
  draw_time: time('draw_time').notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  leagueIdIdx: indexPg('idx_league_extra_draws_league_id').on(table.league_id),
  dateTimeIdx: indexPg('idx_league_extra_draws_date_time').on(table.league_id, table.draw_date, table.draw_time),
  uniqueDraw: uniqueIndexPg('league_extra_draws_league_id_date_time_unique').on(
    table.league_id,
    table.draw_date,
    table.draw_time
  ),
}));

export const drawSheetAvailabilityPg = pgTable('draw_sheet_availability', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  league_id: integerPg('league_id').notNull().references(() => leaguesPg.id, { onDelete: 'cascade' }),
  draw_date: date('draw_date').notNull(),
  draw_time: time('draw_time').notNull(),
  sheet_id: integerPg('sheet_id').notNull().references(() => sheetsPg.id, { onDelete: 'cascade' }),
  is_available: integerPg('is_available').default(1).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  leagueIdIdx: indexPg('idx_draw_sheet_availability_league_id').on(table.league_id),
  drawIdx: indexPg('idx_draw_sheet_availability_draw').on(table.league_id, table.draw_date, table.draw_time),
  sheetIdx: indexPg('idx_draw_sheet_availability_sheet_id').on(table.sheet_id),
  uniqueDrawSheet: uniqueIndexPg('draw_sheet_availability_unique').on(
    table.league_id,
    table.draw_date,
    table.draw_time,
    table.sheet_id
  ),
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
  prefer_late_draw: integerPg('prefer_late_draw').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  leagueIdIdx: indexPg('idx_league_teams_league_id').on(table.league_id),
  divisionIdIdx: indexPg('idx_league_teams_division_id').on(table.division_id),
}));

export const gamesPg = pgTable('games', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  league_id: integerPg('league_id').notNull().references(() => leaguesPg.id, { onDelete: 'cascade' }),
  team1_id: integerPg('team1_id').notNull().references(() => leagueTeamsPg.id, { onDelete: 'restrict' }),
  team2_id: integerPg('team2_id').notNull().references(() => leagueTeamsPg.id, { onDelete: 'restrict' }),
  game_date: date('game_date'),
  game_time: time('game_time'),
  sheet_id: integerPg('sheet_id').references(() => sheetsPg.id, { onDelete: 'set null' }),
  status: textPg('status').default('unscheduled').notNull().$type<'scheduled' | 'unscheduled'>(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  leagueIdIdx: indexPg('idx_games_league_id').on(table.league_id),
  team1Idx: indexPg('idx_games_team1_id').on(table.team1_id),
  team2Idx: indexPg('idx_games_team2_id').on(table.team2_id),
  sheetIdx: indexPg('idx_games_sheet_id').on(table.sheet_id),
  leagueScheduleIdx: indexPg('idx_games_league_date_time').on(table.league_id, table.game_date, table.game_time),
  sheetScheduleIdx: uniqueIndexPg('games_sheet_date_time_unique').on(table.sheet_id, table.game_date, table.game_time),
}));

export const leagueSettingsPg = pgTable('league_settings', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  league_id: integerPg('league_id').notNull().references(() => leaguesPg.id, { onDelete: 'cascade' }),
  head_to_head_first: integerPg('head_to_head_first').default(0).notNull(),
  result_labels: textPg('result_labels'),
  collect_bye_requests: integerPg('collect_bye_requests').default(1).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  leagueIdIdx: indexPg('idx_league_settings_league_id').on(table.league_id),
  uniqueLeague: uniqueIndexPg('league_settings_league_id_unique').on(table.league_id),
}));

export const teamByeRequestsPg = pgTable('team_bye_requests', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  team_id: integerPg('team_id').notNull().references(() => leagueTeamsPg.id, { onDelete: 'cascade' }),
  draw_date: date('draw_date').notNull(),
  priority: integerPg('priority').notNull(),
  note: textPg('note'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  teamIdIdx: indexPg('idx_team_bye_requests_team_id').on(table.team_id),
  drawDateIdx: indexPg('idx_team_bye_requests_draw_date').on(table.draw_date),
}));

export const gameResultsPg = pgTable('game_results', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  game_id: integerPg('game_id').notNull().references(() => gamesPg.id, { onDelete: 'cascade' }),
  team_id: integerPg('team_id').notNull().references(() => leagueTeamsPg.id, { onDelete: 'cascade' }),
  result_order: integerPg('result_order').notNull(),
  value: integerPg('value').notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  gameIdIdx: indexPg('idx_game_results_game_id').on(table.game_id),
  teamIdIdx: indexPg('idx_game_results_team_id').on(table.team_id),
  standingsIdx: indexPg('idx_game_results_game_team').on(table.game_id, table.team_id),
}));

export const gameLineupsPg = pgTable('game_lineups', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  game_id: integerPg('game_id').notNull().references(() => gamesPg.id, { onDelete: 'cascade' }),
  team_id: integerPg('team_id').notNull().references(() => leagueTeamsPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  role: textPg('role').notNull().$type<'lead' | 'second' | 'third' | 'fourth' | 'player1' | 'player2'>(),
  is_spare: integerPg('is_spare').default(0).notNull(),
  sparing_for_member_id: integerPg('sparing_for_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  gameIdIdx: indexPg('idx_game_lineups_game_id').on(table.game_id),
  teamIdIdx: indexPg('idx_game_lineups_team_id').on(table.team_id),
  memberIdIdx: indexPg('idx_game_lineups_member_id').on(table.member_id),
  statsIdx: indexPg('idx_game_lineups_member_stats').on(table.member_id),
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
  source_registration_id: integerPg('source_registration_id').references(() => curlingRegistrationsPg.id, {
    onDelete: 'set null',
  }),
  status: textPg('status').default('active').notNull().$type<LeagueRosterPlacementStatusSqlite>(),
  placement_type: textPg('placement_type').$type<LeagueRosterPlacementTypeSqlite>(),
  is_temporary_sabbatical_fill: integerPg('is_temporary_sabbatical_fill').default(0).notNull(),
  related_sabbatical_id: integerPg('related_sabbatical_id').references(() => curlingLeagueSabbaticalsPg.id, {
    onDelete: 'set null',
  }),
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
  game_id: integerPg('game_id').references(() => gamesPg.id, { onDelete: 'set null' }),
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
  gameIdIdx: indexPg('idx_spare_requests_game_id').on(table.game_id),
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

export const paymentOrdersPg = pgTable('payment_orders', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  order_token: textPg('order_token').notNull().unique(),
  provider: textPg('provider').notNull().$type<'stripe' | 'paypal' | 'square'>(),
  subject_type: textPg('subject_type').notNull().$type<
    'donation' | 'membership' | 'event_registration' | 'curling_registration'
  >(),
  subject_id: integerPg('subject_id'),
  amount_minor: integerPg('amount_minor').notNull(),
  currency: textPg('currency').notNull().default('usd'),
  status: textPg('status')
    .notNull()
    .default('created')
    .$type<'created' | 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded'>(),
  status_reason: textPg('status_reason'),
  provider_order_id: textPg('provider_order_id'),
  metadata: textPg('metadata'),
  created_by_member_id: integerPg('created_by_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  completed_at: timestamp('completed_at', { withTimezone: false }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  statusIdx: indexPg('idx_payment_orders_status').on(table.status),
  subjectIdx: indexPg('idx_payment_orders_subject').on(table.subject_type, table.subject_id),
  providerOrderIdx: uniqueIndexPg('payment_orders_provider_provider_order_id_unique').on(table.provider, table.provider_order_id),
}));

export const paymentTransactionsPg = pgTable('payment_transactions', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  payment_order_id: integerPg('payment_order_id').notNull().references(() => paymentOrdersPg.id, { onDelete: 'cascade' }),
  provider: textPg('provider').notNull().$type<'stripe' | 'paypal' | 'square'>(),
  provider_transaction_id: textPg('provider_transaction_id').notNull(),
  transaction_type: textPg('transaction_type').notNull().$type<'charge' | 'capture' | 'refund' | 'adjustment'>(),
  amount_minor: integerPg('amount_minor').notNull(),
  currency: textPg('currency').notNull().default('usd'),
  fee_minor: integerPg('fee_minor'),
  status: textPg('status')
    .notNull()
    .default('pending')
    .$type<'created' | 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded'>(),
  occurred_at: timestamp('occurred_at', { withTimezone: false }),
  metadata: textPg('metadata'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  orderIdx: indexPg('idx_payment_transactions_order_id').on(table.payment_order_id),
  statusIdx: indexPg('idx_payment_transactions_status').on(table.status),
  providerTxnIdx: uniqueIndexPg('payment_transactions_provider_transaction_id_unique').on(
    table.provider,
    table.provider_transaction_id
  ),
}));

export const paymentEventsPg = pgTable('payment_events', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  provider: textPg('provider').notNull().$type<'stripe' | 'paypal' | 'square'>(),
  provider_event_id: textPg('provider_event_id').notNull(),
  event_type: textPg('event_type').notNull(),
  payment_order_id: integerPg('payment_order_id').references(() => paymentOrdersPg.id, { onDelete: 'set null' }),
  processing_status: textPg('processing_status')
    .notNull()
    .default('received')
    .$type<'received' | 'processed' | 'ignored' | 'failed'>(),
  processing_error: textPg('processing_error'),
  raw_payload: textPg('raw_payload').notNull(),
  received_at: timestamp('received_at', { withTimezone: false }).defaultNow().notNull(),
  processed_at: timestamp('processed_at', { withTimezone: false }),
}, (table) => ({
  providerEventIdx: uniqueIndexPg('payment_events_provider_event_unique').on(table.provider, table.provider_event_id),
  orderIdx: indexPg('idx_payment_events_order_id').on(table.payment_order_id),
  statusIdx: indexPg('idx_payment_events_processing_status').on(table.processing_status),
}));

export const refundsPg = pgTable('refunds', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  payment_order_id: integerPg('payment_order_id').notNull().references(() => paymentOrdersPg.id, { onDelete: 'cascade' }),
  payment_transaction_id: integerPg('payment_transaction_id').references(() => paymentTransactionsPg.id, { onDelete: 'set null' }),
  provider: textPg('provider').notNull().$type<'stripe' | 'paypal' | 'square'>(),
  amount_minor: integerPg('amount_minor').notNull(),
  currency: textPg('currency').notNull().default('usd'),
  reason: textPg('reason'),
  status: textPg('status')
    .notNull()
    .default('requested')
    .$type<'requested' | 'approved' | 'rejected' | 'processing' | 'succeeded' | 'failed'>(),
  requested_by_member_id: integerPg('requested_by_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  approved_by_member_id: integerPg('approved_by_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  provider_refund_id: textPg('provider_refund_id'),
  provider_response: textPg('provider_response'),
  processed_at: timestamp('processed_at', { withTimezone: false }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  orderIdx: indexPg('idx_refunds_order_id').on(table.payment_order_id),
  statusIdx: indexPg('idx_refunds_status').on(table.status),
  providerRefundIdx: uniqueIndexPg('refunds_provider_refund_id_unique').on(table.provider, table.provider_refund_id),
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

export const calendarEventsPg = pgTable('calendar_events', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  source: textPg('source').default('direct').notNull().$type<'direct'>(),
  type_id: textPg('type_id').notNull(),
  title: textPg('title').notNull(),
  start_dt: textPg('start_dt').notNull(),
  end_dt: textPg('end_dt').notNull(),
  all_day: integerPg('all_day').default(0).notNull(),
  recurrence_rule: textPg('recurrence_rule'),
  parent_event_id: integerPg('parent_event_id'),
  recurrence_date: textPg('recurrence_date'),
  description: textPg('description'),
  article_id: integerPg('article_id'),
  created_by_member_id: integerPg('created_by_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  startDtIdx: indexPg('idx_calendar_events_start_dt').on(table.start_dt),
  parentIdIdx: indexPg('idx_calendar_events_parent_id').on(table.parent_event_id),
  recurrenceIdx: indexPg('idx_calendar_events_recurrence_date').on(table.parent_event_id, table.recurrence_date),
}));

export const calendarEventLocationsPg = pgTable('calendar_event_locations', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  event_id: integerPg('event_id').notNull().references(() => calendarEventsPg.id, { onDelete: 'cascade' }),
  location_type: textPg('location_type').notNull().$type<'sheet' | 'warm-room' | 'exterior' | 'offsite' | 'virtual'>(),
  sheet_id: integerPg('sheet_id').references(() => sheetsPg.id, { onDelete: 'cascade' }),
}, (table) => ({
  eventIdIdx: indexPg('idx_calendar_event_locations_event_id').on(table.event_id),
}));

export const calendarEventExceptionsPg = pgTable('calendar_event_exceptions', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  parent_event_id: integerPg('parent_event_id').notNull().references(() => calendarEventsPg.id, { onDelete: 'cascade' }),
  exception_date: textPg('exception_date').notNull(),
}, (table) => ({
  parentIdIdx: indexPg('idx_calendar_event_exceptions_parent_id').on(table.parent_event_id),
  uniqueParentDate: uniqueIndexPg('calendar_event_exceptions_parent_date_unique').on(table.parent_event_id, table.exception_date),
}));

export const iceBookingsPg = pgTable('ice_bookings', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  sheet_id: integerPg('sheet_id').notNull().references(() => sheetsPg.id, { onDelete: 'cascade' }),
  start_dt: textPg('start_dt').notNull(),
  end_dt: textPg('end_dt').notNull(),
  purpose: textPg('purpose')
    .notNull()
    .$type<'practice' | 'makeup_game' | 'guests_new' | 'guests_experienced' | 'other'>(),
  purpose_other: textPg('purpose_other'),
  guest_names: textPg('guest_names'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  memberIdx: indexPg('idx_ice_bookings_member_id').on(table.member_id),
  sheetIdx: indexPg('idx_ice_bookings_sheet_id').on(table.sheet_id),
  rangeIdx: indexPg('idx_ice_bookings_sheet_range').on(table.sheet_id, table.start_dt, table.end_dt),
}));

// Articles (Markdown or HTML content, public pages)
export const articlesPg = pgTable('articles', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  title: textPg('title').notNull(),
  slug: textPg('slug').notNull().unique(),
  content_type: textPg('content_type').default('markdown').notNull(),
  content: textPg('content').notNull(),
  snippet: textPg('snippet'),
  featured: integerPg('featured').default(0).notNull(),
  featured_sort_order: integerPg('featured_sort_order').default(0).notNull(),
  published_at: timestamp('published_at', { withTimezone: false }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
  created_by_member_id: integerPg('created_by_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
}, (table) => ({
  slugIdx: indexPg('idx_articles_slug').on(table.slug),
  featuredIdx: indexPg('idx_articles_featured').on(table.featured),
  publishedIdx: indexPg('idx_articles_published_at').on(table.published_at),
}));

export const articleVersionsPg = pgTable('article_versions', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  article_id: integerPg('article_id').notNull().references(() => articlesPg.id, { onDelete: 'cascade' }),
  version_number: integerPg('version_number').notNull(),
  title: textPg('title').notNull(),
  slug: textPg('slug').notNull(),
  content_type: textPg('content_type').default('markdown').notNull(),
  content: textPg('content').notNull(),
  revision_note: textPg('revision_note'),
  is_small_edit: integerPg('is_small_edit').default(0).notNull(),
  snippet: textPg('snippet'),
  featured: integerPg('featured').default(0).notNull(),
  published_at: timestamp('published_at', { withTimezone: false }),
  saved_by_member_id: integerPg('saved_by_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  articleIdx: indexPg('idx_article_versions_article_id').on(table.article_id),
  articleVersionUnique: uniqueIndexPg('article_versions_article_id_version_number_unique').on(table.article_id, table.version_number),
  createdIdx: indexPg('idx_article_versions_created_at').on(table.created_at),
}));

// Site config (club branding, contact - public-facing)
export const siteConfigPg = pgTable('site_config', {
  id: integerPg('id').primaryKey(),
  club_name: textPg('club_name'),
  logo_url: textPg('logo_url'),
  contact_email: textPg('contact_email'),
  contact_phone: textPg('contact_phone'),
  footer_markdown: textPg('footer_markdown'),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});

// Showcase images for homepage (URLs only)
export const showcaseImagesPg = pgTable('showcase_images', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  url: textPg('url').notNull(),
  caption: textPg('caption'),
  sort_order: integerPg('sort_order').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  sortIdx: indexPg('idx_showcase_images_sort_order').on(table.sort_order),
}));

export const permalinksPg = pgTable('permalinks', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  slug: textPg('slug').notNull().unique(),
  label: textPg('label'),
  notes: textPg('notes'),
  destination_url: textPg('destination_url').notNull(),
  destination_may_change: integerPg('destination_may_change').default(0).notNull(),
  legacy_click_count: integerPg('legacy_click_count').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  slugIdx: indexPg('idx_permalinks_slug').on(table.slug),
}));

export const permalinkHitsPg = pgTable('permalink_hits', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  permalink_id: integerPg('permalink_id').notNull().references(() => permalinksPg.id, { onDelete: 'cascade' }),
  occurred_at: timestamp('occurred_at', { withTimezone: false }).defaultNow().notNull(),
  visitor_id: textPg('visitor_id').notNull(),
  member_id: integerPg('member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  referrer_domain: textPg('referrer_domain'),
}, (table) => ({
  permalinkIdx: indexPg('idx_permalink_hits_permalink_id').on(table.permalink_id),
  occurredIdx: indexPg('idx_permalink_hits_occurred_at').on(table.occurred_at),
}));

// Menu items for dynamic navigation (hierarchical)
export const menuItemsPg = pgTable('menu_items', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  menu_type: textPg('menu_type').default('navbar').notNull(),
  parent_id: integerPg('parent_id'),
  label: textPg('label').notNull(),
  sort_order: integerPg('sort_order').default(0).notNull(),
  link_type: textPg('link_type').$type<'internal' | 'external'>(),
  url: textPg('url'),
  open_in_new_tab: integerPg('open_in_new_tab').default(0).notNull(),
  article_id: integerPg('article_id').references(() => articlesPg.id, { onDelete: 'set null' }),
  use_article_title_for_label: integerPg('use_article_title_for_label').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  menuTypeIdx: indexPg('idx_menu_items_menu_type').on(table.menu_type),
  parentIdIdx: indexPg('idx_menu_items_parent_id').on(table.parent_id),
  sortOrderIdx: indexPg('idx_menu_items_sort_order').on(table.sort_order),
  articleIdIdx: indexPg('idx_menu_items_article_id').on(table.article_id),
}));

export const filesPg = pgTable('files', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  storage_key: textPg('storage_key').notNull().unique(),
  original_filename: textPg('original_filename').notNull(),
  display_name: textPg('display_name'),
  description: textPg('description'),
  mime_type: textPg('mime_type').notNull(),
  byte_size: integerPg('byte_size').notNull(),
  visibility: textPg('visibility').default('public').notNull().$type<'public' | 'authenticated'>(),
  checksum_sha256: textPg('checksum_sha256'),
  thumbnail_storage_key: textPg('thumbnail_storage_key'),
  thumbnail_mime_type: textPg('thumbnail_mime_type'),
  thumbnail_byte_size: integerPg('thumbnail_byte_size'),
  thumbnail_checksum_sha256: textPg('thumbnail_checksum_sha256'),
  uploaded_by_member_id: integerPg('uploaded_by_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  suspected_orphan: integerPg('suspected_orphan').default(0).notNull(),
  last_referenced_at: timestamp('last_referenced_at', { withTimezone: false }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  storageKeyIdx: uniqueIndexPg('files_storage_key_unique').on(table.storage_key),
  visibilityIdx: indexPg('idx_files_visibility').on(table.visibility),
  uploadedByIdx: indexPg('idx_files_uploaded_by_member_id').on(table.uploaded_by_member_id),
  createdAtIdx: indexPg('idx_files_created_at').on(table.created_at),
  suspectedOrphanIdx: indexPg('idx_files_suspected_orphan').on(table.suspected_orphan),
}));

export const sponsorshipLevelsPg = pgTable('sponsorship_levels', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  name: textPg('name').notNull(),
  amount: integerPg('amount').notNull(),
  sort_order: integerPg('sort_order').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  sortIdx: indexPg('idx_sponsorship_levels_sort_order').on(table.sort_order),
  uniqueName: uniqueIndexPg('sponsorship_levels_name_unique').on(table.name),
}));

export const sponsorsPg = pgTable('sponsors', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  name: textPg('name').notNull(),
  website_url: textPg('website_url').notNull(),
  logo_file_id: integerPg('logo_file_id').references(() => filesPg.id, { onDelete: 'set null' }),
  contact_name: textPg('contact_name'),
  contact_email: textPg('contact_email'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  nameIdx: indexPg('idx_sponsors_name').on(table.name),
}));

export const sponsorshipsPg = pgTable('sponsorships', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  sponsor_id: integerPg('sponsor_id').notNull().references(() => sponsorsPg.id, { onDelete: 'cascade' }),
  sponsorship_level_id: integerPg('sponsorship_level_id').notNull().references(() => sponsorshipLevelsPg.id, { onDelete: 'restrict' }),
  start_date: date('start_date'),
  end_date: date('end_date'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  sponsorIdx: indexPg('idx_sponsorships_sponsor_id').on(table.sponsor_id),
  levelIdx: indexPg('idx_sponsorships_sponsorship_level_id').on(table.sponsorship_level_id),
  datesIdx: indexPg('idx_sponsorships_dates').on(table.start_date, table.end_date),
}));

export const governanceSettingsPg = pgTable('governance_settings', {
  id: integerPg('id').primaryKey(),
  fiscal_year_start_mmdd: textPg('fiscal_year_start_mmdd').notNull(), // MM-DD
  board_turnover_mmdd: textPg('board_turnover_mmdd').notNull(), // MM-DD
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});

export const governanceBoardMembersPg = pgTable('governance_board_members', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  public_email: textPg('public_email'),
  first_fiscal_year: integerPg('first_fiscal_year').notNull(),
  last_fiscal_year: integerPg('last_fiscal_year').notNull(),
  manual_inactive: integerPg('manual_inactive').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  memberIdx: indexPg('idx_governance_board_members_member_id').on(table.member_id),
  uniqueMember: uniqueIndexPg('governance_board_members_member_id_unique').on(table.member_id),
}));

export const governanceCommitteesPg = pgTable('governance_committees', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  name: textPg('name').notNull(),
  contact_info: textPg('contact_info'),
  responsibilities: textPg('responsibilities'),
  board_liaison_board_member_id: integerPg('board_liaison_board_member_id').references(
    () => governanceBoardMembersPg.id,
    { onDelete: 'set null' }
  ),
  sort_order: integerPg('sort_order').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  uniqueName: uniqueIndexPg('governance_committees_name_unique').on(table.name),
  liaisonIdx: indexPg('idx_governance_committees_liaison_id').on(table.board_liaison_board_member_id),
  sortIdx: indexPg('idx_governance_committees_sort_order').on(table.sort_order),
}));

export const governanceCommitteeChairsPg = pgTable('governance_committee_chairs', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  committee_id: integerPg('committee_id').notNull().references(() => governanceCommitteesPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  public_email: textPg('public_email'),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  committeeIdx: indexPg('idx_governance_committee_chairs_committee_id').on(table.committee_id),
  memberIdx: indexPg('idx_governance_committee_chairs_member_id').on(table.member_id),
  uniqueCommitteeMember: uniqueIndexPg('governance_committee_chairs_committee_id_member_id_unique').on(
    table.committee_id,
    table.member_id
  ),
}));

export const governanceBoardMemberCommitteesPg = pgTable('governance_board_member_committees', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  board_member_id: integerPg('board_member_id').notNull().references(() => governanceBoardMembersPg.id, { onDelete: 'cascade' }),
  committee_id: integerPg('committee_id').notNull().references(() => governanceCommitteesPg.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  boardMemberIdx: indexPg('idx_governance_board_member_committees_board_member_id').on(table.board_member_id),
  committeeIdx: indexPg('idx_governance_board_member_committees_committee_id').on(table.committee_id),
  uniqueBoardMemberCommittee: uniqueIndexPg('governance_board_member_committees_board_member_id_committee_id_unique').on(
    table.board_member_id,
    table.committee_id
  ),
}));

export const governanceOfficersPg = pgTable('governance_officers', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  position: textPg('position').notNull().$type<'president' | 'vice_president' | 'treasurer' | 'secretary'>(),
  board_member_id: integerPg('board_member_id').notNull().references(() => governanceBoardMembersPg.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  uniquePosition: uniqueIndexPg('governance_officers_position_unique').on(table.position),
  uniqueBoardMember: uniqueIndexPg('governance_officers_board_member_id_unique').on(table.board_member_id),
  boardMemberIdx: indexPg('idx_governance_officers_board_member_id').on(table.board_member_id),
}));

// ========== Events System (PostgreSQL) ==========

export const eventCategoriesPg = pgTable('event_categories', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  name: textPg('name').notNull(),
  slug: textPg('slug').notNull().unique(),
  description: textPg('description'),
  sort_order: integerPg('sort_order').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  slugIdx: uniqueIndexPg('event_categories_slug_unique_pg').on(table.slug),
}));

export const eventsPg = pgTable('events', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  title: textPg('title').notNull(),
  slug: textPg('slug').notNull().unique(),
  article_id: integerPg('article_id').references(() => articlesPg.id, { onDelete: 'set null' }),
  image_file_id: integerPg('image_file_id').references(() => filesPg.id, { onDelete: 'set null' }),
  visibility: textPg('visibility').default('public').notNull().$type<EventVisibility>(),
  published: integerPg('published').default(0).notNull(),
  capacity: integerPg('capacity'),
  fee_minor: integerPg('fee_minor').default(0).notNull(),
  member_fee_minor: integerPg('member_fee_minor'),
  currency: textPg('currency').default('usd').notNull(),
  registration_start: timestamp('registration_start', { withTimezone: false }),
  registration_cutoff: timestamp('registration_cutoff', { withTimezone: false }),
  cancellation_cutoff: timestamp('cancellation_cutoff', { withTimezone: false }),
  allow_group_registration: integerPg('allow_group_registration').default(0).notNull(),
  max_group_size: integerPg('max_group_size'),
  enable_waitlist: integerPg('enable_waitlist').default(1).notNull(),
  calendar_type_id: textPg('calendar_type_id').default('other').notNull(),
  tournament_teams_published: integerPg('tournament_teams_published').default(0).notNull(),
  tournament_draw_published: integerPg('tournament_draw_published').default(0).notNull(),
  tournament_format: textPg('tournament_format').$type<'fours' | 'doubles' | null>(),
  tournament_draw_json: textPg('tournament_draw_json'),
  terms_article_id: integerPg('terms_article_id').references(() => articlesPg.id, { onDelete: 'set null' }),
  created_by_member_id: integerPg('created_by_member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  slugIdx: uniqueIndexPg('events_slug_unique_pg').on(table.slug),
  publishedIdx: indexPg('idx_events_published').on(table.published),
  visibilityIdx: indexPg('idx_events_visibility').on(table.visibility),
}));

export const eventTimespansPg = pgTable('event_timespans', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  event_id: integerPg('event_id').notNull().references(() => eventsPg.id, { onDelete: 'cascade' }),
  start_dt: textPg('start_dt').notNull(),
  end_dt: textPg('end_dt').notNull(),
  sort_order: integerPg('sort_order').default(0).notNull(),
}, (table) => ({
  eventIdx: indexPg('idx_event_timespans_event_id').on(table.event_id),
  startIdx: indexPg('idx_event_timespans_start_dt').on(table.start_dt),
}));

export const eventLocationsPg = pgTable('event_locations', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  event_id: integerPg('event_id').notNull().references(() => eventsPg.id, { onDelete: 'cascade' }),
  location_type: textPg('location_type').notNull().$type<'sheet' | 'warm-room' | 'exterior' | 'offsite' | 'virtual'>(),
  sheet_id: integerPg('sheet_id').references(() => sheetsPg.id, { onDelete: 'cascade' }),
}, (table) => ({
  eventIdx: indexPg('idx_event_locations_event_id').on(table.event_id),
}));

export const eventCategoryAssignmentsPg = pgTable('event_category_assignments', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  event_id: integerPg('event_id').notNull().references(() => eventsPg.id, { onDelete: 'cascade' }),
  category_id: integerPg('category_id').notNull().references(() => eventCategoriesPg.id, { onDelete: 'cascade' }),
}, (table) => ({
  eventIdx: indexPg('idx_event_category_assignments_event_id').on(table.event_id),
  categoryIdx: indexPg('idx_event_category_assignments_category_id').on(table.category_id),
  uniqueAssignment: uniqueIndexPg('event_category_assignments_event_category_unique_pg').on(table.event_id, table.category_id),
}));

export const eventOwnersPg = pgTable('event_owners', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  event_id: integerPg('event_id').notNull().references(() => eventsPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id').notNull().references(() => membersPg.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  eventIdx: indexPg('idx_event_owners_event_id').on(table.event_id),
  memberIdx: indexPg('idx_event_owners_member_id').on(table.member_id),
  uniqueOwner: uniqueIndexPg('event_owners_event_member_unique_pg').on(table.event_id, table.member_id),
}));

export const eventRegistrationFieldsPg = pgTable('event_registration_fields', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  event_id: integerPg('event_id').notNull().references(() => eventsPg.id, { onDelete: 'cascade' }),
  label: textPg('label').notNull(),
  field_type: textPg('field_type').notNull().$type<EventFieldType>(),
  scope: textPg('scope').default('group').notNull().$type<EventFieldScope>(),
  required: integerPg('required').default(0).notNull(),
  options: textPg('options'),
  sort_order: integerPg('sort_order').default(0).notNull(),
}, (table) => ({
  eventIdx: indexPg('idx_event_registration_fields_event_id').on(table.event_id),
}));

export const eventRegistrationsPg = pgTable('event_registrations', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  event_id: integerPg('event_id').notNull().references(() => eventsPg.id, { onDelete: 'cascade' }),
  member_id: integerPg('member_id').references(() => membersPg.id, { onDelete: 'set null' }),
  contact_name: textPg('contact_name').notNull(),
  contact_email: textPg('contact_email').notNull(),
  status: textPg('status').default('pending_payment').notNull().$type<EventRegistrationStatus>(),
  group_size: integerPg('group_size').default(1).notNull(),
  payment_order_id: integerPg('payment_order_id'),
  special_link_id: integerPg('special_link_id'),
  waitlist_position: integerPg('waitlist_position'),
  registered_at: timestamp('registered_at', { withTimezone: false }).defaultNow().notNull(),
  cancelled_at: timestamp('cancelled_at', { withTimezone: false }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  eventIdx: indexPg('idx_event_registrations_event_id').on(table.event_id),
  memberIdx: indexPg('idx_event_registrations_member_id').on(table.member_id),
  statusIdx: indexPg('idx_event_registrations_status').on(table.status),
}));

export const eventRegistrationMembersPg = pgTable('event_registration_members', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  registration_id: integerPg('registration_id').notNull().references(() => eventRegistrationsPg.id, { onDelete: 'cascade' }),
  name: textPg('name').notNull(),
  email: textPg('email'),
  sort_order: integerPg('sort_order').default(0).notNull(),
}, (table) => ({
  registrationIdx: indexPg('idx_event_registration_members_registration_id').on(table.registration_id),
}));

export const eventRegistrationFieldValuesPg = pgTable('event_registration_field_values', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  registration_id: integerPg('registration_id').notNull().references(() => eventRegistrationsPg.id, { onDelete: 'cascade' }),
  field_id: integerPg('field_id').notNull().references(() => eventRegistrationFieldsPg.id, { onDelete: 'cascade' }),
  registration_member_id: integerPg('registration_member_id').references(() => eventRegistrationMembersPg.id, { onDelete: 'cascade' }),
  value: textPg('value'),
}, (table) => ({
  registrationIdx: indexPg('idx_event_reg_field_values_registration_id').on(table.registration_id),
  fieldIdx: indexPg('idx_event_reg_field_values_field_id').on(table.field_id),
}));

export const eventSpecialLinksPg = pgTable('event_special_links', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  event_id: integerPg('event_id').notNull().references(() => eventsPg.id, { onDelete: 'cascade' }),
  token: textPg('token').notNull().unique(),
  label: textPg('label'),
  override_fee_minor: integerPg('override_fee_minor'),
  max_group_size: integerPg('max_group_size'),
  bypass_capacity: integerPg('bypass_capacity').default(0).notNull(),
  ignore_registration_dates: integerPg('ignore_registration_dates').default(0).notNull(),
  used: integerPg('used').default(0).notNull(),
  invalidated: integerPg('invalidated').default(0).notNull(),
  used_by_registration_id: integerPg('used_by_registration_id').references(() => eventRegistrationsPg.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  eventIdx: indexPg('idx_event_special_links_event_id').on(table.event_id),
  tokenIdx: uniqueIndexPg('event_special_links_token_unique_pg').on(table.token),
}));

export const eventTournamentTeamsPg = pgTable('event_tournament_teams', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  event_id: integerPg('event_id').notNull().references(() => eventsPg.id, { onDelete: 'cascade' }),
  sort_order: integerPg('sort_order').default(0).notNull(),
  team_name: textPg('team_name'),
  home_club: textPg('home_club'),
  vice_slot_code: textPg('vice_slot_code').notNull(),
  skip_slot_code: textPg('skip_slot_code').notNull(),
  created_at: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  eventIdx: indexPg('idx_event_tournament_teams_event_id').on(table.event_id),
}));

export const eventTournamentRosterSlotsPg = pgTable('event_tournament_roster_slots', {
  id: integerPg('id').primaryKey().generatedAlwaysAsIdentity(),
  team_id: integerPg('team_id').notNull().references(() => eventTournamentTeamsPg.id, { onDelete: 'cascade' }),
  slot_code: textPg('slot_code').notNull(),
  player_name: textPg('player_name'),
  email: textPg('email'),
  notes: textPg('notes'),
}, (table) => ({
  teamIdx: indexPg('idx_event_tournament_roster_team_id').on(table.team_id),
  uniqueSlot: uniqueIndexPg('event_tournament_roster_team_slot_unique_pg').on(table.team_id, table.slot_code),
}));

// Export schema objects for use in database initialization
export const sqliteSchema = {
  members: membersSqlite,
  authCodes: authCodesSqlite,
  authTokens: authTokensSqlite,
  roles: rolesSqlite,
  roleScopeRules: roleScopeRulesSqlite,
  memberRoleAssignments: memberRoleAssignmentsSqlite,
  memberAccountAccessDelegations: memberAccountAccessDelegationsSqlite,
  curlingSeasons: curlingSeasonsSqlite,
  curlingSessions: curlingSessionsSqlite,
  leagues: leaguesSqlite,
  registrationPeriods: registrationPeriodsSqlite,
  curlingRegistrations: curlingRegistrationsSqlite,
  curlingLeagueSabbaticals: curlingLeagueSabbaticalsSqlite,
  registrationPolicyAcceptances: registrationPolicyAcceptancesSqlite,
  registrationSelections: registrationSelectionsSqlite,
  financialAssistanceRequests: financialAssistanceRequestsSqlite,
  registrationInvoices: registrationInvoicesSqlite,
  registrationInvoiceLineItems: registrationInvoiceLineItemsSqlite,
  registrationPriceConfigs: registrationPriceConfigsSqlite,
  registrationDiscountConfigs: registrationDiscountConfigsSqlite,
  seasonMemberships: seasonMembershipsSqlite,
  curlingIcePrivileges: curlingIcePrivilegesSqlite,
  curlingSabbaticalSessions: curlingSabbaticalSessionsSqlite,
  waitlistEntries: waitlistEntriesSqlite,
  waitlistOffers: waitlistOffersSqlite,
  waitlistAuditEvents: waitlistAuditEventsSqlite,
  leagueDrawTimes: leagueDrawTimesSqlite,
  leagueExceptions: leagueExceptionsSqlite,
  sheets: sheetsSqlite,
  leagueExtraDraws: leagueExtraDrawsSqlite,
  drawSheetAvailability: drawSheetAvailabilitySqlite,
  leagueDivisions: leagueDivisionsSqlite,
  leagueTeams: leagueTeamsSqlite,
  games: gamesSqlite,
  leagueSettings: leagueSettingsSqlite,
  teamByeRequests: teamByeRequestsSqlite,
  gameResults: gameResultsSqlite,
  gameLineups: gameLineupsSqlite,
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
  paymentOrders: paymentOrdersSqlite,
  paymentTransactions: paymentTransactionsSqlite,
  paymentEvents: paymentEventsSqlite,
  refunds: refundsSqlite,
  dailyActivity: dailyActivitySqlite,
  calendarEvents: calendarEventsSqlite,
  calendarEventLocations: calendarEventLocationsSqlite,
  calendarEventExceptions: calendarEventExceptionsSqlite,
  iceBookings: iceBookingsSqlite,
  articles: articlesSqlite,
  articleVersions: articleVersionsSqlite,
  permalinks: permalinksSqlite,
  permalinkHits: permalinkHitsSqlite,
  siteConfig: siteConfigSqlite,
  showcaseImages: showcaseImagesSqlite,
  menuItems: menuItemsSqlite,
  files: filesSqlite,
  sponsorshipLevels: sponsorshipLevelsSqlite,
  sponsors: sponsorsSqlite,
  sponsorships: sponsorshipsSqlite,
  governanceSettings: governanceSettingsSqlite,
  governanceBoardMembers: governanceBoardMembersSqlite,
  governanceCommittees: governanceCommitteesSqlite,
  governanceCommitteeChairs: governanceCommitteeChairsSqlite,
  governanceBoardMemberCommittees: governanceBoardMemberCommitteesSqlite,
  governanceOfficers: governanceOfficersSqlite,
  eventCategories: eventCategoriesSqlite,
  events: eventsSqlite,
  eventTimespans: eventTimespansSqlite,
  eventLocations: eventLocationsSqlite,
  eventCategoryAssignments: eventCategoryAssignmentsSqlite,
  eventOwners: eventOwnersSqlite,
  eventRegistrationFields: eventRegistrationFieldsSqlite,
  eventRegistrations: eventRegistrationsSqlite,
  eventRegistrationMembers: eventRegistrationMembersSqlite,
  eventRegistrationFieldValues: eventRegistrationFieldValuesSqlite,
  eventSpecialLinks: eventSpecialLinksSqlite,
  eventTournamentTeams: eventTournamentTeamsSqlite,
  eventTournamentRosterSlots: eventTournamentRosterSlotsSqlite,
};

export const pgSchema = {
  members: membersPg,
  authCodes: authCodesPg,
  authTokens: authTokensPg,
  roles: rolesPg,
  roleScopeRules: roleScopeRulesPg,
  memberRoleAssignments: memberRoleAssignmentsPg,
  memberAccountAccessDelegations: memberAccountAccessDelegationsPg,
  curlingSeasons: curlingSeasonsPg,
  curlingSessions: curlingSessionsPg,
  leagues: leaguesPg,
  registrationPeriods: registrationPeriodsPg,
  curlingRegistrations: curlingRegistrationsPg,
  curlingLeagueSabbaticals: curlingLeagueSabbaticalsPg,
  registrationPolicyAcceptances: registrationPolicyAcceptancesPg,
  registrationSelections: registrationSelectionsPg,
  financialAssistanceRequests: financialAssistanceRequestsPg,
  registrationInvoices: registrationInvoicesPg,
  registrationInvoiceLineItems: registrationInvoiceLineItemsPg,
  registrationPriceConfigs: registrationPriceConfigsPg,
  registrationDiscountConfigs: registrationDiscountConfigsPg,
  seasonMemberships: seasonMembershipsPg,
  curlingIcePrivileges: curlingIcePrivilegesPg,
  curlingSabbaticalSessions: curlingSabbaticalSessionsPg,
  waitlistEntries: waitlistEntriesPg,
  waitlistOffers: waitlistOffersPg,
  waitlistAuditEvents: waitlistAuditEventsPg,
  leagueDrawTimes: leagueDrawTimesPg,
  leagueExceptions: leagueExceptionsPg,
  sheets: sheetsPg,
  leagueExtraDraws: leagueExtraDrawsPg,
  drawSheetAvailability: drawSheetAvailabilityPg,
  leagueDivisions: leagueDivisionsPg,
  leagueTeams: leagueTeamsPg,
  games: gamesPg,
  leagueSettings: leagueSettingsPg,
  teamByeRequests: teamByeRequestsPg,
  gameResults: gameResultsPg,
  gameLineups: gameLineupsPg,
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
  paymentOrders: paymentOrdersPg,
  paymentTransactions: paymentTransactionsPg,
  paymentEvents: paymentEventsPg,
  refunds: refundsPg,
  dailyActivity: dailyActivityPg,
  calendarEvents: calendarEventsPg,
  calendarEventLocations: calendarEventLocationsPg,
  calendarEventExceptions: calendarEventExceptionsPg,
  iceBookings: iceBookingsPg,
  articles: articlesPg,
  articleVersions: articleVersionsPg,
  permalinks: permalinksPg,
  permalinkHits: permalinkHitsPg,
  siteConfig: siteConfigPg,
  showcaseImages: showcaseImagesPg,
  menuItems: menuItemsPg,
  files: filesPg,
  sponsorshipLevels: sponsorshipLevelsPg,
  sponsors: sponsorsPg,
  sponsorships: sponsorshipsPg,
  governanceSettings: governanceSettingsPg,
  governanceBoardMembers: governanceBoardMembersPg,
  governanceCommittees: governanceCommitteesPg,
  governanceCommitteeChairs: governanceCommitteeChairsPg,
  governanceBoardMemberCommittees: governanceBoardMemberCommitteesPg,
  governanceOfficers: governanceOfficersPg,
  eventCategories: eventCategoriesPg,
  events: eventsPg,
  eventTimespans: eventTimespansPg,
  eventLocations: eventLocationsPg,
  eventCategoryAssignments: eventCategoryAssignmentsPg,
  eventOwners: eventOwnersPg,
  eventRegistrationFields: eventRegistrationFieldsPg,
  eventRegistrations: eventRegistrationsPg,
  eventRegistrationMembers: eventRegistrationMembersPg,
  eventRegistrationFieldValues: eventRegistrationFieldValuesPg,
  eventSpecialLinks: eventSpecialLinksPg,
  eventTournamentTeams: eventTournamentTeamsPg,
  eventTournamentRosterSlots: eventTournamentRosterSlotsPg,
};
