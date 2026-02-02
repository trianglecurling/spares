import { DatabaseAdapter } from './adapter.js';
import type { DatabaseResult, PreparedStatement } from './adapter.js';

// Helper to execute SQL that may be sync or async
async function execSQL(db: DatabaseAdapter, sql: string): Promise<void> {
  const result = db.exec(sql);
  if (result instanceof Promise) {
    await result;
  }
}

// Synchronous version for SQLite
function execSQLSync(db: DatabaseAdapter, sql: string): void {
  const result = db.exec(sql);
  if (result instanceof Promise) {
    throw new Error('Database operation returned a promise but sync execution was expected');
  }
}

// Helper to run prepared statement that may be sync or async
async function runPrepared(stmt: PreparedStatement, ...params: unknown[]): Promise<DatabaseResult> {
  const result = stmt.run(...params);
  if (result instanceof Promise) {
    return await result;
  }
  return result;
}

// Helper to get from prepared statement
async function getPrepared<T>(stmt: PreparedStatement<T | null, T[]>, ...params: unknown[]): Promise<T | null> {
  const result = stmt.get(...params);
  if (result instanceof Promise) {
    return await result;
  }
  return result;
}

// Helper to get all from prepared statement
async function allPrepared<T>(stmt: PreparedStatement<T, T[]>, ...params: unknown[]): Promise<T[]> {
  const result = stmt.all(...params);
  if (result instanceof Promise) {
    return await result;
  }
  return result;
}

async function ensureRequestedForMemberIdColumn(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    const stmt = db.prepare<{ column_name?: string | null }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'spare_requests'
    `);
    const rows = await allPrepared<{ column_name?: string | null }>(stmt);
    const columnNames = new Set(rows.map((row) => String(row.column_name)));
    if (!columnNames.has('requested_for_member_id')) {
      await execSQL(
        db,
        `
          ALTER TABLE spare_requests
          ADD COLUMN IF NOT EXISTS requested_for_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
        `
      );
    }
    if (!columnNames.has('cancelled_by_member_id')) {
      await execSQL(
        db,
        `
          ALTER TABLE spare_requests
          ADD COLUMN IF NOT EXISTS cancelled_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
        `
      );
    }
    await execSQL(
      db,
      `
        CREATE INDEX IF NOT EXISTS idx_spare_requests_requested_for_member_id
        ON spare_requests(requested_for_member_id);
        CREATE INDEX IF NOT EXISTS idx_spare_requests_cancelled_by_member_id
        ON spare_requests(cancelled_by_member_id);
      `
    );
    return;
  }

  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(spare_requests)`);
  const columns = await allPrepared<{ name?: string | null }>(stmt);
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('requested_for_member_id')) {
    await execSQL(
      db,
      `
        ALTER TABLE spare_requests
        ADD COLUMN requested_for_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
      `
    );
  }
  if (!columnNames.has('cancelled_by_member_id')) {
    await execSQL(
      db,
      `
        ALTER TABLE spare_requests
        ADD COLUMN cancelled_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
      `
    );
  }
  await execSQL(
    db,
    `
      CREATE INDEX IF NOT EXISTS idx_spare_requests_requested_for_member_id
      ON spare_requests(requested_for_member_id);
      CREATE INDEX IF NOT EXISTS idx_spare_requests_cancelled_by_member_id
      ON spare_requests(cancelled_by_member_id);
    `
  );
}

function ensureRequestedForMemberIdColumnSync(db: DatabaseAdapter): void {
  const stmt = db.prepare(`PRAGMA table_info(spare_requests)`);
  const columns = stmt.all() as { name?: string }[];
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('requested_for_member_id')) {
    execSQLSync(
      db,
      `
        ALTER TABLE spare_requests
        ADD COLUMN requested_for_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
      `
    );
  }
  if (!columnNames.has('cancelled_by_member_id')) {
    execSQLSync(
      db,
      `
        ALTER TABLE spare_requests
        ADD COLUMN cancelled_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
      `
    );
  }
  execSQLSync(
    db,
    `
      CREATE INDEX IF NOT EXISTS idx_spare_requests_requested_for_member_id
      ON spare_requests(requested_for_member_id);
      CREATE INDEX IF NOT EXISTS idx_spare_requests_cancelled_by_member_id
      ON spare_requests(cancelled_by_member_id);
    `
  );
}

