import type { DatabaseAdapter } from './adapter.js';

/** SQLite DDL fragments for curling registration (Phase 1). */
export const curlingRegistrationDDLBase = `
  CREATE TABLE IF NOT EXISTS curling_seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    membership_starts_date DATE NOT NULL,
    membership_ends_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS curling_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL REFERENCES curling_seasons(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    sort_order_within_season INTEGER NOT NULL DEFAULT 0,
    is_first_session_of_season INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_curling_sessions_season_id ON curling_sessions(season_id);
  CREATE INDEX IF NOT EXISTS idx_curling_sessions_season_sort ON curling_sessions(season_id, sort_order_within_season);

  CREATE TABLE IF NOT EXISTS registration_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL REFERENCES curling_seasons(id) ON DELETE CASCADE,
    session_id INTEGER NOT NULL REFERENCES curling_sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    current_state TEXT NOT NULL DEFAULT 'closed' CHECK(current_state IN ('closed', 'priority', 'open')),
    priority_opens_at DATETIME,
    priority_closes_at DATETIME,
    open_registration_opens_at DATETIME,
    registration_closes_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_registration_periods_season_id ON registration_periods(season_id);
  CREATE INDEX IF NOT EXISTS idx_registration_periods_session_id ON registration_periods(session_id);
  CREATE INDEX IF NOT EXISTS idx_registration_periods_current_state ON registration_periods(current_state);

  CREATE TABLE IF NOT EXISTS curling_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_period_id INTEGER NOT NULL REFERENCES registration_periods(id) ON DELETE RESTRICT,
    season_id INTEGER NOT NULL REFERENCES curling_seasons(id) ON DELETE RESTRICT,
    session_id INTEGER NOT NULL REFERENCES curling_sessions(id) ON DELETE RESTRICT,
    curler_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    submitted_by_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    registering_for_self INTEGER NOT NULL DEFAULT 1,
    returning_member_answer INTEGER,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN (
      'draft', 'submitted', 'awaiting_staff_review', 'awaiting_placement', 'awaiting_payment',
      'payment_started', 'paid', 'confirmed', 'cancelled'
    )),
    membership_option TEXT NOT NULL DEFAULT 'none' CHECK(membership_option IN (
      'none', 'regular', 'social', 'regular_spare_only', 'junior_recreational'
    )),
    experience_type TEXT NOT NULL DEFAULT 'none_or_minimal' CHECK(experience_type IN (
      'none_or_minimal', 'specified_years', 'known_existing'
    )),
    self_reported_experience_years REAL,
    student_discount_claimed INTEGER NOT NULL DEFAULT 0,
    student_institution TEXT,
    reciprocal_discount_claimed INTEGER NOT NULL DEFAULT 0,
    reciprocal_club_name TEXT,
    winter_only_discount_applied INTEGER NOT NULL DEFAULT 0,
    junior_assistance_requested_percent REAL,
    junior_assistance_decision TEXT,
    deferred_payment INTEGER NOT NULL DEFAULT 0,
    deferred_payment_reason TEXT,
    stripe_checkout_session_id TEXT,
    payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN (
      'unpaid', 'checkout_started', 'paid', 'deferred', 'failed', 'refunded'
    )),
    submitted_at DATETIME,
    paid_at DATETIME,
    cancelled_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_curling_registrations_registration_period_id ON curling_registrations(registration_period_id);
  CREATE INDEX IF NOT EXISTS idx_curling_registrations_season_id ON curling_registrations(season_id);
  CREATE INDEX IF NOT EXISTS idx_curling_registrations_session_id ON curling_registrations(session_id);
  CREATE INDEX IF NOT EXISTS idx_curling_registrations_curler_member_id ON curling_registrations(curler_member_id);
  CREATE INDEX IF NOT EXISTS idx_curling_registrations_submitted_by_member_id ON curling_registrations(submitted_by_member_id);
  CREATE INDEX IF NOT EXISTS idx_curling_registrations_status ON curling_registrations(status);
  CREATE INDEX IF NOT EXISTS idx_curling_registrations_payment_status ON curling_registrations(payment_status);

  CREATE TABLE IF NOT EXISTS curling_league_sabbaticals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    lineage_key TEXT,
    original_league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE RESTRICT,
    current_league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE RESTRICT,
    source_registration_id INTEGER REFERENCES curling_registrations(id) ON DELETE SET NULL,
    first_sabbatical_league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE RESTRICT,
    first_sabbatical_start_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN (
      'active', 'returning', 'released', 'expired', 'staff_overridden', 'cancelled'
    )),
    staff_override INTEGER NOT NULL DEFAULT 0,
    staff_override_reason TEXT,
    released_at DATETIME,
    released_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_curling_league_sabbaticals_member_id ON curling_league_sabbaticals(member_id);
  CREATE INDEX IF NOT EXISTS idx_curling_league_sabbaticals_current_league_id ON curling_league_sabbaticals(current_league_id);
  CREATE INDEX IF NOT EXISTS idx_curling_league_sabbaticals_status ON curling_league_sabbaticals(status);
  CREATE INDEX IF NOT EXISTS idx_curling_league_sabbaticals_first_start ON curling_league_sabbaticals(first_sabbatical_start_date);

  CREATE TABLE IF NOT EXISTS registration_policy_acceptances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_id INTEGER NOT NULL REFERENCES curling_registrations(id) ON DELETE CASCADE,
    policy_type TEXT NOT NULL CHECK(policy_type IN ('code_of_conduct', 'maapp', 'privacy')),
    policy_url TEXT NOT NULL,
    accepted_by_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    accepted_for_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    accepted_at DATETIME NOT NULL,
    policy_version TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_registration_policy_acceptances_registration_id ON registration_policy_acceptances(registration_id);

  CREATE TABLE IF NOT EXISTS registration_selections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_id INTEGER NOT NULL REFERENCES curling_registrations(id) ON DELETE CASCADE,
    league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
    selection_type TEXT NOT NULL CHECK(selection_type IN (
      'guaranteed_return', 'sabbatical', 'drop', 'return_subject_to_availability',
      'waitlist_add', 'waitlist_replace', 'third_league_interest', 'byot_request',
      'junior_recreational', 'spare_only'
    )),
    rank INTEGER,
    replaces_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
    related_sabbatical_id INTEGER REFERENCES curling_league_sabbaticals(id) ON DELETE SET NULL,
    is_temporary_sabbatical_fill INTEGER NOT NULL DEFAULT 0,
    byot_teammate_text TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN (
      'draft', 'pending', 'confirmed', 'waitlisted', 'offered', 'accepted', 'declined',
      'placed', 'not_placed', 'dropped', 'cancelled'
    )),
    fee_amount_minor_snapshot INTEGER NOT NULL DEFAULT 0,
    discount_amount_minor_snapshot INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_registration_selections_registration_id ON registration_selections(registration_id);
  CREATE INDEX IF NOT EXISTS idx_registration_selections_league_id ON registration_selections(league_id);
  CREATE INDEX IF NOT EXISTS idx_registration_selections_selection_type ON registration_selections(selection_type);
  CREATE INDEX IF NOT EXISTS idx_registration_selections_status ON registration_selections(status);

  CREATE TABLE IF NOT EXISTS financial_assistance_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_id INTEGER NOT NULL REFERENCES curling_registrations(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    requested_percentage REAL NOT NULL,
    approved_percentage REAL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
      'pending', 'approved', 'partially_approved', 'denied', 'withdrawn'
    )),
    reviewed_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    reviewed_at DATETIME,
    staff_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_financial_assistance_requests_registration_id ON financial_assistance_requests(registration_id);

  CREATE TABLE IF NOT EXISTS registration_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_id INTEGER NOT NULL REFERENCES curling_registrations(id) ON DELETE CASCADE,
    payer_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN (
      'draft', 'deferred', 'awaiting_payment', 'checkout_started', 'paid',
      'failed', 'cancelled', 'refunded'
    )),
    subtotal_minor INTEGER NOT NULL DEFAULT 0,
    discount_minor INTEGER NOT NULL DEFAULT 0,
    total_minor INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'usd',
    deferred INTEGER NOT NULL DEFAULT 0,
    deferred_reason TEXT,
    stripe_checkout_session_id TEXT,
    stripe_payment_intent_id TEXT,
    payment_order_id INTEGER REFERENCES payment_orders(id) ON DELETE SET NULL,
    paid_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_registration_invoices_registration_id ON registration_invoices(registration_id);
  CREATE INDEX IF NOT EXISTS idx_registration_invoices_payer_member_id ON registration_invoices(payer_member_id);
  CREATE INDEX IF NOT EXISTS idx_registration_invoices_status ON registration_invoices(status);

  CREATE TABLE IF NOT EXISTS registration_invoice_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES registration_invoices(id) ON DELETE CASCADE,
    line_type TEXT NOT NULL CHECK(line_type IN (
      'regular_membership_fee', 'social_membership_fee', 'league_fee', 'spare_only_fee',
      'sabbatical_fee', 'junior_recreational_fee',
      'student_discount', 'reciprocal_discount', 'winter_only_discount', 'sabbatical_fill_discount',
      'financial_assistance_discount', 'manual_adjustment'
    )),
    description TEXT NOT NULL,
    related_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
    related_selection_id INTEGER REFERENCES registration_selections(id) ON DELETE SET NULL,
    amount_minor INTEGER NOT NULL,
    discount_eligible INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_registration_invoice_line_items_invoice_id ON registration_invoice_line_items(invoice_id);

  CREATE TABLE IF NOT EXISTS registration_price_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL REFERENCES curling_seasons(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES curling_sessions(id) ON DELETE CASCADE,
    regular_membership_fee_minor INTEGER NOT NULL DEFAULT 0,
    social_membership_fee_minor INTEGER NOT NULL DEFAULT 0,
    spare_only_ice_privilege_fee_minor INTEGER NOT NULL DEFAULT 0,
    sabbatical_fee_minor INTEGER NOT NULL DEFAULT 0,
    junior_recreational_fee_minor INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_registration_price_configs_season_id ON registration_price_configs(season_id);
  CREATE INDEX IF NOT EXISTS idx_registration_price_configs_session_id ON registration_price_configs(session_id);

  CREATE TABLE IF NOT EXISTS registration_discount_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL REFERENCES curling_seasons(id) ON DELETE CASCADE,
    discount_type TEXT NOT NULL CHECK(discount_type IN ('student', 'reciprocal', 'winter_only')),
    amount_type TEXT NOT NULL CHECK(amount_type IN ('dollar', 'percent')),
    amount_value REAL NOT NULL,
    applies_to_scope TEXT NOT NULL CHECK(applies_to_scope IN ('regular_membership', 'eligible_invoice_items')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_registration_discount_configs_season_id ON registration_discount_configs(season_id);

  CREATE TABLE IF NOT EXISTS season_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    season_id INTEGER NOT NULL REFERENCES curling_seasons(id) ON DELETE CASCADE,
    membership_type TEXT NOT NULL CHECK(membership_type IN ('regular', 'social', 'junior_recreational')),
    starts_at DATETIME NOT NULL,
    ends_at DATETIME NOT NULL,
    source_registration_id INTEGER REFERENCES curling_registrations(id) ON DELETE SET NULL,
    payment_order_id INTEGER REFERENCES payment_orders(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'cancelled', 'refunded', 'expired')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_season_memberships_member_id ON season_memberships(member_id);
  CREATE INDEX IF NOT EXISTS idx_season_memberships_season_id ON season_memberships(season_id);

  CREATE TABLE IF NOT EXISTS curling_ice_privileges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    season_id INTEGER NOT NULL REFERENCES curling_seasons(id) ON DELETE CASCADE,
    session_id INTEGER NOT NULL REFERENCES curling_sessions(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK(source_type IN ('league', 'spare_only', 'program', 'staff_adjustment')),
    source_registration_id INTEGER REFERENCES curling_registrations(id) ON DELETE SET NULL,
    source_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'inactive', 'cancelled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_curling_ice_privileges_member_id ON curling_ice_privileges(member_id);

  CREATE TABLE IF NOT EXISTS curling_sabbatical_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sabbatical_id INTEGER NOT NULL REFERENCES curling_league_sabbaticals(id) ON DELETE CASCADE,
    league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE RESTRICT,
    registration_id INTEGER REFERENCES curling_registrations(id) ON DELETE SET NULL,
    fee_amount_minor INTEGER NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    starts_at DATETIME,
    ends_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_curling_sabbatical_sessions_sabbatical_id ON curling_sabbatical_sessions(sabbatical_id);

  CREATE TABLE IF NOT EXISTS waitlist_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    source_registration_id INTEGER REFERENCES curling_registrations(id) ON DELETE SET NULL,
    entry_type TEXT NOT NULL CHECK(entry_type IN ('add', 'replace')),
    replaces_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
    position_sort_key TEXT NOT NULL,
    joined_at DATETIME NOT NULL,
    decline_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN (
      'active', 'offered', 'accepted', 'declined', 'placed', 'removed',
      'moved_to_bottom', 'rolled_over', 'cancelled'
    )),
    rolled_over_from_waitlist_entry_id INTEGER REFERENCES waitlist_entries(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK(
      (entry_type = 'replace' AND replaces_league_id IS NOT NULL)
      OR (entry_type = 'add' AND replaces_league_id IS NULL)
    )
  );
  CREATE INDEX IF NOT EXISTS idx_waitlist_entries_league_id ON waitlist_entries(league_id);
  CREATE INDEX IF NOT EXISTS idx_waitlist_entries_member_id ON waitlist_entries(member_id);
  CREATE INDEX IF NOT EXISTS idx_waitlist_entries_status ON waitlist_entries(status);
  CREATE INDEX IF NOT EXISTS idx_waitlist_entries_entry_type ON waitlist_entries(entry_type);
  CREATE INDEX IF NOT EXISTS idx_waitlist_entries_position_sort_key ON waitlist_entries(position_sort_key);
  CREATE INDEX IF NOT EXISTS idx_waitlist_entries_joined_at ON waitlist_entries(joined_at);
  CREATE INDEX IF NOT EXISTS idx_waitlist_entries_source_registration_id ON waitlist_entries(source_registration_id);
  CREATE INDEX IF NOT EXISTS idx_waitlist_entries_replaces_league_id ON waitlist_entries(replaces_league_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_entries_active_member_league
    ON waitlist_entries(member_id, league_id)
    WHERE status = 'active';

  CREATE TABLE IF NOT EXISTS waitlist_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    waitlist_entry_id INTEGER NOT NULL REFERENCES waitlist_entries(id) ON DELETE CASCADE,
    league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE RESTRICT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    offer_type TEXT NOT NULL CHECK(offer_type IN ('permanent', 'temporary_sabbatical_fill')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
      'pending', 'accepted', 'declined', 'expired_accepted', 'cancelled'
    )),
    offered_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    responded_at DATETIME,
    response_source TEXT,
    offered_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    source_registration_id INTEGER REFERENCES curling_registrations(id) ON DELETE SET NULL,
    payment_link_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_waitlist_offers_waitlist_entry_id ON waitlist_offers(waitlist_entry_id);
  CREATE INDEX IF NOT EXISTS idx_waitlist_offers_league_id ON waitlist_offers(league_id);
  CREATE INDEX IF NOT EXISTS idx_waitlist_offers_member_id ON waitlist_offers(member_id);
  CREATE INDEX IF NOT EXISTS idx_waitlist_offers_status ON waitlist_offers(status);
  CREATE INDEX IF NOT EXISTS idx_waitlist_offers_expires_at ON waitlist_offers(expires_at);

  CREATE TABLE IF NOT EXISTS waitlist_audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    waitlist_entry_id INTEGER REFERENCES waitlist_entries(id) ON DELETE SET NULL,
    league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
    member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    actor_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    source TEXT NOT NULL CHECK(source IN (
      'registration_submission', 'waitlist_rollover', 'staff_action', 'offer_response',
      'offer_expiration', 'placement_process', 'system_cleanup'
    )),
    action TEXT NOT NULL CHECK(action IN (
      'entry_created', 'entry_removed', 'entry_reordered', 'entry_rolled_over',
      'entry_converted_add_to_replace', 'entry_converted_replace_to_add', 'replacement_league_changed',
      'offer_sent', 'offer_accepted', 'offer_declined', 'offer_expired_accepted',
      'decline_count_changed', 'entry_moved_to_bottom', 'entry_placed', 'staff_correction'
    )),
    reason TEXT,
    before_json TEXT,
    after_json TEXT,
    metadata_json TEXT,
    created_at DATETIME NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_waitlist_audit_events_waitlist_entry_id ON waitlist_audit_events(waitlist_entry_id);
  CREATE INDEX IF NOT EXISTS idx_waitlist_audit_events_league_id ON waitlist_audit_events(league_id);
  CREATE INDEX IF NOT EXISTS idx_waitlist_audit_events_member_id ON waitlist_audit_events(member_id);
  CREATE INDEX IF NOT EXISTS idx_waitlist_audit_events_actor_member_id ON waitlist_audit_events(actor_member_id);
  CREATE INDEX IF NOT EXISTS idx_waitlist_audit_events_created_at ON waitlist_audit_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_waitlist_audit_events_action ON waitlist_audit_events(action);
`;

