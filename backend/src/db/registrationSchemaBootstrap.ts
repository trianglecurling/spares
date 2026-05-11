import type { DatabaseAdapter } from './adapter.js';
import { sql } from 'drizzle-orm';
import { getDatabaseConfig } from './config.js';
import { getDrizzleDb } from './drizzle-db.js';

/** Registration shell DDL. Earlier prototype registration tables are intentionally replaced. */
export const curlingRegistrationDDLBase = `
  CREATE TABLE IF NOT EXISTS curling_seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS curling_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL REFERENCES curling_seasons(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_curling_sessions_season_id ON curling_sessions(season_id);
  CREATE INDEX IF NOT EXISTS idx_curling_sessions_season_start ON curling_sessions(season_id, start_date);

  CREATE TABLE IF NOT EXISTS registration_state_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL REFERENCES curling_seasons(id) ON DELETE CASCADE,
    session_id INTEGER NOT NULL REFERENCES curling_sessions(id) ON DELETE CASCADE,
    effective_at TIMESTAMP NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('closed', 'priority', 'open')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_registration_state_transitions_season_id ON registration_state_transitions(season_id);
  CREATE INDEX IF NOT EXISTS idx_registration_state_transitions_session_id ON registration_state_transitions(session_id);
  CREATE INDEX IF NOT EXISTS idx_registration_state_transitions_lookup ON registration_state_transitions(season_id, session_id, effective_at);

  CREATE TABLE IF NOT EXISTS curling_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL REFERENCES curling_seasons(id) ON DELETE RESTRICT,
    session_id INTEGER NOT NULL REFERENCES curling_sessions(id) ON DELETE RESTRICT,
    submitted_by_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
    curler_member_id INTEGER REFERENCES members(id) ON DELETE RESTRICT,
    returning_member_answer INTEGER CHECK(returning_member_answer IN (0, 1)),
    registering_for_self INTEGER CHECK(registering_for_self IN (0, 1)),
    demographics_current_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(demographics_current_confirmed IN (0, 1)),
    guardian_first_name TEXT,
    guardian_last_name TEXT,
    guardian_email TEXT,
    guardian_phone TEXT,
    membership_option TEXT NOT NULL DEFAULT 'none' CHECK(membership_option IN ('none', 'regular', 'social', 'regular_spare_only', 'junior_recreational')),
    experience_type TEXT CHECK(experience_type IN ('none_or_minimal', 'specified_years', 'known_existing')),
    experience_self_reported_years REAL,
    student_discount_claimed INTEGER NOT NULL DEFAULT 0 CHECK(student_discount_claimed IN (0, 1)),
    student_institution TEXT,
    reciprocal_discount_claimed INTEGER NOT NULL DEFAULT 0 CHECK(reciprocal_discount_claimed IN (0, 1)),
    reciprocal_club_name TEXT,
    last_fee_preview_json TEXT,
    payment_decision_json TEXT,
    status TEXT NOT NULL DEFAULT 'identity_incomplete' CHECK(status IN (
      'identity_incomplete',
      'policies_incomplete',
      'demographics_incomplete',
      'shell_complete',
      'submitted',
      'awaiting_staff_review',
      'awaiting_placement',
      'awaiting_payment',
      'payment_started',
      'paid',
      'confirmed',
      'cancelled'
    )),
    shell_completed_at DATETIME,
    submitted_at DATETIME,
    cancelled_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_curling_registrations_season_id ON curling_registrations(season_id);
  CREATE INDEX IF NOT EXISTS idx_curling_registrations_session_id ON curling_registrations(session_id);
  CREATE INDEX IF NOT EXISTS idx_curling_registrations_curler_member_id ON curling_registrations(curler_member_id);
  CREATE INDEX IF NOT EXISTS idx_curling_registrations_submitted_by_member_id ON curling_registrations(submitted_by_member_id);
  CREATE INDEX IF NOT EXISTS idx_curling_registrations_status ON curling_registrations(status);
  CREATE INDEX IF NOT EXISTS idx_curling_registrations_resume ON curling_registrations(season_id, session_id, curler_member_id, status);

  CREATE TABLE IF NOT EXISTS registration_policy_acceptances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_id INTEGER NOT NULL REFERENCES curling_registrations(id) ON DELETE CASCADE,
    policy_type TEXT NOT NULL CHECK(policy_type IN ('code_of_conduct', 'maapp', 'privacy')),
    policy_url TEXT NOT NULL,
    accepted_by_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    accepted_for_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    accepted_at DATETIME NOT NULL,
    policy_version TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(registration_id, policy_type)
  );
  CREATE INDEX IF NOT EXISTS idx_registration_policy_acceptances_registration_id ON registration_policy_acceptances(registration_id);

  CREATE TABLE IF NOT EXISTS registration_price_settings (
    scope TEXT PRIMARY KEY NOT NULL DEFAULT 'singleton',
    regular_membership_fee_minor INTEGER NOT NULL DEFAULT 0,
    social_membership_fee_minor INTEGER NOT NULL DEFAULT 0,
    spare_only_ice_privilege_fee_minor INTEGER NOT NULL DEFAULT 0,
    sabbatical_fee_minor INTEGER NOT NULL DEFAULT 0,
    junior_recreational_fee_minor INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS registration_discount_settings (
    scope TEXT PRIMARY KEY NOT NULL DEFAULT 'singleton',
    student_discount_amount_type TEXT NOT NULL DEFAULT 'dollar',
    student_discount_amount_value INTEGER NOT NULL DEFAULT 0,
    reciprocal_discount_amount_type TEXT NOT NULL DEFAULT 'dollar',
    reciprocal_discount_amount_value INTEGER NOT NULL DEFAULT 0,
    winter_only_discount_amount_type TEXT NOT NULL DEFAULT 'dollar',
    winter_only_discount_amount_value INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

const legacyRegistrationTables = [
  'waitlist_audit_events',
  'waitlist_offers',
  'waitlist_entries',
  'curling_sabbatical_sessions',
  'curling_ice_privileges',
  'season_memberships',
  'registration_invoice_line_items',
  'registration_invoices',
  'financial_assistance_requests',
  'registration_selections',
  'registration_policy_acceptances',
  'curling_league_sabbaticals',
  'curling_registrations',
  'registration_discount_configs',
  'registration_price_configs',
  'registration_periods',
] as const;

const legacyAlwaysDropTables = legacyRegistrationTables.filter(
  (table) => table !== 'curling_registrations' && table !== 'registration_policy_acceptances'
);

const memberDemographicColumnsSQLite: { name: string; ddl: string }[] = [
  { name: 'first_name', ddl: 'first_name TEXT' },
  { name: 'last_name', ddl: 'last_name TEXT' },
  { name: 'date_of_birth', ddl: 'date_of_birth DATE' },
  { name: 'mailing_address', ddl: 'mailing_address TEXT' },
  { name: 'emergency_contact_name', ddl: 'emergency_contact_name TEXT' },
  { name: 'emergency_contact_phone', ddl: 'emergency_contact_phone TEXT' },
];

function curlingRegistrationDDLForDialect(isPostgres: boolean): string {
  if (!isPostgres) return curlingRegistrationDDLBase;
  let s = curlingRegistrationDDLBase;
  s = s.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
  s = s.replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/g, 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  s = s.replace(/DATETIME NOT NULL\b/g, 'TIMESTAMP NOT NULL');
  s = s.replace(/\bDATETIME\b/g, 'TIMESTAMP');
  return s;
}

/** Idempotent DDL for installs that predate registration pricing tables (Postgres / SQLite). */
export async function ensureRegistrationPriceDiscountSettingsTablesExist(): Promise<void> {
  const config = getDatabaseConfig();
  if (!config || (config.type !== 'postgres' && config.type !== 'sqlite')) return;

  const { db } = getDrizzleDb();

  if (config.type === 'postgres') {
    await db.execute(sql.raw(`