export async function createSchema(db: DatabaseAdapter): Promise<void> {
  await execSQL(db, `
    -- Members table
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      valid_through DATE,
      spare_only INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      is_server_admin INTEGER DEFAULT 0,
      opted_in_sms INTEGER DEFAULT 0,
      email_subscribed INTEGER DEFAULT 1,
      first_login_completed INTEGER DEFAULT 0,
      email_visible INTEGER DEFAULT 0,
      phone_visible INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
    CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);

    -- Auth codes table (for login)
    CREATE TABLE IF NOT EXISTS auth_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_auth_codes_contact ON auth_codes(contact);
    CREATE INDEX IF NOT EXISTS idx_auth_codes_code ON auth_codes(code);

    -- Auth tokens table (long-lasting authorization)
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_member_id ON auth_tokens(member_id);

    -- Leagues table
    CREATE TABLE IF NOT EXISTS leagues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      format TEXT NOT NULL CHECK(format IN ('teams', 'doubles')),
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- League draw times
    CREATE TABLE IF NOT EXISTS league_draw_times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      draw_time TIME NOT NULL,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_league_draw_times_league_id ON league_draw_times(league_id);

    -- League exceptions (dates when a league does NOT run)
    CREATE TABLE IF NOT EXISTS league_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      exception_date DATE NOT NULL,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      UNIQUE(league_id, exception_date)
    );

    CREATE INDEX IF NOT EXISTS idx_league_exceptions_league_id ON league_exceptions(league_id);

    -- Sheets (club-level)
    CREATE TABLE IF NOT EXISTS sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name)
    );

    CREATE INDEX IF NOT EXISTS idx_sheets_is_active ON sheets(is_active);
    CREATE INDEX IF NOT EXISTS idx_sheets_sort_order ON sheets(sort_order);

    -- League divisions
    CREATE TABLE IF NOT EXISTS league_divisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      UNIQUE(league_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_league_divisions_league_id ON league_divisions(league_id);
    CREATE INDEX IF NOT EXISTS idx_league_divisions_league_id_sort ON league_divisions(league_id, sort_order);

    -- League teams
    CREATE TABLE IF NOT EXISTS league_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      division_id INTEGER NOT NULL,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      FOREIGN KEY (division_id) REFERENCES league_divisions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_league_teams_league_id ON league_teams(league_id);
    CREATE INDEX IF NOT EXISTS idx_league_teams_division_id ON league_teams(division_id);

    -- Team members (rosters)
    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      is_skip INTEGER DEFAULT 0,
      is_vice INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES league_teams(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(team_id, member_id)
    );

    CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
    CREATE INDEX IF NOT EXISTS idx_team_members_member_id ON team_members(member_id);

    -- League member roles (league managers)
    CREATE TABLE IF NOT EXISTS league_member_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      league_id INTEGER,
      role TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      UNIQUE(member_id, league_id, role)
    );

    CREATE INDEX IF NOT EXISTS idx_league_member_roles_member_id ON league_member_roles(member_id);
    CREATE INDEX IF NOT EXISTS idx_league_member_roles_league_id ON league_member_roles(league_id);

    -- League roster (eligible members for team assignments)
    CREATE TABLE IF NOT EXISTS league_roster (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(league_id, member_id)
    );

    CREATE INDEX IF NOT EXISTS idx_league_roster_league_id ON league_roster(league_id);
    CREATE INDEX IF NOT EXISTS idx_league_roster_member_id ON league_roster(member_id);

    -- Sheets (club-level)
    CREATE TABLE IF NOT EXISTS sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name)
    );

    CREATE INDEX IF NOT EXISTS idx_sheets_is_active ON sheets(is_active);
    CREATE INDEX IF NOT EXISTS idx_sheets_sort_order ON sheets(sort_order);

    -- League divisions
    CREATE TABLE IF NOT EXISTS league_divisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      UNIQUE(league_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_league_divisions_league_id ON league_divisions(league_id);
    CREATE INDEX IF NOT EXISTS idx_league_divisions_league_id_sort ON league_divisions(league_id, sort_order);

    -- League teams
    CREATE TABLE IF NOT EXISTS league_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      division_id INTEGER NOT NULL,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      FOREIGN KEY (division_id) REFERENCES league_divisions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_league_teams_league_id ON league_teams(league_id);
    CREATE INDEX IF NOT EXISTS idx_league_teams_division_id ON league_teams(division_id);

    -- Team members (rosters)
    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      is_skip INTEGER DEFAULT 0,
      is_vice INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES league_teams(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(team_id, member_id)
    );

    CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
    CREATE INDEX IF NOT EXISTS idx_team_members_member_id ON team_members(member_id);

    -- League member roles (league managers)
    CREATE TABLE IF NOT EXISTS league_member_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      league_id INTEGER,
      role TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      UNIQUE(member_id, league_id, role)
    );

    CREATE INDEX IF NOT EXISTS idx_league_member_roles_member_id ON league_member_roles(member_id);
    CREATE INDEX IF NOT EXISTS idx_league_member_roles_league_id ON league_member_roles(league_id);

    -- Member availability for leagues
    CREATE TABLE IF NOT EXISTS member_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      league_id INTEGER NOT NULL,
      available INTEGER DEFAULT 0,
      can_skip INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      UNIQUE(member_id, league_id)
    );

    CREATE INDEX IF NOT EXISTS idx_member_availability_member_id ON member_availability(member_id);
    CREATE INDEX IF NOT EXISTS idx_member_availability_league_id ON member_availability(league_id);

    -- Spare requests
    CREATE TABLE IF NOT EXISTS spare_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      league_id INTEGER,
      requested_for_name TEXT NOT NULL,
      requested_for_member_id INTEGER,
      game_date DATE NOT NULL,
      game_time TIME NOT NULL,
      position TEXT CHECK(position IN ('lead', 'second', 'vice', 'skip', NULL)),
      message TEXT,
      request_type TEXT NOT NULL CHECK(request_type IN ('public', 'private')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'filled', 'cancelled')),
      filled_by_member_id INTEGER,
      cancelled_by_member_id INTEGER,
      filled_at DATETIME,
      notification_generation INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (requester_id) REFERENCES members(id) ON DELETE CASCADE,
      FOREIGN KEY (requested_for_member_id) REFERENCES members(id) ON DELETE SET NULL,
      FOREIGN KEY (cancelled_by_member_id) REFERENCES members(id) ON DELETE SET NULL,
      FOREIGN KEY (filled_by_member_id) REFERENCES members(id) ON DELETE SET NULL,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_spare_requests_requester_id ON spare_requests(requester_id);
    CREATE INDEX IF NOT EXISTS idx_spare_requests_game_date ON spare_requests(game_date);
    CREATE INDEX IF NOT EXISTS idx_spare_requests_status ON spare_requests(status);

    -- Private spare request invitations
    CREATE TABLE IF NOT EXISTS spare_request_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spare_request_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      declined_at DATETIME,
      decline_comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (spare_request_id) REFERENCES spare_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(spare_request_id, member_id)
    );

    CREATE INDEX IF NOT EXISTS idx_spare_request_invitations_request_id ON spare_request_invitations(spare_request_id);
    CREATE INDEX IF NOT EXISTS idx_spare_request_invitations_member_id ON spare_request_invitations(member_id);

    -- Spare request CCs (up to 4 members can be CC'd on a request)
    CREATE TABLE IF NOT EXISTS spare_request_ccs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spare_request_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (spare_request_id) REFERENCES spare_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(spare_request_id, member_id)
    );

    CREATE INDEX IF NOT EXISTS idx_spare_request_ccs_request_id ON spare_request_ccs(spare_request_id);
    CREATE INDEX IF NOT EXISTS idx_spare_request_ccs_member_id ON spare_request_ccs(member_id);

    -- Responses to spare requests
    CREATE TABLE IF NOT EXISTS spare_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spare_request_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (spare_request_id) REFERENCES spare_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(spare_request_id, member_id)
    );

    CREATE INDEX IF NOT EXISTS idx_spare_responses_request_id ON spare_responses(spare_request_id);
    CREATE INDEX IF NOT EXISTS idx_spare_responses_member_id ON spare_responses(member_id);

    -- Server configuration table
    CREATE TABLE IF NOT EXISTS server_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      twilio_api_key_sid TEXT,
      twilio_api_key_secret TEXT,
      twilio_account_sid TEXT,
      twilio_campaign_sid TEXT,
      azure_connection_string TEXT,
      azure_sender_email TEXT,
      azure_sender_display_name TEXT,
      dashboard_alert_title TEXT,
      dashboard_alert_body TEXT,
      dashboard_alert_expires_at DATETIME,
      dashboard_alert_variant TEXT,
      dashboard_alert_icon TEXT,
      test_mode INTEGER DEFAULT 0,
      disable_email INTEGER DEFAULT 0,
      disable_sms INTEGER DEFAULT 0,
      frontend_otel_enabled INTEGER DEFAULT 1,
      capture_frontend_logs INTEGER DEFAULT 1,
      capture_backend_logs INTEGER DEFAULT 1,
      test_current_time DATETIME,
      notification_delay_seconds INTEGER DEFAULT 180,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Insert default row if it doesn't exist
    INSERT OR IGNORE INTO server_config (id) VALUES (1);
  `);

  // Ensure each league has a default division
  await execSQL(db, `
    INSERT INTO league_divisions (league_id, name, sort_order, is_default)
    SELECT l.id, 'Default', 0, 1
    FROM leagues l
    LEFT JOIN league_divisions d ON d.league_id = l.id
    WHERE d.id IS NULL;
  `);

  // Feedback table (support/admin visible)
  await execSQL(db, `
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL CHECK(category IN ('suggestion', 'problem', 'question', 'general')),
      body TEXT NOT NULL,
      email TEXT,
      member_id INTEGER,
      page_path TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_member_id ON feedback(member_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(category);
  `);

  // Observability events (best-effort analytics for server admins)
  await execSQL(db, `
    CREATE TABLE IF NOT EXISTS observability_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      member_id INTEGER,
      related_id INTEGER,
      meta TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_observability_events_created_at ON observability_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_observability_events_event_type ON observability_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_observability_events_member_id ON observability_events(member_id);

    CREATE TABLE IF NOT EXISTS daily_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_date TEXT NOT NULL,
      member_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(member_id, activity_date)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_activity_activity_date ON daily_activity(activity_date);
    CREATE INDEX IF NOT EXISTS idx_daily_activity_member_id ON daily_activity(member_id);
  `);

  // Migrations - try to add columns if they don't exist
  const migrations = [
    { sql: 'ALTER TABLE members ADD COLUMN email_visible INTEGER DEFAULT 0', table: 'members', column: 'email_visible' },
    { sql: 'ALTER TABLE members ADD COLUMN phone_visible INTEGER DEFAULT 0', table: 'members', column: 'phone_visible' },
    { sql: 'ALTER TABLE members ADD COLUMN is_server_admin INTEGER DEFAULT 0', table: 'members', column: 'is_server_admin' },
    { sql: 'ALTER TABLE members ADD COLUMN valid_through DATE', table: 'members', column: 'valid_through' },
    { sql: 'ALTER TABLE members ADD COLUMN spare_only INTEGER DEFAULT 0', table: 'members', column: 'spare_only' },
    { sql: 'ALTER TABLE server_config ADD COLUMN azure_sender_display_name TEXT', table: 'server_config', column: 'azure_sender_display_name' },
    { sql: 'ALTER TABLE server_config ADD COLUMN dashboard_alert_title TEXT', table: 'server_config', column: 'dashboard_alert_title' },
    { sql: 'ALTER TABLE server_config ADD COLUMN dashboard_alert_body TEXT', table: 'server_config', column: 'dashboard_alert_body' },
    { sql: 'ALTER TABLE server_config ADD COLUMN dashboard_alert_expires_at DATETIME', table: 'server_config', column: 'dashboard_alert_expires_at' },
    { sql: 'ALTER TABLE server_config ADD COLUMN dashboard_alert_variant TEXT', table: 'server_config', column: 'dashboard_alert_variant' },
    { sql: 'ALTER TABLE server_config ADD COLUMN dashboard_alert_icon TEXT', table: 'server_config', column: 'dashboard_alert_icon' },
    { sql: 'ALTER TABLE server_config ADD COLUMN twilio_account_sid TEXT', table: 'server_config', column: 'twilio_account_sid' },
    { sql: 'ALTER TABLE server_config ADD COLUMN twilio_campaign_sid TEXT', table: 'server_config', column: 'twilio_campaign_sid' },
    { sql: 'ALTER TABLE server_config ADD COLUMN test_mode INTEGER DEFAULT 0', table: 'server_config', column: 'test_mode' },
    { sql: 'ALTER TABLE server_config ADD COLUMN disable_email INTEGER DEFAULT 0', table: 'server_config', column: 'disable_email' },
    { sql: 'ALTER TABLE server_config ADD COLUMN disable_sms INTEGER DEFAULT 0', table: 'server_config', column: 'disable_sms' },
    { sql: 'ALTER TABLE server_config ADD COLUMN frontend_otel_enabled INTEGER DEFAULT 1', table: 'server_config', column: 'frontend_otel_enabled' },
    { sql: 'ALTER TABLE server_config ADD COLUMN capture_frontend_logs INTEGER DEFAULT 1', table: 'server_config', column: 'capture_frontend_logs' },
    { sql: 'ALTER TABLE server_config ADD COLUMN capture_backend_logs INTEGER DEFAULT 1', table: 'server_config', column: 'capture_backend_logs' },
    { sql: 'ALTER TABLE spare_requests ADD COLUMN notifications_sent_at DATETIME', table: 'spare_requests', column: 'notifications_sent_at' },
    { sql: 'ALTER TABLE spare_requests ADD COLUMN had_cancellation INTEGER DEFAULT 0', table: 'spare_requests', column: 'had_cancellation' },
    { sql: 'ALTER TABLE server_config ADD COLUMN test_current_time DATETIME', table: 'server_config', column: 'test_current_time' },
    { sql: 'ALTER TABLE server_config ADD COLUMN notification_delay_seconds INTEGER DEFAULT 180', table: 'server_config', column: 'notification_delay_seconds' },
    { sql: 'ALTER TABLE spare_requests ADD COLUMN notification_status TEXT DEFAULT NULL', table: 'spare_requests', column: 'notification_status' },
    { sql: 'ALTER TABLE spare_requests ADD COLUMN next_notification_at DATETIME', table: 'spare_requests', column: 'next_notification_at' },
    { sql: 'ALTER TABLE spare_requests ADD COLUMN notification_paused INTEGER DEFAULT 0', table: 'spare_requests', column: 'notification_paused' },
    { sql: 'ALTER TABLE members ADD COLUMN theme_preference TEXT DEFAULT \'system\'', table: 'members', column: 'theme_preference' },
    { sql: 'ALTER TABLE spare_requests ADD COLUMN league_id INTEGER', table: 'spare_requests', column: 'league_id' },
    { sql: 'ALTER TABLE spare_request_invitations ADD COLUMN declined_at DATETIME', table: 'spare_request_invitations', column: 'declined_at' },
    { sql: 'ALTER TABLE spare_request_invitations ADD COLUMN decline_comment TEXT', table: 'spare_request_invitations', column: 'decline_comment' },
    { sql: 'ALTER TABLE spare_requests ADD COLUMN all_invites_declined_notified INTEGER DEFAULT 0', table: 'spare_requests', column: 'all_invites_declined_notified' },
    { sql: 'ALTER TABLE spare_requests ADD COLUMN notification_generation INTEGER DEFAULT 0', table: 'spare_requests', column: 'notification_generation' },
  ];

  for (const migration of migrations) {
    try {
      await execSQL(db, migration.sql);
    } catch (e: unknown) {
      // Check if error is about column already existing
      const errorMsg = e instanceof Error ? e.message : '';
      if (!errorMsg.includes('duplicate') && !errorMsg.includes('already exists') && !errorMsg.includes('SQLITE_ERROR')) {
        // Re-throw if it's not a "column exists" error
        throw e;
      }
      // Otherwise ignore - column already exists
    }
  }

  // Indexes that depend on migrated columns (safe on existing DBs)
  try {
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_spare_requests_league_id ON spare_requests(league_id);');
  } catch (e: unknown) {
    // Ignore if DB doesn't support IF NOT EXISTS or column is missing for some reason
  }

  // Migrate existing admins to server admins
  try {
    // Convert existing admins (is_admin=1) to server admins (is_server_admin=1, is_admin=0)
    // This only runs once - check if any members have is_admin=1 and is_server_admin=0
    const checkStmt = db.prepare<{ count: number }>(
      "SELECT COUNT(*) as count FROM members WHERE is_admin = 1 AND (is_server_admin = 0 OR is_server_admin IS NULL)"
    );
    const result = await getPrepared(checkStmt);
    const count = Number(result?.count ?? 0);
    if (count > 0) {
      const migrateStmt = db.prepare('UPDATE members SET is_server_admin = 1, is_admin = 0 WHERE is_admin = 1 AND (is_server_admin = 0 OR is_server_admin IS NULL)');
      await runPrepared(migrateStmt);
      console.log(`Migrated ${count} existing admin(s) to server admin(s)`);
    }
  } catch (e) {
    // Ignore migration errors - column might not exist yet or already migrated
    console.log('Admin migration skipped (may already be complete)');
  }

  // Handle Twilio field migration (SQLite-specific, but safe to run on Postgres)
  try {
    // Check if old columns exist and migrate data
    const checkStmt = db.prepare<{
      twilio_account_sid?: string | null;
      twilio_api_key_sid?: string | null;
    }>("SELECT * FROM server_config WHERE id = 1");
    const configRow = await getPrepared(checkStmt);
    
    if (configRow) {
      // Check if we need to migrate twilio_account_sid to twilio_api_key_sid
      if (configRow.twilio_account_sid && !configRow.twilio_api_key_sid) {
        const updateStmt = db.prepare('UPDATE server_config SET twilio_api_key_sid = ? WHERE id = 1');
        await runPrepared(updateStmt, configRow.twilio_account_sid);
      }
      
      // Note: twilio_auth_token migration would need similar handling if it exists
    }
  } catch (e) {
    // Ignore migration errors
  }

  // Create notification queue table
  await execSQL(db, `
    CREATE TABLE IF NOT EXISTS spare_request_notification_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spare_request_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      queue_order INTEGER NOT NULL,
      claimed_at DATETIME,
      notified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (spare_request_id) REFERENCES spare_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(spare_request_id, member_id)
    );

    CREATE INDEX IF NOT EXISTS idx_notification_queue_request_id ON spare_request_notification_queue(spare_request_id);
    CREATE INDEX IF NOT EXISTS idx_notification_queue_order ON spare_request_notification_queue(spare_request_id, queue_order);
    CREATE INDEX IF NOT EXISTS idx_notification_queue_notified ON spare_request_notification_queue(spare_request_id, notified_at);
  `);

  // Migrate notification queue table (add claimed_at if missing)
  try {
    await execSQL(db, 'ALTER TABLE spare_request_notification_queue ADD COLUMN claimed_at DATETIME');
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : '';
    if (!errorMsg.includes('duplicate') && !errorMsg.includes('already exists') && !errorMsg.includes('SQLITE_ERROR')) {
      throw e;
    }
  }

  // Index for claimed_at (after the column exists)
  try {
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_notification_queue_claimed ON spare_request_notification_queue(spare_request_id, claimed_at);');
  } catch (e: unknown) {
    // Ignore if DB doesn't support IF NOT EXISTS or column is missing for some reason
  }

  // Idempotency log for spare-request deliveries (email/SMS) per notification generation
  await execSQL(db, `
    CREATE TABLE IF NOT EXISTS spare_request_notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spare_request_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      notification_generation INTEGER NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('email', 'sms')),
      kind TEXT NOT NULL,
      claimed_at DATETIME,
      sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (spare_request_id) REFERENCES spare_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(spare_request_id, member_id, notification_generation, channel, kind)
    );

    CREATE INDEX IF NOT EXISTS idx_spare_request_notification_deliveries_req ON spare_request_notification_deliveries(spare_request_id);
    CREATE INDEX IF NOT EXISTS idx_spare_request_notification_deliveries_member ON spare_request_notification_deliveries(member_id);
    CREATE INDEX IF NOT EXISTS idx_spare_request_notification_deliveries_claimed ON spare_request_notification_deliveries(spare_request_id, claimed_at);
    CREATE INDEX IF NOT EXISTS idx_spare_request_notification_deliveries_sent ON spare_request_notification_deliveries(spare_request_id, sent_at);
  `);

  await ensureRequestedForMemberIdColumn(db);
}