/** Tables that must include `season_id`; if missing, the table likely predates Phase 1 and only `CREATE TABLE IF NOT EXISTS` skipped the new layout. Drop so full DDL can recreate. */
function postgresRepairRegistrationStubTablesSql(): string {
  const tablesExpectingSeasonId = [
    'curling_sessions',
    'registration_periods',
    'curling_registrations',
    'registration_price_configs',
    'registration_discount_configs',
    'season_memberships',
    'curling_ice_privileges',
  ] satisfies string[];

  const parts: string[] = [];
  for (const tbl of tablesExpectingSeasonId) {
    parts.push(`
DO $$
BEGIN
  IF EXISTS (
      SELECT 1 FROM information_schema.tables t
      WHERE t.table_schema = current_schema()
        AND t.table_name = '${tbl}')
     AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = current_schema()
        AND c.table_name = '${tbl}'
        AND c.column_name = 'season_id') THEN
    EXECUTE 'DROP TABLE IF EXISTS ${tbl} CASCADE';
  END IF;
END $$;`);
  }
  return parts.join('\n');
}

export function curlingRegistrationDDLForDialect(isPostgres: boolean): string {
  if (!isPostgres) return curlingRegistrationDDLBase;

  let s = curlingRegistrationDDLBase;
  s = s.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
  s = s.replace(/REAL/g, 'DOUBLE PRECISION');
  s = s.replace(/before_json TEXT/g, 'before_json JSONB');
  s = s.replace(/after_json TEXT/g, 'after_json JSONB');
  s = s.replace(/metadata_json TEXT/g, 'metadata_json JSONB');
  s = s.replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/g, 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  s = s.replace(/DATETIME NOT NULL\b/g, 'TIMESTAMP NOT NULL');
  s = s.replace(/\bDATETIME\b/g, 'TIMESTAMP');
  return s;
}