CREATE TABLE IF NOT EXISTS registration_price_settings (
  scope TEXT PRIMARY KEY NOT NULL DEFAULT 'singleton',
  regular_membership_fee_minor INTEGER NOT NULL DEFAULT 0,
  social_membership_fee_minor INTEGER NOT NULL DEFAULT 0,
  spare_only_ice_privilege_fee_minor INTEGER NOT NULL DEFAULT 0,
  sabbatical_fee_minor INTEGER NOT NULL DEFAULT 0,
  junior_recreational_fee_minor INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`));
    await db.execute(sql.raw(`
CREATE TABLE IF NOT EXISTS registration_discount_settings (
  scope TEXT PRIMARY KEY NOT NULL DEFAULT 'singleton',
  student_discount_amount_type TEXT NOT NULL DEFAULT 'dollar',
  student_discount_amount_value INTEGER NOT NULL DEFAULT 0,
  reciprocal_discount_amount_type TEXT NOT NULL DEFAULT 'dollar',
  reciprocal_discount_amount_value INTEGER NOT NULL DEFAULT 0,
  winter_only_discount_amount_type TEXT NOT NULL DEFAULT 'dollar',
  winter_only_discount_amount_value INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`));
    return;
  }

  await db.execute(sql.raw(`
CREATE TABLE IF NOT EXISTS registration_price_settings (
  scope TEXT PRIMARY KEY NOT NULL DEFAULT 'singleton',
  regular_membership_fee_minor INTEGER NOT NULL DEFAULT 0,
  social_membership_fee_minor INTEGER NOT NULL DEFAULT 0,
  spare_only_ice_privilege_fee_minor INTEGER NOT NULL DEFAULT 0,
  sabbatical_fee_minor INTEGER NOT NULL DEFAULT 0,
  junior_recreational_fee_minor INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`));
  await db.execute(sql.raw(`
CREATE TABLE IF NOT EXISTS registration_discount_settings (
  scope TEXT PRIMARY KEY NOT NULL DEFAULT 'singleton',
  student_discount_amount_type TEXT NOT NULL DEFAULT 'dollar',
  student_discount_amount_value INTEGER NOT NULL DEFAULT 0,
  reciprocal_discount_amount_type TEXT NOT NULL DEFAULT 'dollar',
  reciprocal_discount_amount_value INTEGER NOT NULL DEFAULT 0,
  winter_only_discount_amount_type TEXT NOT NULL DEFAULT 'dollar',
  winter_only_discount_amount_value INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`));
}

async function allMaybe<T>(result: T[] | Promise<T[]>): Promise<T[]> {
  return result instanceof Promise ? await result : result;
}

async function ensureMemberDemographicColumns(
  db: DatabaseAdapter,
  execSQL: (d: DatabaseAdapter, s: string) => Promise<void>
): Promise<void> {
  if (db.isAsync()) {
    for (const col of memberDemographicColumnsSQLite) {
      const pgType = col.name === 'date_of_birth' ? 'DATE' : 'TEXT';
      await execSQL(db, `ALTER TABLE members ADD COLUMN IF NOT EXISTS ${col.name} ${pgType}`);
    }
    return;
  }

  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(members)`);
  const rows = await allMaybe(stmt.all());
  const names = new Set(rows.map((c) => String(c.name)));
  for (const col of memberDemographicColumnsSQLite) {
    if (!names.has(col.name)) {
      await execSQL(db, `ALTER TABLE members ADD COLUMN ${col.ddl}`);
    }
  }
}

function ensureMemberDemographicColumnsSync(
  db: DatabaseAdapter,
  execSQLSync: (d: DatabaseAdapter, s: string) => void
): void {
  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(members)`);
  const rows = stmt.all() as { name?: string | null }[];
  const names = new Set(rows.map((c) => String(c.name)));
  for (const col of memberDemographicColumnsSQLite) {
    if (!names.has(col.name)) {
      execSQLSync(db, `ALTER TABLE members ADD COLUMN ${col.ddl}`);
    }
  }
}

async function dropLegacyRegistrationTables(
  db: DatabaseAdapter,
  execSQL: (d: DatabaseAdapter, s: string) => Promise<void>
): Promise<void> {
  if (db.isAsync()) {
    for (const table of legacyAlwaysDropTables) {
      await execSQL(db, `DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    return;
  }

  await execSQL(db, `PRAGMA foreign_keys = OFF`);
  try {
    for (const table of legacyAlwaysDropTables) {
      await execSQL(db, `DROP TABLE IF EXISTS ${table}`);
    }
  } finally {
    await execSQL(db, `PRAGMA foreign_keys = ON`);
  }
}

function dropLegacyRegistrationTablesSync(
  db: DatabaseAdapter,
  execSQLSync: (d: DatabaseAdapter, s: string) => void
): void {
  execSQLSync(db, `PRAGMA foreign_keys = OFF`);
  try {
    for (const table of legacyAlwaysDropTables) {
      execSQLSync(db, `DROP TABLE IF EXISTS ${table}`);
    }
  } finally {
    execSQLSync(db, `PRAGMA foreign_keys = ON`);
  }
}

const leagueBootstrapColumnsSQLite: { name: string; ddl: string }[] = [
  { name: 'session_id', ddl: 'session_id INTEGER REFERENCES curling_sessions(id) ON DELETE SET NULL' },
  { name: 'league_type', ddl: "league_type TEXT NOT NULL DEFAULT 'standard' CHECK(league_type IN ('standard','bring_your_own_team'))" },
  { name: 'capacity_type', ddl: "capacity_type TEXT NOT NULL DEFAULT 'individual' CHECK(capacity_type IN ('individual','team'))" },
  { name: 'capacity_value', ddl: 'capacity_value INTEGER NOT NULL DEFAULT 0 CHECK(capacity_value >= 0)' },
  { name: 'registration_fee_minor', ddl: 'registration_fee_minor INTEGER NOT NULL DEFAULT 0 CHECK(registration_fee_minor >= 0)' },
  { name: 'requires_club_membership', ddl: 'requires_club_membership INTEGER NOT NULL DEFAULT 1' },
  { name: 'is_instructional', ddl: 'is_instructional INTEGER NOT NULL DEFAULT 0' },
  { name: 'min_experience_years', ddl: 'min_experience_years INTEGER' },
  { name: 'min_age', ddl: 'min_age INTEGER' },
  { name: 'max_age', ddl: 'max_age INTEGER' },
  { name: 'first_day_of_play', ddl: 'first_day_of_play DATE' },
  { name: 'last_day_of_play', ddl: 'last_day_of_play DATE' },
  { name: 'allows_waitlist', ddl: 'allows_waitlist INTEGER NOT NULL DEFAULT 1' },
  { name: 'allows_sabbatical', ddl: 'allows_sabbatical INTEGER NOT NULL DEFAULT 1' },
  { name: 'predecessor_league_id', ddl: 'predecessor_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL' },
  { name: 'successor_league_id', ddl: 'successor_league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL' },
];

const registrationPhase5ColumnsSQLite: { name: string; ddl: string }[] = [
  { name: 'membership_option', ddl: "membership_option TEXT NOT NULL DEFAULT 'none' CHECK(membership_option IN ('none', 'regular', 'social', 'regular_spare_only', 'junior_recreational'))" },
  { name: 'experience_type', ddl: "experience_type TEXT CHECK(experience_type IN ('none_or_minimal', 'specified_years', 'known_existing'))" },
  { name: 'experience_self_reported_years', ddl: 'experience_self_reported_years REAL' },
  { name: 'student_discount_claimed', ddl: 'student_discount_claimed INTEGER NOT NULL DEFAULT 0 CHECK(student_discount_claimed IN (0, 1))' },
  { name: 'student_institution', ddl: 'student_institution TEXT' },
  { name: 'reciprocal_discount_claimed', ddl: 'reciprocal_discount_claimed INTEGER NOT NULL DEFAULT 0 CHECK(reciprocal_discount_claimed IN (0, 1))' },
  { name: 'reciprocal_club_name', ddl: 'reciprocal_club_name TEXT' },
  { name: 'last_fee_preview_json', ddl: 'last_fee_preview_json TEXT' },
  { name: 'payment_decision_json', ddl: 'payment_decision_json TEXT' },
  { name: 'submitted_at', ddl: 'submitted_at DATETIME' },
];

async function ensureSQLiteColumn(
  db: DatabaseAdapter,
  table: string,
  columnName: string,
  alterFragment: string,
  execSQL: (d: DatabaseAdapter, s: string) => Promise<void>
): Promise<void> {
  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(${table})`);
  const rows = await allMaybe(stmt.all());
  const names = new Set(rows.map((c) => String(c.name)));
  if (!names.has(columnName)) {
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

async function sqliteEnsureRegistrationPhase5Columns(
  db: DatabaseAdapter,
  execSQL: (d: DatabaseAdapter, s: string) => Promise<void>
): Promise<void> {
  for (const col of registrationPhase5ColumnsSQLite) {
    await ensureSQLiteColumn(db, 'curling_registrations', col.name, col.ddl, execSQL);
  }
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

const registrationPhase5ColumnsPg: string[] = [
  "ALTER TABLE curling_registrations ADD COLUMN IF NOT EXISTS membership_option TEXT NOT NULL DEFAULT 'none'",
  'ALTER TABLE curling_registrations ADD COLUMN IF NOT EXISTS experience_type TEXT',
  'ALTER TABLE curling_registrations ADD COLUMN IF NOT EXISTS experience_self_reported_years DOUBLE PRECISION',
  'ALTER TABLE curling_registrations ADD COLUMN IF NOT EXISTS student_discount_claimed INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE curling_registrations ADD COLUMN IF NOT EXISTS student_institution TEXT',
  'ALTER TABLE curling_registrations ADD COLUMN IF NOT EXISTS reciprocal_discount_claimed INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE curling_registrations ADD COLUMN IF NOT EXISTS reciprocal_club_name TEXT',
  'ALTER TABLE curling_registrations ADD COLUMN IF NOT EXISTS last_fee_preview_json JSONB',
  'ALTER TABLE curling_registrations ADD COLUMN IF NOT EXISTS payment_decision_json JSONB',
  'ALTER TABLE curling_registrations ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP',
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

async function ensureRegistrationPhase5Postgres(db: DatabaseAdapter, execSQL: (d: DatabaseAdapter, s: string) => Promise<void>) {
  for (const ddl of registrationPhase5ColumnsPg) {
    await execSQL(db, ddl);
  }
}

/**
 * Applies clean registration-shell DDL and intentionally migrates away from
 * previous prototype registration tables.
 */
export async function ensureCurlingRegistrationBootstrap(
  db: DatabaseAdapter,
  execSQL: (d: DatabaseAdapter, s: string) => Promise<void>
): Promise<void> {
  await ensureMemberDemographicColumns(db, execSQL);
  await dropLegacyRegistrationTables(db, execSQL);
  await execSQL(db, curlingRegistrationDDLForDialect(Boolean(db.isAsync?.())));
  if (db.isAsync()) {
    await ensureRegistrationPhase5Postgres(db, execSQL);
    await ensureLeagueBootstrapPostgres(db, execSQL);
  } else {
    await sqliteEnsureRegistrationPhase5Columns(db, execSQL);
    await sqliteEnsureLeaguesRegistrationColumns(db, execSQL);
  }
}

export function ensureCurlingRegistrationBootstrapSync(
  db: DatabaseAdapter,
  execSQLSync: (d: DatabaseAdapter, s: string) => void
): void {
  ensureMemberDemographicColumnsSync(db, execSQLSync);
  dropLegacyRegistrationTablesSync(db, execSQLSync);
  execSQLSync(db, curlingRegistrationDDLForDialect(false));

  const registrationStmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(curling_registrations)`);
  const registrationCols = registrationStmt.all() as { name?: string | null }[];
  const registrationNames = new Set(registrationCols.map((c) => String(c.name)));
  for (const col of registrationPhase5ColumnsSQLite) {
    if (!registrationNames.has(col.name)) {
      execSQLSync(db, `ALTER TABLE curling_registrations ADD COLUMN ${col.ddl}`);
    }
  }

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
}