// Synchronous version for SQLite (when we know it's SQLite)
export function createSchemaSync(db: DatabaseAdapter): void {
  if (db.isAsync()) {
    throw new Error('createSchemaSync called on async database. Use createSchema instead.');
  }
  
  // Execute all SQL synchronously
  execSQLSync(db, `
    -- Members table
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      valid_through DATE,
      spare_only INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      is_server_admin INTEGER DEFAULT 0,
      opted_in_sms INTEGER DEFAULT 0,
      email_subscribed INTEGER DEFAULT 1,
      first_login_completed INTEGER DEFAULT 0,
      email_visible INTEGER DEFAULT 0,
      phone_visible INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
    CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);

    -- Auth codes table (for login)
    CREATE TABLE IF NOT EXISTS auth_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_auth_codes_contact ON auth_codes(contact);
    CREATE INDEX IF NOT EXISTS idx_auth_codes_code ON auth_codes(code);

    -- Auth tokens table (long-lasting authorization)
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_member_id ON auth_tokens(member_id);

    -- Leagues table
    CREATE TABLE IF NOT EXISTS leagues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      format TEXT NOT NULL CHECK(format IN ('teams', 'doubles')),
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- League draw times
    CREATE TABLE IF NOT EXISTS league_draw_times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      draw_time TIME NOT NULL,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_league_draw_times_league_id ON league_draw_times(league_id);

    -- League exceptions (dates when a league does NOT run)
    CREATE TABLE IF NOT EXISTS league_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      exception_date DATE NOT NULL,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      UNIQUE(league_id, exception_date)
    );

    CREATE INDEX IF NOT EXISTS idx_league_exceptions_league_id ON league_exceptions(league_id);

    -- Member availability for leagues
    CREATE TABLE IF NOT EXISTS member_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      league_id INTEGER NOT NULL,
      available INTEGER DEFAULT 0,
      can_skip INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      UNIQUE(member_id, league_id)
    );

    CREATE INDEX IF NOT EXISTS idx_member_availability_member_id ON member_availability(member_id);
    CREATE INDEX IF NOT EXISTS idx_member_availability_league_id ON member_availability(league_id);

    -- Spare requests
    CREATE TABLE IF NOT EXISTS spare_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      league_id INTEGER,
      requested_for_name TEXT NOT NULL,
      requested_for_member_id INTEGER,
      game_date DATE NOT NULL,
      game_time TIME NOT NULL,
      position TEXT CHECK(position IN ('lead', 'second', 'vice', 'skip', NULL)),
      message TEXT,
      request_type TEXT NOT NULL CHECK(request_type IN ('public', 'private')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'filled', 'cancelled')),
      filled_by_member_id INTEGER,
      cancelled_by_member_id INTEGER,
      filled_at DATETIME,
      notification_generation INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (requester_id) REFERENCES members(id) ON DELETE CASCADE,
      FOREIGN KEY (requested_for_member_id) REFERENCES members(id) ON DELETE SET NULL,
      FOREIGN KEY (cancelled_by_member_id) REFERENCES members(id) ON DELETE SET NULL,
      FOREIGN KEY (filled_by_member_id) REFERENCES members(id) ON DELETE SET NULL,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_spare_requests_requester_id ON spare_requests(requester_id);
    CREATE INDEX IF NOT EXISTS idx_spare_requests_game_date ON spare_requests(game_date);
    CREATE INDEX IF NOT EXISTS idx_spare_requests_status ON spare_requests(status);

    -- Private spare request invitations
    CREATE TABLE IF NOT EXISTS spare_request_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spare_request_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      declined_at DATETIME,
      decline_comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (spare_request_id) REFERENCES spare_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(spare_request_id, member_id)
    );

    CREATE INDEX IF NOT EXISTS idx_spare_request_invitations_request_id ON spare_request_invitations(spare_request_id);
    CREATE INDEX IF NOT EXISTS idx_spare_request_invitations_member_id ON spare_request_invitations(member_id);

    -- Spare request CCs (up to 4 members can be CC'd on a request)
    CREATE TABLE IF NOT EXISTS spare_request_ccs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spare_request_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (spare_request_id) REFERENCES spare_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(spare_request_id, member_id)
    );

    CREATE INDEX IF NOT EXISTS idx_spare_request_ccs_request_id ON spare_request_ccs(spare_request_id);
    CREATE INDEX IF NOT EXISTS idx_spare_request_ccs_member_id ON spare_request_ccs(member_id);

    -- Responses to spare requests
    CREATE TABLE IF NOT EXISTS spare_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spare_request_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (spare_request_id) REFERENCES spare_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(spare_request_id, member_id)
    );

    CREATE INDEX IF NOT EXISTS idx_spare_responses_request_id ON spare_responses(spare_request_id);
    CREATE INDEX IF NOT EXISTS idx_spare_responses_member_id ON spare_responses(member_id);

    -- Server configuration table
    CREATE TABLE IF NOT EXISTS server_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      twilio_api_key_sid TEXT,
      twilio_api_key_secret TEXT,
      twilio_account_sid TEXT,
      twilio_campaign_sid TEXT,
      azure_connection_string TEXT,
      azure_sender_email TEXT,
      azure_sender_display_name TEXT,
      dashboard_alert_title TEXT,
      dashboard_alert_body TEXT,
      dashboard_alert_expires_at DATETIME,
      dashboard_alert_variant TEXT,
      dashboard_alert_icon TEXT,
      test_mode INTEGER DEFAULT 0,
      disable_email INTEGER DEFAULT 0,
      disable_sms INTEGER DEFAULT 0,
      frontend_otel_enabled INTEGER DEFAULT 1,
      test_current_time DATETIME,
      notification_delay_seconds INTEGER DEFAULT 180,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Insert default row if it doesn't exist
    INSERT OR IGNORE INTO server_config (id) VALUES (1);
  `);

  // Feedback table (support/admin visible)
  execSQLSync(db, `
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL CHECK(category IN ('suggestion', 'problem', 'question', 'general')),
      body TEXT NOT NULL,
      email TEXT,
      member_id INTEGER,
      page_path TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_member_id ON feedback(member_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(category);
  `);

  // Observability events (best-effort analytics for server admins)
  execSQLSync(db, `
    CREATE TABLE IF NOT EXISTS observability_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      member_id INTEGER,
      related_id INTEGER,
      meta TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_observability_events_created_at ON observability_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_observability_events_event_type ON observability_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_observability_events_member_id ON observability_events(member_id);

    CREATE TABLE IF NOT EXISTS daily_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_date TEXT NOT NULL,
      member_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(member_id, activity_date)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_activity_activity_date ON daily_activity(activity_date);
    CREATE INDEX IF NOT EXISTS idx_daily_activity_member_id ON daily_activity(member_id);
  `);

  // Migrations - try to add columns if they don't exist
  const migrations = [
    'ALTER TABLE members ADD COLUMN email_visible INTEGER DEFAULT 0',
    'ALTER TABLE members ADD COLUMN phone_visible INTEGER DEFAULT 0',
    'ALTER TABLE members ADD COLUMN is_server_admin INTEGER DEFAULT 0',
    'ALTER TABLE members ADD COLUMN valid_through DATE',
    'ALTER TABLE members ADD COLUMN spare_only INTEGER DEFAULT 0',
    'ALTER TABLE server_config ADD COLUMN azure_sender_display_name TEXT',
    'ALTER TABLE server_config ADD COLUMN dashboard_alert_title TEXT',
    'ALTER TABLE server_config ADD COLUMN dashboard_alert_body TEXT',
    'ALTER TABLE server_config ADD COLUMN dashboard_alert_expires_at DATETIME',
    'ALTER TABLE server_config ADD COLUMN dashboard_alert_variant TEXT',
    'ALTER TABLE server_config ADD COLUMN dashboard_alert_icon TEXT',
    'ALTER TABLE server_config ADD COLUMN twilio_account_sid TEXT',
    'ALTER TABLE server_config ADD COLUMN twilio_campaign_sid TEXT',
    'ALTER TABLE server_config ADD COLUMN test_mode INTEGER DEFAULT 0',
    'ALTER TABLE server_config ADD COLUMN disable_email INTEGER DEFAULT 0',
    'ALTER TABLE server_config ADD COLUMN disable_sms INTEGER DEFAULT 0',
    'ALTER TABLE server_config ADD COLUMN frontend_otel_enabled INTEGER DEFAULT 1',
    'ALTER TABLE spare_requests ADD COLUMN notifications_sent_at DATETIME',
    'ALTER TABLE spare_requests ADD COLUMN had_cancellation INTEGER DEFAULT 0',
    'ALTER TABLE server_config ADD COLUMN test_current_time DATETIME',
    'ALTER TABLE server_config ADD COLUMN notification_delay_seconds INTEGER DEFAULT 180',
    'ALTER TABLE spare_requests ADD COLUMN notification_status TEXT DEFAULT NULL',
    'ALTER TABLE spare_requests ADD COLUMN next_notification_at DATETIME',
    'ALTER TABLE spare_requests ADD COLUMN notification_paused INTEGER DEFAULT 0',
    'ALTER TABLE members ADD COLUMN theme_preference TEXT DEFAULT \'system\'',
    'ALTER TABLE spare_requests ADD COLUMN league_id INTEGER',
    'ALTER TABLE spare_request_invitations ADD COLUMN declined_at DATETIME',
    'ALTER TABLE spare_request_invitations ADD COLUMN decline_comment TEXT',
    'ALTER TABLE spare_requests ADD COLUMN all_invites_declined_notified INTEGER DEFAULT 0',
    'ALTER TABLE spare_requests ADD COLUMN notification_generation INTEGER DEFAULT 0',
  ];

  for (const migrationSQL of migrations) {
    try {
      execSQLSync(db, migrationSQL);
    } catch (e: unknown) {
      // Ignore "column already exists" errors
      const errorMsg = e instanceof Error ? e.message : '';
      if (!errorMsg.includes('duplicate') && !errorMsg.includes('already exists') && !errorMsg.includes('SQLITE_ERROR')) {
        // Re-throw if it's not a "column exists" error
        throw e;
      }
    }
  }

  // Indexes that depend on migrated columns (safe on existing DBs)
  try {
    execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_spare_requests_league_id ON spare_requests(league_id);');
  } catch {
    // ignore
  }

  // Create notification queue table
  execSQLSync(db, `
    CREATE TABLE IF NOT EXISTS spare_request_notification_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spare_request_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      queue_order INTEGER NOT NULL,
      claimed_at DATETIME,
      notified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (spare_request_id) REFERENCES spare_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(spare_request_id, member_id)
    );

    CREATE INDEX IF NOT EXISTS idx_notification_queue_request_id ON spare_request_notification_queue(spare_request_id);
    CREATE INDEX IF NOT EXISTS idx_notification_queue_order ON spare_request_notification_queue(spare_request_id, queue_order);
    CREATE INDEX IF NOT EXISTS idx_notification_queue_notified ON spare_request_notification_queue(spare_request_id, notified_at);
  `);

  // Migrate notification queue table (add claimed_at if missing) - sync
  try {
    execSQLSync(db, 'ALTER TABLE spare_request_notification_queue ADD COLUMN claimed_at DATETIME');
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : '';
    if (!errorMsg.includes('duplicate') && !errorMsg.includes('already exists') && !errorMsg.includes('SQLITE_ERROR')) {
      throw e;
    }
  }

  // Index for claimed_at (after the column exists)
  try {
    execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_notification_queue_claimed ON spare_request_notification_queue(spare_request_id, claimed_at);');
  } catch {
    // ignore
  }

  // Idempotency log for spare-request deliveries (email/SMS) per notification generation
  execSQLSync(db, `
    CREATE TABLE IF NOT EXISTS spare_request_notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spare_request_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      notification_generation INTEGER NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('email', 'sms')),
      kind TEXT NOT NULL,
      claimed_at DATETIME,
      sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (spare_request_id) REFERENCES spare_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(spare_request_id, member_id, notification_generation, channel, kind)
    );

    CREATE INDEX IF NOT EXISTS idx_spare_request_notification_deliveries_req ON spare_request_notification_deliveries(spare_request_id);
    CREATE INDEX IF NOT EXISTS idx_spare_request_notification_deliveries_member ON spare_request_notification_deliveries(member_id);
    CREATE INDEX IF NOT EXISTS idx_spare_request_notification_deliveries_claimed ON spare_request_notification_deliveries(spare_request_id, claimed_at);
    CREATE INDEX IF NOT EXISTS idx_spare_request_notification_deliveries_sent ON spare_request_notification_deliveries(spare_request_id, sent_at);
  `);

  ensureRequestedForMemberIdColumnSync(db);

  // Migrate existing admins to server admins (sync version)
  try {
    // Convert existing admins (is_admin=1) to server admins (is_server_admin=1, is_admin=0)
    const checkStmt = db.prepare<{ count: number }>(
      "SELECT COUNT(*) as count FROM members WHERE is_admin = 1 AND (is_server_admin = 0 OR is_server_admin IS NULL)"
    );
    const result = checkStmt.get() as { count?: number } | undefined;
    const count = Number(result?.count ?? 0);
    if (count > 0) {
      const migrateStmt = db.prepare('UPDATE members SET is_server_admin = 1, is_admin = 0 WHERE is_admin = 1 AND (is_server_admin = 0 OR is_server_admin IS NULL)');
      migrateStmt.run();
      console.log(`Migrated ${count} existing admin(s) to server admin(s)`);
    }
  } catch (e) {
    // Ignore migration errors - column might not exist yet or already migrated
    console.log('Admin migration skipped (may already be complete)');
  }
}