const leagueBootstrapColumnsSQLite: { name: string; ddl: string }[] = [
  { name: 'session_id', ddl: 'session_id INTEGER REFERENCES curling_sessions(id) ON DELETE SET NULL' },
  { name: 'league_type', ddl: "league_type TEXT NOT NULL DEFAULT 'standard' CHECK(league_type IN ('standard','bring_your_own_team'))" },
  {
    name: 'capacity_type',
    ddl: "capacity_type TEXT NOT NULL DEFAULT 'individual' CHECK(capacity_type IN ('individual','team'))",
  },
  { name: 'capacity_value', ddl: 'capacity_value INTEGER NOT NULL DEFAULT 0 CHECK(capacity_value >= 0)' },
  {
    name: 'registration_fee_minor',
    ddl: 'registration_fee_minor INTEGER NOT NULL DEFAULT 0 CHECK(registration_fee_minor >= 0)',
  },
  { name: 'requires_club_membership', ddl: 'requires_club_membership INTEGER NOT NULL DEFAULT 1' },
  { name: 'is_instructional', ddl: 'is_instructional INTEGER NOT NULL DEFAULT 0' },
  { name: 'min_experience_years', ddl: 'min_experience_years INTEGER' },
  { name: 'min_age', ddl: 'min_age INTEGER' },
  { name: 'max_age', ddl: 'max_age INTEGER' },
  { name: 'first_day_of_play', ddl: 'first_day_of_play DATE' },
  { name: 'last_day_of_play', ddl: 'last_day_of_play DATE' },
  { name: 'allows_waitlist', ddl: 'allows_waitlist INTEGER NOT NULL DEFAULT 1' },
  { name: 'allows_sabbatical', ddl: 'allows_sabbatical INTEGER NOT NULL DEFAULT 1' },
  {
    name: 'predecessor_league_id',
    ddl: 'predecessor_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL',
  },
  {
    name: 'successor_league_id',
    ddl: 'successor_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL',
  },
];

async function ensureSQLiteColumn(
  db: DatabaseAdapter,
  table: string,
  columnName: string,
  alterFragment: string,
  execSQL: (d: DatabaseAdapter, s: string) => Promise<void>
): Promise<void> {
  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(${table})`);
  const rowsRaw = stmt.all();
  const rows = rowsRaw instanceof Promise ? await rowsRaw : rowsRaw;
  const columnNames = new Set(rows.map((c: { name?: string | null }) => String(c.name)));
  if (!columnNames.has(columnName)) {
    await execSQL(db, `ALTER TABLE ${table} ADD COLUMN ${alterFragment}`);
  }
}

async function sqliteEnsureLeaguesRegistrationColumns(
  db: DatabaseAdapter,
  execSQL: (d: DatabaseAdapter, s: string) => Promise<void>
): Promise<void> {
  for (const col of leagueBootstrapColumnsSQLite) {
    await ensureSQLiteColumn(db, 'leagues', col.name, col.ddl, execSQL);
  }
  await execSQL(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_leagues_session_id ON leagues(session_id);
    CREATE INDEX IF NOT EXISTS idx_leagues_predecessor_league_id ON leagues(predecessor_league_id);
    CREATE INDEX IF NOT EXISTS idx_leagues_successor_league_id ON leagues(successor_league_id);
    CREATE INDEX IF NOT EXISTS idx_leagues_league_type ON leagues(league_type);
    `
  );
}

const leagueBootstrapColumnsPg: string[] = [
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES curling_sessions(id) ON DELETE SET NULL',
  "ALTER TABLE leagues ADD COLUMN IF NOT EXISTS league_type TEXT NOT NULL DEFAULT 'standard'",
  "ALTER TABLE leagues ADD COLUMN IF NOT EXISTS capacity_type TEXT NOT NULL DEFAULT 'individual'",
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS capacity_value INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS registration_fee_minor INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS requires_club_membership INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS is_instructional INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS min_experience_years INTEGER',
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS min_age INTEGER',
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS max_age INTEGER',
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS first_day_of_play DATE',
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS last_day_of_play DATE',
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS allows_waitlist INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS allows_sabbatical INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS predecessor_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL',
  'ALTER TABLE leagues ADD COLUMN IF NOT EXISTS successor_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL',
];

async function ensureLeagueBootstrapPostgres(db: DatabaseAdapter, execSQL: (d: DatabaseAdapter, s: string) => Promise<void>) {
  for (const ddl of leagueBootstrapColumnsPg) {
    await execSQL(db, ddl);
  }
  await execSQL(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_leagues_session_id ON leagues(session_id);
    CREATE INDEX IF NOT EXISTS idx_leagues_predecessor_league_id ON leagues(predecessor_league_id);
    CREATE INDEX IF NOT EXISTS idx_leagues_successor_league_id ON leagues(successor_league_id);
    CREATE INDEX IF NOT EXISTS idx_leagues_league_type ON leagues(league_type);
    `
  );
}

const leagueRosterBootstrapSqliteCols: { name: string; ddl: string }[] = [
  {
    name: 'source_registration_id',
    ddl: 'source_registration_id INTEGER REFERENCES curling_registrations(id) ON DELETE SET NULL',
  },
  {
    name: 'status',
    ddl:
      "status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending','active','cancelled','removed','completed'))",
  },
  {
    name: 'placement_type',
    ddl:
      "placement_type TEXT CHECK(placement_type IN ('guaranteed_return','new_placement','waitlist_add','waitlist_replace','byot','staff_manual','temporary_sabbatical_fill'))",
  },
  { name: 'is_temporary_sabbatical_fill', ddl: 'is_temporary_sabbatical_fill INTEGER NOT NULL DEFAULT 0' },
  {
    name: 'related_sabbatical_id',
    ddl:
      'related_sabbatical_id INTEGER REFERENCES curling_league_sabbaticals(id) ON DELETE SET NULL',
  },
];

async function sqliteEnsureLeagueRosterColumns(db: DatabaseAdapter, execSQL: (d: DatabaseAdapter, s: string) => Promise<void>) {
  for (const c of leagueRosterBootstrapSqliteCols) {
    await ensureSQLiteColumn(db, 'league_roster', c.name, c.ddl, execSQL);
  }
}

const leagueRosterBootstrapPgStatements = [
  'ALTER TABLE league_roster ADD COLUMN IF NOT EXISTS source_registration_id INTEGER REFERENCES curling_registrations(id) ON DELETE SET NULL',
  `ALTER TABLE league_roster ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`,
  'ALTER TABLE league_roster ADD COLUMN IF NOT EXISTS placement_type TEXT',
  'ALTER TABLE league_roster ADD COLUMN IF NOT EXISTS is_temporary_sabbatical_fill INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE league_roster ADD COLUMN IF NOT EXISTS related_sabbatical_id INTEGER REFERENCES curling_league_sabbaticals(id) ON DELETE SET NULL',
];

async function postgresEnsureLeagueRosterBootstrap(db: DatabaseAdapter, execSQL: (d: DatabaseAdapter, s: string) => Promise<void>) {
  for (const s of leagueRosterBootstrapPgStatements) {
    await execSQL(db, s);
  }
}

/**
 * Applies Phase 1 curling registration DDL and league extension columns.
 */
export async function ensureCurlingRegistrationBootstrap(
  db: DatabaseAdapter,
  execSQL: (d: DatabaseAdapter, s: string) => Promise<void>
): Promise<void> {
  const isPg = Boolean(db.isAsync?.());
  if (isPg) {
    await execSQL(db, postgresRepairRegistrationStubTablesSql());
    await execSQL(db, curlingRegistrationDDLForDialect(true));
    await ensureLeagueBootstrapPostgres(db, execSQL);
    await postgresEnsureLeagueRosterBootstrap(db, execSQL);
  } else {
    await execSQL(db, curlingRegistrationDDLForDialect(false));
    await sqliteEnsureLeaguesRegistrationColumns(db, execSQL);
    await sqliteEnsureLeagueRosterColumns(db, execSQL);
  }
}

export function ensureCurlingRegistrationBootstrapSync(
  db: DatabaseAdapter,
  execSQLSync: (d: DatabaseAdapter, s: string) => void
): void {
  execSQLSync(db, curlingRegistrationDDLForDialect(false));
  const leagueStmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(leagues)`);
  const leagueCols = leagueStmt.all() as { name?: string | null }[];
  const leagueNames = new Set(leagueCols.map((c) => String(c.name)));
  for (const col of leagueBootstrapColumnsSQLite) {
    if (!leagueNames.has(col.name)) {
      execSQLSync(db, `ALTER TABLE leagues ADD COLUMN ${col.ddl}`);
    }
  }
  execSQLSync(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_leagues_session_id ON leagues(session_id);
    CREATE INDEX IF NOT EXISTS idx_leagues_predecessor_league_id ON leagues(predecessor_league_id);
    CREATE INDEX IF NOT EXISTS idx_leagues_successor_league_id ON leagues(successor_league_id);
    CREATE INDEX IF NOT EXISTS idx_leagues_league_type ON leagues(league_type);
    `
  );
  const rosterStmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(league_roster)`);
  const rosterColsRaw = rosterStmt.all() as { name?: string | null }[];
  const rosterNames = new Set(rosterColsRaw.map((c) => String(c.name)));
  for (const c of leagueRosterBootstrapSqliteCols) {
    if (!rosterNames.has(c.name)) {
      execSQLSync(db, `ALTER TABLE league_roster ADD COLUMN ${c.ddl}`);
    }
  }
}
