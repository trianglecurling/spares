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

async function ensureGameIdColumn(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    const stmt = db.prepare<{ column_name?: string | null }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'spare_requests'
    `);
    const rows = await allPrepared<{ column_name?: string | null }>(stmt);
    const columnNames = new Set(rows.map((row) => String(row.column_name)));
    if (!columnNames.has('game_id')) {
      await execSQL(
        db,
        `
          ALTER TABLE spare_requests
          ADD COLUMN IF NOT EXISTS game_id INTEGER REFERENCES games(id) ON DELETE SET NULL;
        `
      );
    }
    await execSQL(
      db,
      `
        CREATE INDEX IF NOT EXISTS idx_spare_requests_game_id
        ON spare_requests(game_id);
      `
    );
    return;
  }

  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(spare_requests)`);
  const columns = await allPrepared<{ name?: string | null }>(stmt);
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('game_id')) {
    await execSQL(
      db,
      `
        ALTER TABLE spare_requests
        ADD COLUMN game_id INTEGER REFERENCES games(id) ON DELETE SET NULL;
      `
    );
  }
  await execSQL(
    db,
    `
      CREATE INDEX IF NOT EXISTS idx_spare_requests_game_id
      ON spare_requests(game_id);
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

function ensureGameIdColumnSync(db: DatabaseAdapter): void {
  const stmt = db.prepare(`PRAGMA table_info(spare_requests)`);
  const columns = stmt.all() as { name?: string }[];
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('game_id')) {
    execSQLSync(
      db,
      `
        ALTER TABLE spare_requests
        ADD COLUMN game_id INTEGER REFERENCES games(id) ON DELETE SET NULL;
      `
    );
  }
  execSQLSync(
    db,
    `
      CREATE INDEX IF NOT EXISTS idx_spare_requests_game_id
      ON spare_requests(game_id);
    `
  );
}

async function ensurePaymentDomainTables(db: DatabaseAdapter): Promise<void> {
  await execSQL(
    db,
    `
      CREATE TABLE IF NOT EXISTS payment_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_token TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL CHECK(provider IN ('stripe', 'paypal', 'square')),
        subject_type TEXT NOT NULL CHECK(subject_type IN ('donation', 'membership', 'event_registration')),
        subject_id INTEGER,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created', 'pending', 'succeeded', 'failed', 'refunded', 'partially_refunded')),
        status_reason TEXT,
        provider_order_id TEXT,
        metadata TEXT,
        created_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
      CREATE INDEX IF NOT EXISTS idx_payment_orders_subject ON payment_orders(subject_type, subject_id);
      CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_provider_order_id_unique ON payment_orders(provider, provider_order_id);

      CREATE TABLE IF NOT EXISTS payment_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_order_id INTEGER NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('stripe', 'paypal', 'square')),
        provider_transaction_id TEXT NOT NULL,
        transaction_type TEXT NOT NULL CHECK(transaction_type IN ('charge', 'capture', 'refund', 'adjustment')),
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        fee_minor INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('created', 'pending', 'succeeded', 'failed', 'refunded', 'partially_refunded')),
        occurred_at DATETIME,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_payment_transactions_order_id ON payment_transactions(payment_order_id);
      CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status);
      CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_transaction_id_unique
        ON payment_transactions(provider, provider_transaction_id);

      CREATE TABLE IF NOT EXISTS payment_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL CHECK(provider IN ('stripe', 'paypal', 'square')),
        provider_event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payment_order_id INTEGER REFERENCES payment_orders(id) ON DELETE SET NULL,
        processing_status TEXT NOT NULL DEFAULT 'received' CHECK(processing_status IN ('received', 'processed', 'ignored', 'failed')),
        processing_error TEXT,
        raw_payload TEXT NOT NULL,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME
      );
      CREATE UNIQUE INDEX IF NOT EXISTS payment_events_provider_event_unique
        ON payment_events(provider, provider_event_id);
      CREATE INDEX IF NOT EXISTS idx_payment_events_order_id ON payment_events(payment_order_id);
      CREATE INDEX IF NOT EXISTS idx_payment_events_processing_status ON payment_events(processing_status);

      CREATE TABLE IF NOT EXISTS refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_order_id INTEGER NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
        payment_transaction_id INTEGER REFERENCES payment_transactions(id) ON DELETE SET NULL,
        provider TEXT NOT NULL CHECK(provider IN ('stripe', 'paypal', 'square')),
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested', 'approved', 'rejected', 'processing', 'succeeded', 'failed')),
        requested_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        approved_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        provider_refund_id TEXT,
        provider_response TEXT,
        processed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds(payment_order_id);
      CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);
      CREATE UNIQUE INDEX IF NOT EXISTS refunds_provider_refund_id_unique ON refunds(provider, provider_refund_id);
    `
  );
}

function ensurePaymentDomainTablesSync(db: DatabaseAdapter): void {
  execSQLSync(
    db,
    `
      CREATE TABLE IF NOT EXISTS payment_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_token TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL CHECK(provider IN ('stripe', 'paypal', 'square')),
        subject_type TEXT NOT NULL CHECK(subject_type IN ('donation', 'membership', 'event_registration')),
        subject_id INTEGER,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created', 'pending', 'succeeded', 'failed', 'refunded', 'partially_refunded')),
        status_reason TEXT,
        provider_order_id TEXT,
        metadata TEXT,
        created_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
      CREATE INDEX IF NOT EXISTS idx_payment_orders_subject ON payment_orders(subject_type, subject_id);
      CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_provider_order_id_unique ON payment_orders(provider, provider_order_id);

      CREATE TABLE IF NOT EXISTS payment_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_order_id INTEGER NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('stripe', 'paypal', 'square')),
        provider_transaction_id TEXT NOT NULL,
        transaction_type TEXT NOT NULL CHECK(transaction_type IN ('charge', 'capture', 'refund', 'adjustment')),
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        fee_minor INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('created', 'pending', 'succeeded', 'failed', 'refunded', 'partially_refunded')),
        occurred_at DATETIME,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_payment_transactions_order_id ON payment_transactions(payment_order_id);
      CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status);
      CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_transaction_id_unique
        ON payment_transactions(provider, provider_transaction_id);

      CREATE TABLE IF NOT EXISTS payment_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL CHECK(provider IN ('stripe', 'paypal', 'square')),
        provider_event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payment_order_id INTEGER REFERENCES payment_orders(id) ON DELETE SET NULL,
        processing_status TEXT NOT NULL DEFAULT 'received' CHECK(processing_status IN ('received', 'processed', 'ignored', 'failed')),
        processing_error TEXT,
        raw_payload TEXT NOT NULL,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME
      );
      CREATE UNIQUE INDEX IF NOT EXISTS payment_events_provider_event_unique
        ON payment_events(provider, provider_event_id);
      CREATE INDEX IF NOT EXISTS idx_payment_events_order_id ON payment_events(payment_order_id);
      CREATE INDEX IF NOT EXISTS idx_payment_events_processing_status ON payment_events(processing_status);

      CREATE TABLE IF NOT EXISTS refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_order_id INTEGER NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
        payment_transaction_id INTEGER REFERENCES payment_transactions(id) ON DELETE SET NULL,
        provider TEXT NOT NULL CHECK(provider IN ('stripe', 'paypal', 'square')),
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested', 'approved', 'rejected', 'processing', 'succeeded', 'failed')),
        requested_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        approved_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        provider_refund_id TEXT,
        provider_response TEXT,
        processed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds(payment_order_id);
      CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);
      CREATE UNIQUE INDEX IF NOT EXISTS refunds_provider_refund_id_unique ON refunds(provider, provider_refund_id);
    `
  );
}

async function ensureEventsTables(db: DatabaseAdapter): Promise<void> {
  const eventsSQL = `
    CREATE TABLE IF NOT EXISTS event_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
      image_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'active_members', 'ice_members')),
      published INTEGER NOT NULL DEFAULT 0,
      capacity INTEGER,
      fee_minor INTEGER NOT NULL DEFAULT 0,
      member_fee_minor INTEGER,
      currency TEXT NOT NULL DEFAULT 'usd',
      registration_start DATETIME,
      registration_cutoff DATETIME,
      cancellation_cutoff DATETIME,
      allow_group_registration INTEGER NOT NULL DEFAULT 0,
      max_group_size INTEGER,
      enable_waitlist INTEGER NOT NULL DEFAULT 1,
      terms_article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
      created_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_events_published ON events(published);
    CREATE INDEX IF NOT EXISTS idx_events_visibility ON events(visibility);

    CREATE TABLE IF NOT EXISTS event_timespans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      start_dt TEXT NOT NULL,
      end_dt TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_event_timespans_event_id ON event_timespans(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_timespans_start_dt ON event_timespans(start_dt);

    CREATE TABLE IF NOT EXISTS event_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      location_type TEXT NOT NULL CHECK(location_type IN ('sheet', 'warm-room', 'exterior', 'offsite', 'virtual')),
      sheet_id INTEGER REFERENCES sheets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_event_locations_event_id ON event_locations(event_id);

    CREATE TABLE IF NOT EXISTS event_category_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES event_categories(id) ON DELETE CASCADE,
      UNIQUE(event_id, category_id)
    );
    CREATE INDEX IF NOT EXISTS idx_event_category_assignments_event_id ON event_category_assignments(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_category_assignments_category_id ON event_category_assignments(category_id);

    CREATE TABLE IF NOT EXISTS event_owners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, member_id)
    );
    CREATE INDEX IF NOT EXISTS idx_event_owners_event_id ON event_owners(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_owners_member_id ON event_owners(member_id);

    CREATE TABLE IF NOT EXISTS event_registration_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      field_type TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'group' CHECK(scope IN ('group', 'individual')),
      required INTEGER NOT NULL DEFAULT 0,
      options TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_event_registration_fields_event_id ON event_registration_fields(event_id);

    CREATE TABLE IF NOT EXISTS event_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      contact_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_payment' CHECK(status IN ('confirmed', 'pending_payment', 'waitlisted', 'cancelled')),
      group_size INTEGER NOT NULL DEFAULT 1,
      payment_order_id INTEGER,
      special_link_id INTEGER,
      waitlist_position INTEGER,
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      cancelled_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_event_registrations_event_id ON event_registrations(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_registrations_member_id ON event_registrations(member_id);
    CREATE INDEX IF NOT EXISTS idx_event_registrations_status ON event_registrations(status);

    CREATE TABLE IF NOT EXISTS event_registration_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_event_registration_members_registration_id ON event_registration_members(registration_id);

    CREATE TABLE IF NOT EXISTS event_registration_field_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
      field_id INTEGER NOT NULL REFERENCES event_registration_fields(id) ON DELETE CASCADE,
      registration_member_id INTEGER REFERENCES event_registration_members(id) ON DELETE CASCADE,
      value TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_event_reg_field_values_registration_id ON event_registration_field_values(registration_id);
    CREATE INDEX IF NOT EXISTS idx_event_reg_field_values_field_id ON event_registration_field_values(field_id);

    CREATE TABLE IF NOT EXISTS event_special_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      label TEXT,
      override_fee_minor INTEGER,
      max_group_size INTEGER,
      bypass_capacity INTEGER NOT NULL DEFAULT 0,
      ignore_registration_dates INTEGER NOT NULL DEFAULT 0,
      used INTEGER NOT NULL DEFAULT 0,
      invalidated INTEGER NOT NULL DEFAULT 0,
      used_by_registration_id INTEGER REFERENCES event_registrations(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_event_special_links_event_id ON event_special_links(event_id);
  `;

  if (db.isAsync()) {
    const pgSQL = eventsSQL
      .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
      .replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/g, 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP')
      .replace(/DATETIME/g, 'TIMESTAMP');
    await execSQL(db, pgSQL);
    await ensureSpecialLinksMaxGroupSizeColumn(db);
    await ensureEventRegistrationFieldTypesUnconstrained(db);
    return;
  }

  await execSQL(db, eventsSQL);
  await ensureSpecialLinksMaxGroupSizeColumn(db);
  await ensureEventRegistrationFieldTypesUnconstrained(db);
}

async function ensureSpecialLinksMaxGroupSizeColumn(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    const stmt = db.prepare<{ column_name?: string | null }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'event_special_links'
    `);
    const rows = await allPrepared<{ column_name?: string | null }>(stmt);
    const columnNames = new Set(rows.map((row) => String(row.column_name)));
    if (!columnNames.has('max_group_size')) {
      await execSQL(db, `ALTER TABLE event_special_links ADD COLUMN IF NOT EXISTS max_group_size INTEGER;`);
    }
  } else {
    const stmt = db.prepare(`PRAGMA table_info(event_special_links)`);
    const columns = stmt.all() as { name?: string }[];
    const columnNames = new Set(columns.map((col) => String(col.name)));
    if (!columnNames.has('max_group_size')) {
      await execSQL(db, `ALTER TABLE event_special_links ADD COLUMN max_group_size INTEGER;`);
    }
  }
}

async function ensureEventRegistrationFieldTypesUnconstrained(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    await execSQL(
      db,
      `
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN
          SELECT c.conname
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname = 'event_registration_fields'
            AND c.contype = 'c'
            AND pg_get_constraintdef(c.oid) LIKE '%field_type%'
        LOOP
          EXECUTE format('ALTER TABLE event_registration_fields DROP CONSTRAINT IF EXISTS %I', r.conname);
        END LOOP;
      END $$;
    `
    );
    return;
  }
  const stmt = db.prepare<{ sql?: string | null }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='event_registration_fields'`
  );
  const row = stmt.get() as { sql?: string | null } | undefined;
  if (!row?.sql || !String(row.sql).includes('CHECK(field_type IN (')) {
    return;
  }
  await execSQL(db, `BEGIN IMMEDIATE`);
  try {
    await execSQL(
      db,
      `
      CREATE TABLE event_registration_fields_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        field_type TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'group' CHECK(scope IN ('group', 'individual')),
        required INTEGER NOT NULL DEFAULT 0,
        options TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
    `
    );
    await execSQL(db, `INSERT INTO event_registration_fields_new SELECT * FROM event_registration_fields;`);
    await execSQL(db, `DROP TABLE event_registration_fields;`);
    await execSQL(db, `ALTER TABLE event_registration_fields_new RENAME TO event_registration_fields;`);
    await execSQL(
      db,
      `CREATE INDEX IF NOT EXISTS idx_event_registration_fields_event_id ON event_registration_fields(event_id);`
    );
    await execSQL(db, `COMMIT`);
  } catch (err) {
    await execSQL(db, `ROLLBACK`);
    throw err;
  }
}

function ensureEventsTablesSync(db: DatabaseAdapter): void {
  execSQLSync(
    db,
    `
    CREATE TABLE IF NOT EXISTS event_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
      image_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'active_members', 'ice_members')),
      published INTEGER NOT NULL DEFAULT 0,
      capacity INTEGER,
      fee_minor INTEGER NOT NULL DEFAULT 0,
      member_fee_minor INTEGER,
      currency TEXT NOT NULL DEFAULT 'usd',
      registration_start DATETIME,
      registration_cutoff DATETIME,
      cancellation_cutoff DATETIME,
      allow_group_registration INTEGER NOT NULL DEFAULT 0,
      max_group_size INTEGER,
      enable_waitlist INTEGER NOT NULL DEFAULT 1,
      terms_article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
      created_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_events_published ON events(published);
    CREATE INDEX IF NOT EXISTS idx_events_visibility ON events(visibility);

    CREATE TABLE IF NOT EXISTS event_timespans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      start_dt TEXT NOT NULL,
      end_dt TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_event_timespans_event_id ON event_timespans(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_timespans_start_dt ON event_timespans(start_dt);

    CREATE TABLE IF NOT EXISTS event_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      location_type TEXT NOT NULL CHECK(location_type IN ('sheet', 'warm-room', 'exterior', 'offsite', 'virtual')),
      sheet_id INTEGER REFERENCES sheets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_event_locations_event_id ON event_locations(event_id);

    CREATE TABLE IF NOT EXISTS event_category_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES event_categories(id) ON DELETE CASCADE,
      UNIQUE(event_id, category_id)
    );
    CREATE INDEX IF NOT EXISTS idx_event_category_assignments_event_id ON event_category_assignments(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_category_assignments_category_id ON event_category_assignments(category_id);

    CREATE TABLE IF NOT EXISTS event_owners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, member_id)
    );
    CREATE INDEX IF NOT EXISTS idx_event_owners_event_id ON event_owners(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_owners_member_id ON event_owners(member_id);

    CREATE TABLE IF NOT EXISTS event_registration_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      field_type TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'group' CHECK(scope IN ('group', 'individual')),
      required INTEGER NOT NULL DEFAULT 0,
      options TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_event_registration_fields_event_id ON event_registration_fields(event_id);

    CREATE TABLE IF NOT EXISTS event_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      contact_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_payment' CHECK(status IN ('confirmed', 'pending_payment', 'waitlisted', 'cancelled')),
      group_size INTEGER NOT NULL DEFAULT 1,
      payment_order_id INTEGER,
      special_link_id INTEGER,
      waitlist_position INTEGER,
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      cancelled_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_event_registrations_event_id ON event_registrations(event_id);
    CREATE INDEX IF NOT EXISTS idx_event_registrations_member_id ON event_registrations(member_id);
    CREATE INDEX IF NOT EXISTS idx_event_registrations_status ON event_registrations(status);

    CREATE TABLE IF NOT EXISTS event_registration_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_event_registration_members_registration_id ON event_registration_members(registration_id);

    CREATE TABLE IF NOT EXISTS event_registration_field_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
      field_id INTEGER NOT NULL REFERENCES event_registration_fields(id) ON DELETE CASCADE,
      registration_member_id INTEGER REFERENCES event_registration_members(id) ON DELETE CASCADE,
      value TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_event_reg_field_values_registration_id ON event_registration_field_values(registration_id);
    CREATE INDEX IF NOT EXISTS idx_event_reg_field_values_field_id ON event_registration_field_values(field_id);

    CREATE TABLE IF NOT EXISTS event_special_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      label TEXT,
      override_fee_minor INTEGER,
      max_group_size INTEGER,
      bypass_capacity INTEGER NOT NULL DEFAULT 0,
      ignore_registration_dates INTEGER NOT NULL DEFAULT 0,
      used INTEGER NOT NULL DEFAULT 0,
      invalidated INTEGER NOT NULL DEFAULT 0,
      used_by_registration_id INTEGER REFERENCES event_registrations(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_event_special_links_event_id ON event_special_links(event_id);
    `
  );
  ensureSpecialLinksMaxGroupSizeColumnSync(db);
  ensureEventRegistrationFieldTypesUnconstrainedSync(db);
}

function ensureSpecialLinksMaxGroupSizeColumnSync(db: DatabaseAdapter): void {
  const stmt = db.prepare(`PRAGMA table_info(event_special_links)`);
  const columns = stmt.all() as { name?: string }[];
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('max_group_size')) {
    execSQLSync(db, `ALTER TABLE event_special_links ADD COLUMN max_group_size INTEGER;`);
  }
}

function ensureEventRegistrationFieldTypesUnconstrainedSync(db: DatabaseAdapter): void {
  const stmt = db.prepare<{ sql?: string | null }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='event_registration_fields'`
  );
  const row = stmt.get() as { sql?: string | null } | undefined;
  if (!row?.sql || !String(row.sql).includes('CHECK(field_type IN (')) {
    return;
  }
  execSQLSync(db, `BEGIN IMMEDIATE`);
  try {
    execSQLSync(
      db,
      `
      CREATE TABLE event_registration_fields_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        field_type TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'group' CHECK(scope IN ('group', 'individual')),
        required INTEGER NOT NULL DEFAULT 0,
        options TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
    `
    );
    execSQLSync(db, `INSERT INTO event_registration_fields_new SELECT * FROM event_registration_fields;`);
    execSQLSync(db, `DROP TABLE event_registration_fields;`);
    execSQLSync(db, `ALTER TABLE event_registration_fields_new RENAME TO event_registration_fields;`);
    execSQLSync(
      db,
      `CREATE INDEX IF NOT EXISTS idx_event_registration_fields_event_id ON event_registration_fields(event_id);`
    );
    execSQLSync(db, `COMMIT`);
  } catch (err) {
    execSQLSync(db, `ROLLBACK`);
    throw err;
  }
}

async function ensureMenuItemsArticleColumns(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    // PostgreSQL: use IF NOT EXISTS for idempotent migration
    await execSQL(db, 'ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL');
    await execSQL(db, 'ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS use_article_title_for_label INTEGER DEFAULT 0 NOT NULL');
    await execSQL(db, 'ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS open_in_new_tab INTEGER DEFAULT 0 NOT NULL');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_menu_items_article_id ON menu_items(article_id)');
    return;
  }
  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(menu_items)`);
  const columns = await allPrepared<{ name?: string | null }>(stmt);
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('article_id')) {
    await execSQL(db, 'ALTER TABLE menu_items ADD COLUMN article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_menu_items_article_id ON menu_items(article_id)');
  }
  if (!columnNames.has('use_article_title_for_label')) {
    await execSQL(db, 'ALTER TABLE menu_items ADD COLUMN use_article_title_for_label INTEGER DEFAULT 0');
  }
  if (!columnNames.has('open_in_new_tab')) {
    await execSQL(db, 'ALTER TABLE menu_items ADD COLUMN open_in_new_tab INTEGER DEFAULT 0');
  }
}

async function ensureCalendarEventsArticleColumn(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    await execSQL(db, 'ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL');
    return;
  }
  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(calendar_events)`);
  const columns = await allPrepared<{ name?: string | null }>(stmt);
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('article_id')) {
    await execSQL(db, 'ALTER TABLE calendar_events ADD COLUMN article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL');
  }
}

function ensureMenuItemsArticleColumnsSync(db: DatabaseAdapter): void {
  const stmt = db.prepare(`PRAGMA table_info(menu_items)`);
  const columns = stmt.all() as { name?: string }[];
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('article_id')) {
    execSQLSync(db, 'ALTER TABLE menu_items ADD COLUMN article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL');
    execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_menu_items_article_id ON menu_items(article_id)');
  }
  if (!columnNames.has('use_article_title_for_label')) {
    execSQLSync(db, 'ALTER TABLE menu_items ADD COLUMN use_article_title_for_label INTEGER DEFAULT 0');
  }
  if (!columnNames.has('open_in_new_tab')) {
    execSQLSync(db, 'ALTER TABLE menu_items ADD COLUMN open_in_new_tab INTEGER DEFAULT 0');
  }
}

function ensureCalendarEventsArticleColumnSync(db: DatabaseAdapter): void {
  const stmt = db.prepare(`PRAGMA table_info(calendar_events)`);
  const columns = stmt.all() as { name?: string }[];
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('article_id')) {
    execSQLSync(db, 'ALTER TABLE calendar_events ADD COLUMN article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL');
  }
}

async function ensureFilesThumbnailColumns(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    await execSQL(db, 'ALTER TABLE files ADD COLUMN IF NOT EXISTS thumbnail_storage_key TEXT');
    await execSQL(db, 'ALTER TABLE files ADD COLUMN IF NOT EXISTS thumbnail_mime_type TEXT');
    await execSQL(db, 'ALTER TABLE files ADD COLUMN IF NOT EXISTS thumbnail_byte_size INTEGER');
    await execSQL(db, 'ALTER TABLE files ADD COLUMN IF NOT EXISTS thumbnail_checksum_sha256 TEXT');
    return;
  }
  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(files)`);
  const columns = await allPrepared<{ name?: string | null }>(stmt);
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('thumbnail_storage_key')) {
    await execSQL(db, 'ALTER TABLE files ADD COLUMN thumbnail_storage_key TEXT');
  }
  if (!columnNames.has('thumbnail_mime_type')) {
    await execSQL(db, 'ALTER TABLE files ADD COLUMN thumbnail_mime_type TEXT');
  }
  if (!columnNames.has('thumbnail_byte_size')) {
    await execSQL(db, 'ALTER TABLE files ADD COLUMN thumbnail_byte_size INTEGER');
  }
  if (!columnNames.has('thumbnail_checksum_sha256')) {
    await execSQL(db, 'ALTER TABLE files ADD COLUMN thumbnail_checksum_sha256 TEXT');
  }
}

async function ensureArticleVersionsRevisionNoteColumn(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    await execSQL(db, 'ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS revision_note TEXT');
    return;
  }
  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(article_versions)`);
  const columns = await allPrepared<{ name?: string | null }>(stmt);
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('revision_note')) {
    await execSQL(db, 'ALTER TABLE article_versions ADD COLUMN revision_note TEXT');
  }
}

async function ensureArticleVersionsSmallEditColumn(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    await execSQL(db, 'ALTER TABLE article_versions ADD COLUMN IF NOT EXISTS is_small_edit INTEGER DEFAULT 0 NOT NULL');
    return;
  }
  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(article_versions)`);
  const columns = await allPrepared<{ name?: string | null }>(stmt);
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('is_small_edit')) {
    await execSQL(db, 'ALTER TABLE article_versions ADD COLUMN is_small_edit INTEGER DEFAULT 0');
    await execSQL(db, 'UPDATE article_versions SET is_small_edit = 0 WHERE is_small_edit IS NULL');
  }
}

async function ensureArticlesFeaturedSortOrderColumn(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    await execSQL(db, 'ALTER TABLE articles ADD COLUMN IF NOT EXISTS featured_sort_order INTEGER DEFAULT 0 NOT NULL');
    return;
  }
  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(articles)`);
  const columns = await allPrepared<{ name?: string | null }>(stmt);
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('featured_sort_order')) {
    await execSQL(db, 'ALTER TABLE articles ADD COLUMN featured_sort_order INTEGER DEFAULT 0');
    await execSQL(db, 'UPDATE articles SET featured_sort_order = 0 WHERE featured_sort_order IS NULL');
  }
}

function ensureFilesThumbnailColumnsSync(db: DatabaseAdapter): void {
  const stmt = db.prepare(`PRAGMA table_info(files)`);
  const columns = stmt.all() as { name?: string }[];
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('thumbnail_storage_key')) {
    execSQLSync(db, 'ALTER TABLE files ADD COLUMN thumbnail_storage_key TEXT');
  }
  if (!columnNames.has('thumbnail_mime_type')) {
    execSQLSync(db, 'ALTER TABLE files ADD COLUMN thumbnail_mime_type TEXT');
  }
  if (!columnNames.has('thumbnail_byte_size')) {
    execSQLSync(db, 'ALTER TABLE files ADD COLUMN thumbnail_byte_size INTEGER');
  }
  if (!columnNames.has('thumbnail_checksum_sha256')) {
    execSQLSync(db, 'ALTER TABLE files ADD COLUMN thumbnail_checksum_sha256 TEXT');
  }
}

function ensureArticleVersionsRevisionNoteColumnSync(db: DatabaseAdapter): void {
  const stmt = db.prepare(`PRAGMA table_info(article_versions)`);
  const columns = stmt.all() as { name?: string }[];
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('revision_note')) {
    execSQLSync(db, 'ALTER TABLE article_versions ADD COLUMN revision_note TEXT');
  }
}

function ensureArticleVersionsSmallEditColumnSync(db: DatabaseAdapter): void {
  const stmt = db.prepare(`PRAGMA table_info(article_versions)`);
  const columns = stmt.all() as { name?: string }[];
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('is_small_edit')) {
    execSQLSync(db, 'ALTER TABLE article_versions ADD COLUMN is_small_edit INTEGER DEFAULT 0');
    execSQLSync(db, 'UPDATE article_versions SET is_small_edit = 0 WHERE is_small_edit IS NULL');
  }
}

function ensureArticlesFeaturedSortOrderColumnSync(db: DatabaseAdapter): void {
  const stmt = db.prepare(`PRAGMA table_info(articles)`);
  const columns = stmt.all() as { name?: string }[];
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('featured_sort_order')) {
    execSQLSync(db, 'ALTER TABLE articles ADD COLUMN featured_sort_order INTEGER DEFAULT 0');
    execSQLSync(db, 'UPDATE articles SET featured_sort_order = 0 WHERE featured_sort_order IS NULL');
  }
}

async function ensureSponsorAdminAndSponsorshipTables(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    await execSQL(db, 'ALTER TABLE members ADD COLUMN IF NOT EXISTS is_sponsor_admin INTEGER DEFAULT 0 NOT NULL');
    await execSQL(
      db,
      `CREATE TABLE IF NOT EXISTS sponsorship_levels (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        amount INTEGER NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await execSQL(
      db,
      `CREATE TABLE IF NOT EXISTS sponsors (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        website_url TEXT NOT NULL,
        logo_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
        contact_name TEXT,
        contact_email TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await execSQL(
      db,
      `CREATE TABLE IF NOT EXISTS sponsorships (
        id SERIAL PRIMARY KEY,
        sponsor_id INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
        sponsorship_level_id INTEGER NOT NULL REFERENCES sponsorship_levels(id) ON DELETE RESTRICT,
        start_date DATE,
        end_date DATE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_sponsorship_levels_sort_order ON sponsorship_levels(sort_order)');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_sponsors_name ON sponsors(name)');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_sponsorships_sponsor_id ON sponsorships(sponsor_id)');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_sponsorships_sponsorship_level_id ON sponsorships(sponsorship_level_id)');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_sponsorships_dates ON sponsorships(start_date, end_date)');
    return;
  }

  const columnsStmt = db.prepare<{ name?: string | null }>('PRAGMA table_info(members)');
  const columns = await allPrepared<{ name?: string | null }>(columnsStmt);
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('is_sponsor_admin')) {
    await execSQL(db, 'ALTER TABLE members ADD COLUMN is_sponsor_admin INTEGER DEFAULT 0 NOT NULL');
  }

  await execSQL(
    db,
    `CREATE TABLE IF NOT EXISTS sponsorship_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await execSQL(
    db,
    `CREATE TABLE IF NOT EXISTS sponsors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      website_url TEXT NOT NULL,
      logo_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      contact_name TEXT,
      contact_email TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await execSQL(
    db,
    `CREATE TABLE IF NOT EXISTS sponsorships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sponsor_id INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
      sponsorship_level_id INTEGER NOT NULL REFERENCES sponsorship_levels(id) ON DELETE RESTRICT,
      start_date TEXT,
      end_date TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_sponsorship_levels_sort_order ON sponsorship_levels(sort_order)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_sponsors_name ON sponsors(name)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_sponsorships_sponsor_id ON sponsorships(sponsor_id)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_sponsorships_sponsorship_level_id ON sponsorships(sponsorship_level_id)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_sponsorships_dates ON sponsorships(start_date, end_date)');
}

function ensureSponsorAdminAndSponsorshipTablesSync(db: DatabaseAdapter): void {
  const stmt = db.prepare('PRAGMA table_info(members)');
  const columns = stmt.all() as { name?: string }[];
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('is_sponsor_admin')) {
    execSQLSync(db, 'ALTER TABLE members ADD COLUMN is_sponsor_admin INTEGER DEFAULT 0 NOT NULL');
  }
  execSQLSync(
    db,
    `CREATE TABLE IF NOT EXISTS sponsorship_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  execSQLSync(
    db,
    `CREATE TABLE IF NOT EXISTS sponsors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      website_url TEXT NOT NULL,
      logo_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      contact_name TEXT,
      contact_email TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  execSQLSync(
    db,
    `CREATE TABLE IF NOT EXISTS sponsorships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sponsor_id INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
      sponsorship_level_id INTEGER NOT NULL REFERENCES sponsorship_levels(id) ON DELETE RESTRICT,
      start_date TEXT,
      end_date TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_sponsorship_levels_sort_order ON sponsorship_levels(sort_order)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_sponsors_name ON sponsors(name)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_sponsorships_sponsor_id ON sponsorships(sponsor_id)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_sponsorships_sponsorship_level_id ON sponsorships(sponsorship_level_id)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_sponsorships_dates ON sponsorships(start_date, end_date)');
}

const ICE_BOOKING_PURPOSES_SQL = `('practice', 'makeup_game', 'guests_new', 'guests_experienced', 'other')`;

async function ensurePermalinksTables(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    await execSQL(
      db,
      `CREATE TABLE IF NOT EXISTS permalinks (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        label TEXT,
        notes TEXT,
        destination_url TEXT NOT NULL,
        destination_may_change INTEGER NOT NULL DEFAULT 0,
        legacy_click_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_permalinks_slug ON permalinks(slug)');
    await execSQL(
      db,
      `CREATE TABLE IF NOT EXISTS permalink_hits (
        id SERIAL PRIMARY KEY,
        permalink_id INTEGER NOT NULL REFERENCES permalinks(id) ON DELETE CASCADE,
        occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        visitor_id TEXT NOT NULL,
        member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        referrer_domain TEXT
      )`
    );
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_permalink_hits_permalink_id ON permalink_hits(permalink_id)');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_permalink_hits_occurred_at ON permalink_hits(occurred_at)');
    return;
  }

  await execSQL(
    db,
    `CREATE TABLE IF NOT EXISTS permalinks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      label TEXT,
      notes TEXT,
      destination_url TEXT NOT NULL,
      destination_may_change INTEGER NOT NULL DEFAULT 0,
      legacy_click_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_permalinks_slug ON permalinks(slug)');
  await execSQL(
    db,
    `CREATE TABLE IF NOT EXISTS permalink_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      permalink_id INTEGER NOT NULL REFERENCES permalinks(id) ON DELETE CASCADE,
      occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      visitor_id TEXT NOT NULL,
      member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      referrer_domain TEXT
    )`
  );
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_permalink_hits_permalink_id ON permalink_hits(permalink_id)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_permalink_hits_occurred_at ON permalink_hits(occurred_at)');
}

async function ensurePermalinksLegacyClickCountColumn(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    await execSQL(
      db,
      'ALTER TABLE permalinks ADD COLUMN IF NOT EXISTS legacy_click_count INTEGER NOT NULL DEFAULT 0'
    );
    return;
  }
  const stmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(permalinks)`);
  const columns = await allPrepared<{ name?: string | null }>(stmt);
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('legacy_click_count')) {
    await execSQL(
      db,
      'ALTER TABLE permalinks ADD COLUMN legacy_click_count INTEGER NOT NULL DEFAULT 0'
    );
  }
}

function ensurePermalinksTablesSync(db: DatabaseAdapter): void {
  execSQLSync(
    db,
    `CREATE TABLE IF NOT EXISTS permalinks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      label TEXT,
      notes TEXT,
      destination_url TEXT NOT NULL,
      destination_may_change INTEGER NOT NULL DEFAULT 0,
      legacy_click_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_permalinks_slug ON permalinks(slug)');
  execSQLSync(
    db,
    `CREATE TABLE IF NOT EXISTS permalink_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      permalink_id INTEGER NOT NULL REFERENCES permalinks(id) ON DELETE CASCADE,
      occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      visitor_id TEXT NOT NULL,
      member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      referrer_domain TEXT
    )`
  );
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_permalink_hits_permalink_id ON permalink_hits(permalink_id)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_permalink_hits_occurred_at ON permalink_hits(occurred_at)');
}

function ensurePermalinksLegacyClickCountColumnSync(db: DatabaseAdapter): void {
  const stmt = db.prepare(`PRAGMA table_info(permalinks)`);
  const columns = stmt.all() as { name?: string }[];
  const columnNames = new Set(columns.map((col) => String(col.name)));
  if (!columnNames.has('legacy_click_count')) {
    execSQLSync(
      db,
      'ALTER TABLE permalinks ADD COLUMN legacy_click_count INTEGER NOT NULL DEFAULT 0'
    );
  }
}

async function ensureIceBookingsTable(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    await execSQL(
      db,
      `CREATE TABLE IF NOT EXISTS ice_bookings (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
        start_dt TEXT NOT NULL,
        end_dt TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK(purpose IN ${ICE_BOOKING_PURPOSES_SQL}),
        purpose_other TEXT,
        guest_names TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_ice_bookings_member_id ON ice_bookings(member_id)');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_ice_bookings_sheet_id ON ice_bookings(sheet_id)');
    await execSQL(
      db,
      'CREATE INDEX IF NOT EXISTS idx_ice_bookings_sheet_range ON ice_bookings(sheet_id, start_dt, end_dt)'
    );
    return;
  }

  await execSQL(
    db,
    `CREATE TABLE IF NOT EXISTS ice_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
      start_dt TEXT NOT NULL,
      end_dt TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ${ICE_BOOKING_PURPOSES_SQL}),
      purpose_other TEXT,
      guest_names TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_ice_bookings_member_id ON ice_bookings(member_id)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_ice_bookings_sheet_id ON ice_bookings(sheet_id)');
  await execSQL(
    db,
    'CREATE INDEX IF NOT EXISTS idx_ice_bookings_sheet_range ON ice_bookings(sheet_id, start_dt, end_dt)'
  );
}

function ensureIceBookingsTableSync(db: DatabaseAdapter): void {
  execSQLSync(
    db,
    `CREATE TABLE IF NOT EXISTS ice_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
      start_dt TEXT NOT NULL,
      end_dt TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ${ICE_BOOKING_PURPOSES_SQL}),
      purpose_other TEXT,
      guest_names TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_ice_bookings_member_id ON ice_bookings(member_id)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_ice_bookings_sheet_id ON ice_bookings(sheet_id)');
  execSQLSync(
    db,
    'CREATE INDEX IF NOT EXISTS idx_ice_bookings_sheet_range ON ice_bookings(sheet_id, start_dt, end_dt)'
  );
}

/** Migrate legacy purpose `guests` and add guest_names column (SQLite rebuild when needed). */
async function migrateIceBookingsGuestPurposeExpand(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    await execSQL(db, 'ALTER TABLE ice_bookings ADD COLUMN IF NOT EXISTS guest_names TEXT');
    await execSQL(db, `UPDATE ice_bookings SET purpose = 'guests_new' WHERE purpose = 'guests'`);
    await execSQL(db, 'ALTER TABLE ice_bookings DROP CONSTRAINT IF EXISTS ice_bookings_purpose_check');
    await execSQL(
      db,
      `ALTER TABLE ice_bookings ADD CONSTRAINT ice_bookings_purpose_check CHECK (purpose IN ${ICE_BOOKING_PURPOSES_SQL})`
    );
    return;
  }

  const tableStmt = db.prepare<{ name?: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='ice_bookings'`
  );
  const tableRow = await getPrepared(tableStmt);
  if (!tableRow?.name) return;

  const colStmt = db.prepare<{ name?: string | null }>(`PRAGMA table_info(ice_bookings)`);
  const columns = await allPrepared<{ name?: string | null }>(colStmt);
  const colNames = new Set(columns.map((c) => String(c.name)));
  if (colNames.has('guest_names')) return;

  await execSQL(db, 'DROP TABLE IF EXISTS ice_bookings__new');
  await execSQL(
    db,
    `CREATE TABLE ice_bookings__new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
      start_dt TEXT NOT NULL,
      end_dt TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ${ICE_BOOKING_PURPOSES_SQL}),
      purpose_other TEXT,
      guest_names TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await execSQL(
    db,
    `INSERT INTO ice_bookings__new (id, member_id, sheet_id, start_dt, end_dt, purpose, purpose_other, guest_names, created_at)
     SELECT id, member_id, sheet_id, start_dt, end_dt,
       CASE purpose WHEN 'guests' THEN 'guests_new' ELSE purpose END,
       purpose_other, NULL, created_at
     FROM ice_bookings`
  );
  await execSQL(db, 'DROP TABLE ice_bookings');
  await execSQL(db, 'ALTER TABLE ice_bookings__new RENAME TO ice_bookings');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_ice_bookings_member_id ON ice_bookings(member_id)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_ice_bookings_sheet_id ON ice_bookings(sheet_id)');
  await execSQL(
    db,
    'CREATE INDEX IF NOT EXISTS idx_ice_bookings_sheet_range ON ice_bookings(sheet_id, start_dt, end_dt)'
  );
}

function migrateIceBookingsGuestPurposeExpandSync(db: DatabaseAdapter): void {
  const tableRow = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ice_bookings'`)
    .get() as { name?: string } | undefined;
  if (!tableRow?.name) return;

  const columns = db.prepare(`PRAGMA table_info(ice_bookings)`).all() as { name?: string }[];
  const colNames = new Set(columns.map((c) => String(c.name)));
  if (colNames.has('guest_names')) return;

  execSQLSync(db, 'DROP TABLE IF EXISTS ice_bookings__new');
  execSQLSync(
    db,
    `CREATE TABLE ice_bookings__new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
      start_dt TEXT NOT NULL,
      end_dt TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ${ICE_BOOKING_PURPOSES_SQL}),
      purpose_other TEXT,
      guest_names TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  execSQLSync(
    db,
    `INSERT INTO ice_bookings__new (id, member_id, sheet_id, start_dt, end_dt, purpose, purpose_other, guest_names, created_at)
     SELECT id, member_id, sheet_id, start_dt, end_dt,
       CASE purpose WHEN 'guests' THEN 'guests_new' ELSE purpose END,
       purpose_other, NULL, created_at
     FROM ice_bookings`
  );
  execSQLSync(db, 'DROP TABLE ice_bookings');
  execSQLSync(db, 'ALTER TABLE ice_bookings__new RENAME TO ice_bookings');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_ice_bookings_member_id ON ice_bookings(member_id)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_ice_bookings_sheet_id ON ice_bookings(sheet_id)');
  execSQLSync(
    db,
    'CREATE INDEX IF NOT EXISTS idx_ice_bookings_sheet_range ON ice_bookings(sheet_id, start_dt, end_dt)'
  );
}

async function ensureGovernanceTables(db: DatabaseAdapter): Promise<void> {
  if (db.isAsync()) {
    await execSQL(
      db,
      `CREATE TABLE IF NOT EXISTS governance_settings (
        id INTEGER PRIMARY KEY,
        fiscal_year_start_mmdd TEXT NOT NULL,
        board_turnover_mmdd TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await execSQL(
      db,
      `INSERT INTO governance_settings (id, fiscal_year_start_mmdd, board_turnover_mmdd)
       VALUES (1, '09-01', '09-01')
       ON CONFLICT (id) DO NOTHING`
    );

    await execSQL(
      db,
      `CREATE TABLE IF NOT EXISTS governance_board_members (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
        public_email TEXT,
        first_fiscal_year INTEGER NOT NULL,
        last_fiscal_year INTEGER NOT NULL,
        manual_inactive INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await execSQL(
      db,
      `CREATE TABLE IF NOT EXISTS governance_committees (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        contact_info TEXT,
        responsibilities TEXT,
        board_liaison_board_member_id INTEGER REFERENCES governance_board_members(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await execSQL(
      db,
      `CREATE TABLE IF NOT EXISTS governance_committee_chairs (
        id SERIAL PRIMARY KEY,
        committee_id INTEGER NOT NULL REFERENCES governance_committees(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        public_email TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(committee_id, member_id)
      )`
    );
    await execSQL(
      db,
      `CREATE TABLE IF NOT EXISTS governance_board_member_committees (
        id SERIAL PRIMARY KEY,
        board_member_id INTEGER NOT NULL REFERENCES governance_board_members(id) ON DELETE CASCADE,
        committee_id INTEGER NOT NULL REFERENCES governance_committees(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(board_member_id, committee_id)
      )`
    );
    await execSQL(
      db,
      `CREATE TABLE IF NOT EXISTS governance_officers (
        id SERIAL PRIMARY KEY,
        position TEXT NOT NULL CHECK(position IN ('president', 'vice_president', 'treasurer', 'secretary')),
        board_member_id INTEGER NOT NULL UNIQUE REFERENCES governance_board_members(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(position)
      )`
    );

    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_board_members_member_id ON governance_board_members(member_id)');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_committees_liaison_id ON governance_committees(board_liaison_board_member_id)');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_committees_sort_order ON governance_committees(sort_order)');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_committee_chairs_committee_id ON governance_committee_chairs(committee_id)');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_committee_chairs_member_id ON governance_committee_chairs(member_id)');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_board_member_committees_board_member_id ON governance_board_member_committees(board_member_id)');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_board_member_committees_committee_id ON governance_board_member_committees(committee_id)');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_officers_board_member_id ON governance_officers(board_member_id)');
    return;
  }

  await execSQL(
    db,
    `CREATE TABLE IF NOT EXISTS governance_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      fiscal_year_start_mmdd TEXT NOT NULL,
      board_turnover_mmdd TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await execSQL(db, `INSERT OR IGNORE INTO governance_settings (id, fiscal_year_start_mmdd, board_turnover_mmdd) VALUES (1, '09-01', '09-01')`);
  await execSQL(
    db,
    `CREATE TABLE IF NOT EXISTS governance_board_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
      public_email TEXT,
      first_fiscal_year INTEGER NOT NULL,
      last_fiscal_year INTEGER NOT NULL,
      manual_inactive INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await execSQL(
    db,
    `CREATE TABLE IF NOT EXISTS governance_committees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      contact_info TEXT,
      responsibilities TEXT,
      board_liaison_board_member_id INTEGER REFERENCES governance_board_members(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await execSQL(
    db,
    `CREATE TABLE IF NOT EXISTS governance_committee_chairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      committee_id INTEGER NOT NULL REFERENCES governance_committees(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      public_email TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(committee_id, member_id)
    )`
  );
  await execSQL(
    db,
    `CREATE TABLE IF NOT EXISTS governance_board_member_committees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_member_id INTEGER NOT NULL REFERENCES governance_board_members(id) ON DELETE CASCADE,
      committee_id INTEGER NOT NULL REFERENCES governance_committees(id) ON DELETE CASCADE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(board_member_id, committee_id)
    )`
  );
  await execSQL(
    db,
    `CREATE TABLE IF NOT EXISTS governance_officers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position TEXT NOT NULL CHECK(position IN ('president', 'vice_president', 'treasurer', 'secretary')),
      board_member_id INTEGER NOT NULL UNIQUE REFERENCES governance_board_members(id) ON DELETE CASCADE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(position)
    )`
  );

  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_board_members_member_id ON governance_board_members(member_id)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_committees_liaison_id ON governance_committees(board_liaison_board_member_id)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_committees_sort_order ON governance_committees(sort_order)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_committee_chairs_committee_id ON governance_committee_chairs(committee_id)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_committee_chairs_member_id ON governance_committee_chairs(member_id)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_board_member_committees_board_member_id ON governance_board_member_committees(board_member_id)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_board_member_committees_committee_id ON governance_board_member_committees(committee_id)');
  await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_governance_officers_board_member_id ON governance_officers(board_member_id)');
}

function ensureGovernanceTablesSync(db: DatabaseAdapter): void {
  execSQLSync(
    db,
    `CREATE TABLE IF NOT EXISTS governance_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      fiscal_year_start_mmdd TEXT NOT NULL,
      board_turnover_mmdd TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  execSQLSync(db, `INSERT OR IGNORE INTO governance_settings (id, fiscal_year_start_mmdd, board_turnover_mmdd) VALUES (1, '09-01', '09-01')`);
  execSQLSync(
    db,
    `CREATE TABLE IF NOT EXISTS governance_board_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
      public_email TEXT,
      first_fiscal_year INTEGER NOT NULL,
      last_fiscal_year INTEGER NOT NULL,
      manual_inactive INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  execSQLSync(
    db,
    `CREATE TABLE IF NOT EXISTS governance_committees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      contact_info TEXT,
      responsibilities TEXT,
      board_liaison_board_member_id INTEGER REFERENCES governance_board_members(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  execSQLSync(
    db,
    `CREATE TABLE IF NOT EXISTS governance_committee_chairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      committee_id INTEGER NOT NULL REFERENCES governance_committees(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      public_email TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(committee_id, member_id)
    )`
  );
  execSQLSync(
    db,
    `CREATE TABLE IF NOT EXISTS governance_board_member_committees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_member_id INTEGER NOT NULL REFERENCES governance_board_members(id) ON DELETE CASCADE,
      committee_id INTEGER NOT NULL REFERENCES governance_committees(id) ON DELETE CASCADE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(board_member_id, committee_id)
    )`
  );
  execSQLSync(
    db,
    `CREATE TABLE IF NOT EXISTS governance_officers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position TEXT NOT NULL CHECK(position IN ('president', 'vice_president', 'treasurer', 'secretary')),
      board_member_id INTEGER NOT NULL UNIQUE REFERENCES governance_board_members(id) ON DELETE CASCADE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(position)
    )`
  );

  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_governance_board_members_member_id ON governance_board_members(member_id)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_governance_committees_liaison_id ON governance_committees(board_liaison_board_member_id)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_governance_committees_sort_order ON governance_committees(sort_order)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_governance_committee_chairs_committee_id ON governance_committee_chairs(committee_id)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_governance_committee_chairs_member_id ON governance_committee_chairs(member_id)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_governance_board_member_committees_board_member_id ON governance_board_member_committees(board_member_id)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_governance_board_member_committees_committee_id ON governance_board_member_committees(committee_id)');
  execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_governance_officers_board_member_id ON governance_officers(board_member_id)');
}

async function ensureRbacTables(db: DatabaseAdapter): Promise<void> {
  await execSQL(
    db,
    `
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        is_system INTEGER DEFAULT 0 NOT NULL,
        is_computed INTEGER DEFAULT 0 NOT NULL,
        is_assignable INTEGER DEFAULT 1 NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_roles_code ON roles(code);
      CREATE INDEX IF NOT EXISTS idx_roles_is_system ON roles(is_system);

      CREATE TABLE IF NOT EXISTS role_scope_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        effect TEXT NOT NULL CHECK(effect IN ('allow', 'deny')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(role_id, scope)
      );

      CREATE INDEX IF NOT EXISTS idx_role_scope_rules_role_id ON role_scope_rules(role_id);
      CREATE INDEX IF NOT EXISTS idx_role_scope_rules_scope ON role_scope_rules(scope);

      CREATE TABLE IF NOT EXISTS member_role_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        resource_type TEXT,
        resource_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(member_id, role_id, resource_type, resource_id)
      );

      CREATE INDEX IF NOT EXISTS idx_member_role_assignments_member_id ON member_role_assignments(member_id);
      CREATE INDEX IF NOT EXISTS idx_member_role_assignments_role_id ON member_role_assignments(role_id);
      CREATE INDEX IF NOT EXISTS idx_member_role_assignments_resource ON member_role_assignments(resource_type, resource_id);
    `
  );

  if (db.isAsync()) {
    // PostgreSQL path
    await execSQL(
      db,
      `
        INSERT INTO roles (code, name, description, is_system, is_computed, is_assignable)
        VALUES
          ('authenticated_user', 'Authenticated user', 'Base permissions for any signed-in user', 1, 1, 0),
          ('active_member', 'Active member', 'Computed role for members with non-expired membership', 1, 1, 0),
          ('member_with_ice_privileges', 'Member with ice privileges', 'Computed role for members with on-ice access', 1, 1, 0),
          ('general_admin', 'General admin', 'General administrative permissions', 1, 0, 1),
          ('calendar_admin', 'Calendar admin', 'Calendar administration permissions', 1, 0, 1),
          ('content_admin', 'Content admin', 'Content and file administration permissions', 1, 0, 1),
          ('sponsor_admin', 'Sponsor admin', 'Sponsorship administration permissions', 1, 0, 1),
          ('league_admin', 'League admin', 'League administration permissions', 1, 0, 1),
          ('league_manager', 'League manager', 'League management permissions', 1, 0, 1)
        ON CONFLICT (code) DO NOTHING;
      `
    );

    await execSQL(
      db,
      `
        INSERT INTO role_scope_rules (role_id, scope, effect)
        SELECT r.id, v.scope, v.effect
        FROM roles r
        JOIN (
          VALUES
            ('authenticated_user', 'dashboard.read', 'allow'),
            ('authenticated_user', 'profile.manage_self', 'allow'),
            ('authenticated_user', 'members.read', 'allow'),
            ('authenticated_user', 'leagues.read', 'allow'),
            ('authenticated_user', 'calendar.read', 'allow'),
            ('authenticated_user', 'governance.read', 'allow'),
            ('authenticated_user', 'feedback.submit', 'allow'),
            ('authenticated_user', 'spares.read', 'allow'),
            ('authenticated_user', 'spares.respond', 'allow'),
            ('authenticated_user', 'availability.manage_self', 'allow'),
            ('active_member', 'member.active', 'allow'),
            ('member_with_ice_privileges', 'member.ice_privileges', 'allow'),
            ('member_with_ice_privileges', 'spares.request', 'allow'),
            ('member_with_ice_privileges', 'ice_bookings.manage_own', 'allow'),
            ('general_admin', 'admin.manage', 'allow'),
            ('general_admin', 'members.manage', 'allow'),
            ('general_admin', 'governance.manage', 'allow'),
            ('general_admin', 'feedback.manage', 'allow'),
            ('general_admin', 'payments.read', 'allow'),
            ('general_admin', 'payments.manage', 'allow'),
            ('calendar_admin', 'calendar.manage', 'allow'),
            ('content_admin', 'content.manage', 'allow'),
            ('content_admin', 'files.manage', 'allow'),
            ('sponsor_admin', 'sponsorship.manage', 'allow'),
            ('league_admin', 'leagues.manage', 'allow'),
            ('league_manager', 'leagues.manage', 'allow')
        ) AS v(role_code, scope, effect)
          ON r.code = v.role_code
        ON CONFLICT (role_id, scope) DO NOTHING;
      `
    );
  } else {
    // SQLite path
    await execSQL(
      db,
      `
        INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
        VALUES ('authenticated_user', 'Authenticated user', 'Base permissions for any signed-in user', 1, 1, 0);
        INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
        VALUES ('active_member', 'Active member', 'Computed role for members with non-expired membership', 1, 1, 0);
        INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
        VALUES ('member_with_ice_privileges', 'Member with ice privileges', 'Computed role for members with on-ice access', 1, 1, 0);
        INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
        VALUES ('general_admin', 'General admin', 'General administrative permissions', 1, 0, 1);
        INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
        VALUES ('calendar_admin', 'Calendar admin', 'Calendar administration permissions', 1, 0, 1);
        INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
        VALUES ('content_admin', 'Content admin', 'Content and file administration permissions', 1, 0, 1);
        INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
        VALUES ('sponsor_admin', 'Sponsor admin', 'Sponsorship administration permissions', 1, 0, 1);
        INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
        VALUES ('league_admin', 'League admin', 'League administration permissions', 1, 0, 1);
        INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
        VALUES ('league_manager', 'League manager', 'League management permissions', 1, 0, 1);
      `
    );

    await execSQL(
      db,
      `
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'dashboard.read', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'profile.manage_self', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'members.read', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'leagues.read', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'calendar.read', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'governance.read', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'feedback.submit', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'spares.read', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'spares.respond', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'availability.manage_self', 'allow');

        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'active_member'), 'member.active', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'member_with_ice_privileges'), 'member.ice_privileges', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'member_with_ice_privileges'), 'spares.request', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'member_with_ice_privileges'), 'ice_bookings.manage_own', 'allow');

        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'general_admin'), 'admin.manage', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'general_admin'), 'members.manage', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'general_admin'), 'governance.manage', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'general_admin'), 'feedback.manage', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'general_admin'), 'payments.read', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'general_admin'), 'payments.manage', 'allow');

        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'calendar_admin'), 'calendar.manage', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'content_admin'), 'content.manage', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'content_admin'), 'files.manage', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'sponsor_admin'), 'sponsorship.manage', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'league_admin'), 'leagues.manage', 'allow');
        INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
        VALUES ((SELECT id FROM roles WHERE code = 'league_manager'), 'leagues.manage', 'allow');
      `
    );
  }

  // Backfill first-pass role assignments from legacy columns/tables.
  await execSQL(
    db,
    `
      INSERT INTO member_role_assignments (member_id, role_id, resource_type, resource_id)
      SELECT m.id, r.id, NULL, NULL
      FROM members m
      JOIN roles r ON r.code = 'general_admin'
      WHERE COALESCE(m.is_admin, 0) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM member_role_assignments a
          WHERE a.member_id = m.id
            AND a.role_id = r.id
            AND a.resource_type IS NULL
            AND a.resource_id IS NULL
        );

      INSERT INTO member_role_assignments (member_id, role_id, resource_type, resource_id)
      SELECT m.id, r.id, NULL, NULL
      FROM members m
      JOIN roles r ON r.code = 'calendar_admin'
      WHERE COALESCE(m.is_calendar_admin, 0) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM member_role_assignments a
          WHERE a.member_id = m.id
            AND a.role_id = r.id
            AND a.resource_type IS NULL
            AND a.resource_id IS NULL
        );

      INSERT INTO member_role_assignments (member_id, role_id, resource_type, resource_id)
      SELECT m.id, r.id, NULL, NULL
      FROM members m
      JOIN roles r ON r.code = 'content_admin'
      WHERE COALESCE(m.is_content_admin, 0) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM member_role_assignments a
          WHERE a.member_id = m.id
            AND a.role_id = r.id
            AND a.resource_type IS NULL
            AND a.resource_id IS NULL
        );

      INSERT INTO member_role_assignments (member_id, role_id, resource_type, resource_id)
      SELECT m.id, r.id, NULL, NULL
      FROM members m
      JOIN roles r ON r.code = 'sponsor_admin'
      WHERE COALESCE(m.is_sponsor_admin, 0) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM member_role_assignments a
          WHERE a.member_id = m.id
            AND a.role_id = r.id
            AND a.resource_type IS NULL
            AND a.resource_id IS NULL
        );

      INSERT INTO member_role_assignments (member_id, role_id, resource_type, resource_id)
      SELECT lmr.member_id, r.id, 'league', lmr.league_id
      FROM league_member_roles lmr
      JOIN roles r ON r.code = 'league_manager'
      WHERE lmr.role = 'league_manager'
        AND NOT EXISTS (
          SELECT 1
          FROM member_role_assignments a
          WHERE a.member_id = lmr.member_id
            AND a.role_id = r.id
            AND COALESCE(a.resource_type, '') = 'league'
            AND COALESCE(a.resource_id, -1) = COALESCE(lmr.league_id, -1)
        );

      INSERT INTO member_role_assignments (member_id, role_id, resource_type, resource_id)
      SELECT lmr.member_id, r.id, 'league', lmr.league_id
      FROM league_member_roles lmr
      JOIN roles r ON r.code = 'league_admin'
      WHERE lmr.role = 'league_administrator'
        AND NOT EXISTS (
          SELECT 1
          FROM member_role_assignments a
          WHERE a.member_id = lmr.member_id
            AND a.role_id = r.id
            AND COALESCE(a.resource_type, '') = 'league'
            AND COALESCE(a.resource_id, -1) = COALESCE(lmr.league_id, -1)
        );
    `
  );
}

function ensureRbacTablesSync(db: DatabaseAdapter): void {
  execSQLSync(
    db,
    `
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        is_system INTEGER DEFAULT 0 NOT NULL,
        is_computed INTEGER DEFAULT 0 NOT NULL,
        is_assignable INTEGER DEFAULT 1 NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_roles_code ON roles(code);
      CREATE INDEX IF NOT EXISTS idx_roles_is_system ON roles(is_system);

      CREATE TABLE IF NOT EXISTS role_scope_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        effect TEXT NOT NULL CHECK(effect IN ('allow', 'deny')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(role_id, scope)
      );

      CREATE INDEX IF NOT EXISTS idx_role_scope_rules_role_id ON role_scope_rules(role_id);
      CREATE INDEX IF NOT EXISTS idx_role_scope_rules_scope ON role_scope_rules(scope);

      CREATE TABLE IF NOT EXISTS member_role_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        resource_type TEXT,
        resource_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(member_id, role_id, resource_type, resource_id)
      );

      CREATE INDEX IF NOT EXISTS idx_member_role_assignments_member_id ON member_role_assignments(member_id);
      CREATE INDEX IF NOT EXISTS idx_member_role_assignments_role_id ON member_role_assignments(role_id);
      CREATE INDEX IF NOT EXISTS idx_member_role_assignments_resource ON member_role_assignments(resource_type, resource_id);
    `
  );

  execSQLSync(
    db,
    `
      INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
      VALUES ('authenticated_user', 'Authenticated user', 'Base permissions for any signed-in user', 1, 1, 0);
      INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
      VALUES ('active_member', 'Active member', 'Computed role for members with non-expired membership', 1, 1, 0);
      INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
      VALUES ('member_with_ice_privileges', 'Member with ice privileges', 'Computed role for members with on-ice access', 1, 1, 0);
      INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
      VALUES ('general_admin', 'General admin', 'General administrative permissions', 1, 0, 1);
      INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
      VALUES ('calendar_admin', 'Calendar admin', 'Calendar administration permissions', 1, 0, 1);
      INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
      VALUES ('content_admin', 'Content admin', 'Content and file administration permissions', 1, 0, 1);
      INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
      VALUES ('sponsor_admin', 'Sponsor admin', 'Sponsorship administration permissions', 1, 0, 1);
      INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
      VALUES ('league_admin', 'League admin', 'League administration permissions', 1, 0, 1);
      INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
      VALUES ('league_manager', 'League manager', 'League management permissions', 1, 0, 1);
    `
  );

  execSQLSync(
    db,
    `
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'dashboard.read', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'profile.manage_self', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'members.read', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'leagues.read', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'calendar.read', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'governance.read', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'feedback.submit', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'spares.read', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'spares.respond', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'authenticated_user'), 'availability.manage_self', 'allow');

      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'active_member'), 'member.active', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'member_with_ice_privileges'), 'member.ice_privileges', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'member_with_ice_privileges'), 'spares.request', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'member_with_ice_privileges'), 'ice_bookings.manage_own', 'allow');

      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'general_admin'), 'admin.manage', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'general_admin'), 'members.manage', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'general_admin'), 'governance.manage', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'general_admin'), 'feedback.manage', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'general_admin'), 'payments.read', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'general_admin'), 'payments.manage', 'allow');

      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'calendar_admin'), 'calendar.manage', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'content_admin'), 'content.manage', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'content_admin'), 'files.manage', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'sponsor_admin'), 'sponsorship.manage', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'league_admin'), 'leagues.manage', 'allow');
      INSERT OR IGNORE INTO role_scope_rules (role_id, scope, effect)
      VALUES ((SELECT id FROM roles WHERE code = 'league_manager'), 'leagues.manage', 'allow');
    `
  );

  execSQLSync(
    db,
    `
      INSERT INTO member_role_assignments (member_id, role_id, resource_type, resource_id)
      SELECT m.id, r.id, NULL, NULL
      FROM members m
      JOIN roles r ON r.code = 'general_admin'
      WHERE COALESCE(m.is_admin, 0) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM member_role_assignments a
          WHERE a.member_id = m.id
            AND a.role_id = r.id
            AND a.resource_type IS NULL
            AND a.resource_id IS NULL
        );

      INSERT INTO member_role_assignments (member_id, role_id, resource_type, resource_id)
      SELECT m.id, r.id, NULL, NULL
      FROM members m
      JOIN roles r ON r.code = 'calendar_admin'
      WHERE COALESCE(m.is_calendar_admin, 0) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM member_role_assignments a
          WHERE a.member_id = m.id
            AND a.role_id = r.id
            AND a.resource_type IS NULL
            AND a.resource_id IS NULL
        );

      INSERT INTO member_role_assignments (member_id, role_id, resource_type, resource_id)
      SELECT m.id, r.id, NULL, NULL
      FROM members m
      JOIN roles r ON r.code = 'content_admin'
      WHERE COALESCE(m.is_content_admin, 0) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM member_role_assignments a
          WHERE a.member_id = m.id
            AND a.role_id = r.id
            AND a.resource_type IS NULL
            AND a.resource_id IS NULL
        );

      INSERT INTO member_role_assignments (member_id, role_id, resource_type, resource_id)
      SELECT m.id, r.id, NULL, NULL
      FROM members m
      JOIN roles r ON r.code = 'sponsor_admin'
      WHERE COALESCE(m.is_sponsor_admin, 0) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM member_role_assignments a
          WHERE a.member_id = m.id
            AND a.role_id = r.id
            AND a.resource_type IS NULL
            AND a.resource_id IS NULL
        );

      INSERT INTO member_role_assignments (member_id, role_id, resource_type, resource_id)
      SELECT lmr.member_id, r.id, 'league', lmr.league_id
      FROM league_member_roles lmr
      JOIN roles r ON r.code = 'league_manager'
      WHERE lmr.role = 'league_manager'
        AND NOT EXISTS (
          SELECT 1
          FROM member_role_assignments a
          WHERE a.member_id = lmr.member_id
            AND a.role_id = r.id
            AND COALESCE(a.resource_type, '') = 'league'
            AND COALESCE(a.resource_id, -1) = COALESCE(lmr.league_id, -1)
        );

      INSERT INTO member_role_assignments (member_id, role_id, resource_type, resource_id)
      SELECT lmr.member_id, r.id, 'league', lmr.league_id
      FROM league_member_roles lmr
      JOIN roles r ON r.code = 'league_admin'
      WHERE lmr.role = 'league_administrator'
        AND NOT EXISTS (
          SELECT 1
          FROM member_role_assignments a
          WHERE a.member_id = lmr.member_id
            AND a.role_id = r.id
            AND COALESCE(a.resource_type, '') = 'league'
            AND COALESCE(a.resource_id, -1) = COALESCE(lmr.league_id, -1)
        );
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
      social_member INTEGER DEFAULT 0 NOT NULL,
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

    -- League extra draws (one-off draw dates/times)
    CREATE TABLE IF NOT EXISTS league_extra_draws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      draw_date DATE NOT NULL,
      draw_time TIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      UNIQUE(league_id, draw_date, draw_time)
    );

    CREATE INDEX IF NOT EXISTS idx_league_extra_draws_league_id ON league_extra_draws(league_id);
    CREATE INDEX IF NOT EXISTS idx_league_extra_draws_date_time ON league_extra_draws(league_id, draw_date, draw_time);

    -- League extra draws (one-off draw dates/times)
    CREATE TABLE IF NOT EXISTS league_extra_draws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      draw_date DATE NOT NULL,
      draw_time TIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      UNIQUE(league_id, draw_date, draw_time)
    );

    CREATE INDEX IF NOT EXISTS idx_league_extra_draws_league_id ON league_extra_draws(league_id);
    CREATE INDEX IF NOT EXISTS idx_league_extra_draws_date_time ON league_extra_draws(league_id, draw_date, draw_time);

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

    -- Draw sheet availability overrides
    CREATE TABLE IF NOT EXISTS draw_sheet_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      draw_date DATE NOT NULL,
      draw_time TIME NOT NULL,
      sheet_id INTEGER NOT NULL,
      is_available INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE,
      UNIQUE(league_id, draw_date, draw_time, sheet_id)
    );

    CREATE INDEX IF NOT EXISTS idx_draw_sheet_availability_league_id ON draw_sheet_availability(league_id);
    CREATE INDEX IF NOT EXISTS idx_draw_sheet_availability_draw ON draw_sheet_availability(league_id, draw_date, draw_time);
    CREATE INDEX IF NOT EXISTS idx_draw_sheet_availability_sheet_id ON draw_sheet_availability(sheet_id);

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
      prefer_late_draw INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      FOREIGN KEY (division_id) REFERENCES league_divisions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_league_teams_league_id ON league_teams(league_id);
    CREATE INDEX IF NOT EXISTS idx_league_teams_division_id ON league_teams(division_id);

    -- Games
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      team1_id INTEGER NOT NULL,
      team2_id INTEGER NOT NULL,
      game_date DATE,
      game_time TIME,
      sheet_id INTEGER,
      status TEXT NOT NULL DEFAULT 'unscheduled' CHECK(status IN ('scheduled', 'unscheduled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      FOREIGN KEY (team1_id) REFERENCES league_teams(id) ON DELETE RESTRICT,
      FOREIGN KEY (team2_id) REFERENCES league_teams(id) ON DELETE RESTRICT,
      FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_games_league_id ON games(league_id);
    CREATE INDEX IF NOT EXISTS idx_games_team1_id ON games(team1_id);
    CREATE INDEX IF NOT EXISTS idx_games_team2_id ON games(team2_id);
    CREATE INDEX IF NOT EXISTS idx_games_sheet_id ON games(sheet_id);
    CREATE INDEX IF NOT EXISTS idx_games_league_date_time ON games(league_id, game_date, game_time);
    CREATE UNIQUE INDEX IF NOT EXISTS games_sheet_date_time_unique ON games(sheet_id, game_date, game_time);

    -- League settings (ranking config, result labels)
    CREATE TABLE IF NOT EXISTS league_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      head_to_head_first INTEGER DEFAULT 0,
      result_labels TEXT,
      collect_bye_requests INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      UNIQUE(league_id)
    );
    CREATE INDEX IF NOT EXISTS idx_league_settings_league_id ON league_settings(league_id);

    -- Team bye requests (prioritized bye requests for schedule generation)
    CREATE TABLE IF NOT EXISTS team_bye_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      draw_date TEXT NOT NULL,
      priority INTEGER NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES league_teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_team_bye_requests_team_id ON team_bye_requests(team_id);
    CREATE INDEX IF NOT EXISTS idx_team_bye_requests_draw_date ON team_bye_requests(draw_date);

    -- Game results (tiebreaker values per team per game)
    CREATE TABLE IF NOT EXISTS game_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      result_order INTEGER NOT NULL,
      value INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES league_teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_game_results_game_id ON game_results(game_id);
    CREATE INDEX IF NOT EXISTS idx_game_results_team_id ON game_results(team_id);
    CREATE INDEX IF NOT EXISTS idx_game_results_game_team ON game_results(game_id, team_id);

    -- Game lineups (who actually played, including spares)
    CREATE TABLE IF NOT EXISTS game_lineups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      is_spare INTEGER DEFAULT 0,
      sparing_for_member_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES league_teams(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      FOREIGN KEY (sparing_for_member_id) REFERENCES members(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_game_lineups_game_id ON game_lineups(game_id);
    CREATE INDEX IF NOT EXISTS idx_game_lineups_team_id ON game_lineups(team_id);
    CREATE INDEX IF NOT EXISTS idx_game_lineups_member_id ON game_lineups(member_id);
    CREATE INDEX IF NOT EXISTS idx_game_lineups_member_stats ON game_lineups(member_id);

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
      prefer_late_draw INTEGER DEFAULT 0,
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

    -- Draw sheet availability overrides
    CREATE TABLE IF NOT EXISTS draw_sheet_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      draw_date DATE NOT NULL,
      draw_time TIME NOT NULL,
      sheet_id INTEGER NOT NULL,
      is_available INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE,
      UNIQUE(league_id, draw_date, draw_time, sheet_id)
    );

    CREATE INDEX IF NOT EXISTS idx_draw_sheet_availability_league_id ON draw_sheet_availability(league_id);
    CREATE INDEX IF NOT EXISTS idx_draw_sheet_availability_draw ON draw_sheet_availability(league_id, draw_date, draw_time);
    CREATE INDEX IF NOT EXISTS idx_draw_sheet_availability_sheet_id ON draw_sheet_availability(sheet_id);

    -- Spare requests
    CREATE TABLE IF NOT EXISTS spare_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      league_id INTEGER,
      game_id INTEGER,
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
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL,
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
    { sql: 'ALTER TABLE members ADD COLUMN social_member INTEGER DEFAULT 0 NOT NULL', table: 'members', column: 'social_member' },
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
    { sql: 'ALTER TABLE spare_requests ADD COLUMN game_id INTEGER REFERENCES games(id) ON DELETE SET NULL', table: 'spare_requests', column: 'game_id' },
    { sql: 'ALTER TABLE spare_request_invitations ADD COLUMN declined_at DATETIME', table: 'spare_request_invitations', column: 'declined_at' },
    { sql: 'ALTER TABLE spare_request_invitations ADD COLUMN decline_comment TEXT', table: 'spare_request_invitations', column: 'decline_comment' },
    { sql: 'ALTER TABLE spare_requests ADD COLUMN all_invites_declined_notified INTEGER DEFAULT 0', table: 'spare_requests', column: 'all_invites_declined_notified' },
    { sql: 'ALTER TABLE spare_requests ADD COLUMN notification_generation INTEGER DEFAULT 0', table: 'spare_requests', column: 'notification_generation' },
    { sql: 'ALTER TABLE league_settings ADD COLUMN collect_bye_requests INTEGER DEFAULT 1', table: 'league_settings', column: 'collect_bye_requests' },
    { sql: 'ALTER TABLE team_bye_requests DROP COLUMN draw_time', table: 'team_bye_requests', column: '_drop_draw_time' },
    { sql: 'ALTER TABLE league_teams ADD COLUMN prefer_late_draw INTEGER DEFAULT 0', table: 'league_teams', column: 'prefer_late_draw' },
    { sql: 'ALTER TABLE members ADD COLUMN is_calendar_admin INTEGER DEFAULT 0', table: 'members', column: 'is_calendar_admin' },
    { sql: 'ALTER TABLE calendar_events ADD COLUMN description TEXT', table: 'calendar_events', column: 'description' },
    { sql: 'ALTER TABLE calendar_events ADD COLUMN article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL', table: 'calendar_events', column: 'article_id' },
    { sql: 'ALTER TABLE members ADD COLUMN is_content_admin INTEGER DEFAULT 0', table: 'members', column: 'is_content_admin' },
    { sql: "ALTER TABLE articles ADD COLUMN content_type TEXT DEFAULT 'markdown'", table: 'articles', column: 'content_type' },
    {
      sql: "ALTER TABLE events ADD COLUMN calendar_type_id TEXT NOT NULL DEFAULT 'other'",
      table: 'events',
      column: 'calendar_type_id',
    },
    { sql: 'ALTER TABLE events ADD COLUMN member_fee_minor INTEGER', table: 'events', column: 'member_fee_minor' },
  ];

  for (const migration of migrations) {
    try {
      await execSQL(db, migration.sql);
    } catch (e: unknown) {
      // Check if error is about column already existing or already dropped
      const errorMsg = e instanceof Error ? e.message : '';
      if (!errorMsg.includes('duplicate') && !errorMsg.includes('already exists') && !errorMsg.includes('SQLITE_ERROR') && !errorMsg.includes('does not exist') && !errorMsg.includes('no such column')) {
        // Re-throw if it's not a known benign error
        throw e;
      }
      // Otherwise ignore - column already exists or already dropped
    }
  }

  // Indexes that depend on migrated columns (safe on existing DBs)
  try {
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_spare_requests_league_id ON spare_requests(league_id);');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_spare_requests_game_id ON spare_requests(game_id);');
  } catch {
    // Ignore if DB doesn't support IF NOT EXISTS or column is missing for some reason
  }

  // Replace old compound index with date-only index after draw_time column removal
  try {
    await execSQL(db, 'DROP INDEX IF EXISTS idx_team_bye_requests_draw;');
    await execSQL(db, 'CREATE INDEX IF NOT EXISTS idx_team_bye_requests_draw_date ON team_bye_requests(draw_date);');
  } catch {
    // Ignore - index may not exist or already replaced
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
  } catch {
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
  } catch {
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
  } catch {
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

  // Calendar events (direct entries by Calendar Admin, Admin, or Server Admin)
  await execSQL(db, `
    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'direct' CHECK(source IN ('direct')),
      type_id TEXT NOT NULL,
      title TEXT NOT NULL,
      start_dt TEXT NOT NULL,
      end_dt TEXT NOT NULL,
      all_day INTEGER NOT NULL DEFAULT 0,
      recurrence_rule TEXT,
      parent_event_id INTEGER REFERENCES calendar_events(id) ON DELETE CASCADE,
      recurrence_date TEXT,
      article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
      created_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_events_start_dt ON calendar_events(start_dt);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_parent_id ON calendar_events(parent_event_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_recurrence_date ON calendar_events(parent_event_id, recurrence_date);

    CREATE TABLE IF NOT EXISTS calendar_event_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      location_type TEXT NOT NULL CHECK(location_type IN ('sheet', 'warm-room', 'exterior', 'offsite', 'virtual')),
      sheet_id INTEGER REFERENCES sheets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_event_locations_event_id ON calendar_event_locations(event_id);

    CREATE TABLE IF NOT EXISTS calendar_event_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      exception_date TEXT NOT NULL,
      UNIQUE(parent_event_id, exception_date)
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_event_exceptions_parent_id ON calendar_event_exceptions(parent_event_id);

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      content_type TEXT DEFAULT 'markdown' NOT NULL,
      content TEXT NOT NULL,
      snippet TEXT,
      featured INTEGER DEFAULT 0,
      featured_sort_order INTEGER DEFAULT 0,
      published_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
    CREATE INDEX IF NOT EXISTS idx_articles_featured ON articles(featured);
    CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);

    CREATE TABLE IF NOT EXISTS article_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      content_type TEXT DEFAULT 'markdown' NOT NULL,
      content TEXT NOT NULL,
      revision_note TEXT,
      is_small_edit INTEGER DEFAULT 0 NOT NULL,
      snippet TEXT,
      featured INTEGER DEFAULT 0 NOT NULL,
      published_at DATETIME,
      saved_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(article_id, version_number)
    );
    CREATE INDEX IF NOT EXISTS idx_article_versions_article_id ON article_versions(article_id);
    CREATE INDEX IF NOT EXISTS idx_article_versions_created_at ON article_versions(created_at);

    CREATE TABLE IF NOT EXISTS site_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      club_name TEXT,
      logo_url TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      footer_markdown TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO site_config (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS showcase_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      caption TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_showcase_images_sort_order ON showcase_images(sort_order);

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_type TEXT NOT NULL DEFAULT 'navbar',
      parent_id INTEGER REFERENCES menu_items(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      link_type TEXT CHECK(link_type IN ('internal', 'external')),
      url TEXT,
      open_in_new_tab INTEGER DEFAULT 0,
      article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
      use_article_title_for_label INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_menu_items_menu_type ON menu_items(menu_type);
    CREATE INDEX IF NOT EXISTS idx_menu_items_parent_id ON menu_items(parent_id);
    CREATE INDEX IF NOT EXISTS idx_menu_items_sort_order ON menu_items(sort_order);

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storage_key TEXT NOT NULL UNIQUE,
      original_filename TEXT NOT NULL,
      display_name TEXT,
      description TEXT,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'authenticated')),
      checksum_sha256 TEXT,
      thumbnail_storage_key TEXT,
      thumbnail_mime_type TEXT,
      thumbnail_byte_size INTEGER,
      thumbnail_checksum_sha256 TEXT,
      uploaded_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      suspected_orphan INTEGER NOT NULL DEFAULT 0,
      last_referenced_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_files_visibility ON files(visibility);
    CREATE INDEX IF NOT EXISTS idx_files_uploaded_by_member_id ON files(uploaded_by_member_id);
    CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at);
    CREATE INDEX IF NOT EXISTS idx_files_suspected_orphan ON files(suspected_orphan);
  `);

  await ensureRequestedForMemberIdColumn(db);
  await ensureMenuItemsArticleColumns(db);
  await ensureCalendarEventsArticleColumn(db);
  await ensureGameIdColumn(db);
  await ensureFilesThumbnailColumns(db);
  await ensureArticleVersionsRevisionNoteColumn(db);
  await ensureArticleVersionsSmallEditColumn(db);
  await ensureArticlesFeaturedSortOrderColumn(db);
  await ensureSponsorAdminAndSponsorshipTables(db);
  await ensureIceBookingsTable(db);
  await migrateIceBookingsGuestPurposeExpand(db);
  await ensureGovernanceTables(db);
  await ensureRbacTables(db);
  await ensurePaymentDomainTables(db);
  await ensureEventsTables(db);
  await ensurePermalinksTables(db);
  await ensurePermalinksLegacyClickCountColumn(db);
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
      social_member INTEGER DEFAULT 0 NOT NULL,
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

    -- League extra draws (one-off draw dates/times)
    CREATE TABLE IF NOT EXISTS league_extra_draws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      draw_date DATE NOT NULL,
      draw_time TIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      UNIQUE(league_id, draw_date, draw_time)
    );

    CREATE INDEX IF NOT EXISTS idx_league_extra_draws_league_id ON league_extra_draws(league_id);
    CREATE INDEX IF NOT EXISTS idx_league_extra_draws_date_time ON league_extra_draws(league_id, draw_date, draw_time);

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

    -- Draw sheet availability overrides
    CREATE TABLE IF NOT EXISTS draw_sheet_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      draw_date DATE NOT NULL,
      draw_time TIME NOT NULL,
      sheet_id INTEGER NOT NULL,
      is_available INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE,
      UNIQUE(league_id, draw_date, draw_time, sheet_id)
    );

    CREATE INDEX IF NOT EXISTS idx_draw_sheet_availability_league_id ON draw_sheet_availability(league_id);
    CREATE INDEX IF NOT EXISTS idx_draw_sheet_availability_draw ON draw_sheet_availability(league_id, draw_date, draw_time);
    CREATE INDEX IF NOT EXISTS idx_draw_sheet_availability_sheet_id ON draw_sheet_availability(sheet_id);

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
      prefer_late_draw INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      FOREIGN KEY (division_id) REFERENCES league_divisions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_league_teams_league_id ON league_teams(league_id);
    CREATE INDEX IF NOT EXISTS idx_league_teams_division_id ON league_teams(division_id);

    -- Games
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      team1_id INTEGER NOT NULL,
      team2_id INTEGER NOT NULL,
      game_date DATE,
      game_time TIME,
      sheet_id INTEGER,
      status TEXT NOT NULL DEFAULT 'unscheduled' CHECK(status IN ('scheduled', 'unscheduled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      FOREIGN KEY (team1_id) REFERENCES league_teams(id) ON DELETE RESTRICT,
      FOREIGN KEY (team2_id) REFERENCES league_teams(id) ON DELETE RESTRICT,
      FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_games_league_id ON games(league_id);
    CREATE INDEX IF NOT EXISTS idx_games_team1_id ON games(team1_id);
    CREATE INDEX IF NOT EXISTS idx_games_team2_id ON games(team2_id);
    CREATE INDEX IF NOT EXISTS idx_games_sheet_id ON games(sheet_id);
    CREATE INDEX IF NOT EXISTS idx_games_league_date_time ON games(league_id, game_date, game_time);
    CREATE UNIQUE INDEX IF NOT EXISTS games_sheet_date_time_unique ON games(sheet_id, game_date, game_time);

    -- League settings (ranking config, result labels)
    CREATE TABLE IF NOT EXISTS league_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL,
      head_to_head_first INTEGER DEFAULT 0,
      result_labels TEXT,
      collect_bye_requests INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
      UNIQUE(league_id)
    );
    CREATE INDEX IF NOT EXISTS idx_league_settings_league_id ON league_settings(league_id);

    -- Team bye requests (prioritized bye requests for schedule generation)
    CREATE TABLE IF NOT EXISTS team_bye_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      draw_date TEXT NOT NULL,
      priority INTEGER NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES league_teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_team_bye_requests_team_id ON team_bye_requests(team_id);
    CREATE INDEX IF NOT EXISTS idx_team_bye_requests_draw_date ON team_bye_requests(draw_date);

    -- Game results (tiebreaker values per team per game)
    CREATE TABLE IF NOT EXISTS game_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      result_order INTEGER NOT NULL,
      value INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES league_teams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_game_results_game_id ON game_results(game_id);
    CREATE INDEX IF NOT EXISTS idx_game_results_team_id ON game_results(team_id);
    CREATE INDEX IF NOT EXISTS idx_game_results_game_team ON game_results(game_id, team_id);

    -- Game lineups (who actually played, including spares)
    CREATE TABLE IF NOT EXISTS game_lineups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      is_spare INTEGER DEFAULT 0,
      sparing_for_member_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES league_teams(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      FOREIGN KEY (sparing_for_member_id) REFERENCES members(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_game_lineups_game_id ON game_lineups(game_id);
    CREATE INDEX IF NOT EXISTS idx_game_lineups_team_id ON game_lineups(team_id);
    CREATE INDEX IF NOT EXISTS idx_game_lineups_member_id ON game_lineups(member_id);
    CREATE INDEX IF NOT EXISTS idx_game_lineups_member_stats ON game_lineups(member_id);

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
      game_id INTEGER,
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
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL,
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
    'ALTER TABLE members ADD COLUMN social_member INTEGER DEFAULT 0 NOT NULL',
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
    'ALTER TABLE spare_requests ADD COLUMN game_id INTEGER REFERENCES games(id) ON DELETE SET NULL',
    'ALTER TABLE spare_request_invitations ADD COLUMN declined_at DATETIME',
    'ALTER TABLE spare_request_invitations ADD COLUMN decline_comment TEXT',
    'ALTER TABLE spare_requests ADD COLUMN all_invites_declined_notified INTEGER DEFAULT 0',
    'ALTER TABLE spare_requests ADD COLUMN notification_generation INTEGER DEFAULT 0',
    'ALTER TABLE league_settings ADD COLUMN collect_bye_requests INTEGER DEFAULT 1',
    'ALTER TABLE team_bye_requests DROP COLUMN draw_time',
    'ALTER TABLE league_teams ADD COLUMN prefer_late_draw INTEGER DEFAULT 0',
    'ALTER TABLE members ADD COLUMN is_calendar_admin INTEGER DEFAULT 0',
    'ALTER TABLE calendar_events ADD COLUMN description TEXT',
    'ALTER TABLE members ADD COLUMN is_content_admin INTEGER DEFAULT 0',
    "ALTER TABLE articles ADD COLUMN content_type TEXT DEFAULT 'markdown'",
    "ALTER TABLE events ADD COLUMN calendar_type_id TEXT NOT NULL DEFAULT 'other'",
    'ALTER TABLE events ADD COLUMN member_fee_minor INTEGER',
  ];

  for (const migrationSQL of migrations) {
    try {
      execSQLSync(db, migrationSQL);
    } catch (e: unknown) {
      // Ignore "column already exists" errors or "no such column" for DROP
      const errorMsg = e instanceof Error ? e.message : '';
      if (!errorMsg.includes('duplicate') && !errorMsg.includes('already exists') && !errorMsg.includes('SQLITE_ERROR') && !errorMsg.includes('no such column')) {
        // Re-throw if it's not a "column exists" or "no such column" error
        throw e;
      }
    }
  }

  // Indexes that depend on migrated columns (safe on existing DBs)
  try {
    execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_spare_requests_league_id ON spare_requests(league_id);');
    execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_spare_requests_game_id ON spare_requests(game_id);');
  } catch {
    // ignore
  }

  // Replace old compound index with date-only index after draw_time column removal
  try {
    execSQLSync(db, 'DROP INDEX IF EXISTS idx_team_bye_requests_draw;');
    execSQLSync(db, 'CREATE INDEX IF NOT EXISTS idx_team_bye_requests_draw_date ON team_bye_requests(draw_date);');
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

  // Calendar events
  execSQLSync(db, `
    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'direct' CHECK(source IN ('direct')),
      type_id TEXT NOT NULL,
      title TEXT NOT NULL,
      start_dt TEXT NOT NULL,
      end_dt TEXT NOT NULL,
      all_day INTEGER NOT NULL DEFAULT 0,
      recurrence_rule TEXT,
      parent_event_id INTEGER REFERENCES calendar_events(id) ON DELETE CASCADE,
      recurrence_date TEXT,
      article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
      created_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_events_start_dt ON calendar_events(start_dt);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_parent_id ON calendar_events(parent_event_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_recurrence_date ON calendar_events(parent_event_id, recurrence_date);

    CREATE TABLE IF NOT EXISTS calendar_event_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      location_type TEXT NOT NULL CHECK(location_type IN ('sheet', 'warm-room', 'exterior', 'offsite', 'virtual')),
      sheet_id INTEGER REFERENCES sheets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_event_locations_event_id ON calendar_event_locations(event_id);

    CREATE TABLE IF NOT EXISTS calendar_event_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      exception_date TEXT NOT NULL,
      UNIQUE(parent_event_id, exception_date)
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_event_exceptions_parent_id ON calendar_event_exceptions(parent_event_id);

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      content_type TEXT DEFAULT 'markdown' NOT NULL,
      content TEXT NOT NULL,
      snippet TEXT,
      featured INTEGER DEFAULT 0,
      featured_sort_order INTEGER DEFAULT 0,
      published_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
    CREATE INDEX IF NOT EXISTS idx_articles_featured ON articles(featured);
    CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);

    CREATE TABLE IF NOT EXISTS article_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      content_type TEXT DEFAULT 'markdown' NOT NULL,
      content TEXT NOT NULL,
      revision_note TEXT,
      is_small_edit INTEGER DEFAULT 0 NOT NULL,
      snippet TEXT,
      featured INTEGER DEFAULT 0 NOT NULL,
      published_at DATETIME,
      saved_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(article_id, version_number)
    );
    CREATE INDEX IF NOT EXISTS idx_article_versions_article_id ON article_versions(article_id);
    CREATE INDEX IF NOT EXISTS idx_article_versions_created_at ON article_versions(created_at);

    CREATE TABLE IF NOT EXISTS site_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      club_name TEXT,
      logo_url TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      footer_markdown TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO site_config (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS showcase_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      caption TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_showcase_images_sort_order ON showcase_images(sort_order);

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_type TEXT NOT NULL DEFAULT 'navbar',
      parent_id INTEGER REFERENCES menu_items(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      link_type TEXT CHECK(link_type IN ('internal', 'external')),
      url TEXT,
      open_in_new_tab INTEGER DEFAULT 0,
      article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
      use_article_title_for_label INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_menu_items_menu_type ON menu_items(menu_type);
    CREATE INDEX IF NOT EXISTS idx_menu_items_parent_id ON menu_items(parent_id);
    CREATE INDEX IF NOT EXISTS idx_menu_items_sort_order ON menu_items(sort_order);

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storage_key TEXT NOT NULL UNIQUE,
      original_filename TEXT NOT NULL,
      display_name TEXT,
      description TEXT,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'authenticated')),
      checksum_sha256 TEXT,
      thumbnail_storage_key TEXT,
      thumbnail_mime_type TEXT,
      thumbnail_byte_size INTEGER,
      thumbnail_checksum_sha256 TEXT,
      uploaded_by_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      suspected_orphan INTEGER NOT NULL DEFAULT 0,
      last_referenced_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_files_visibility ON files(visibility);
    CREATE INDEX IF NOT EXISTS idx_files_uploaded_by_member_id ON files(uploaded_by_member_id);
    CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at);
    CREATE INDEX IF NOT EXISTS idx_files_suspected_orphan ON files(suspected_orphan);
  `);

  ensureRequestedForMemberIdColumnSync(db);
  ensureMenuItemsArticleColumnsSync(db);
  ensureCalendarEventsArticleColumnSync(db);
  ensureGameIdColumnSync(db);
  ensureFilesThumbnailColumnsSync(db);
  ensureArticleVersionsRevisionNoteColumnSync(db);
  ensureArticleVersionsSmallEditColumnSync(db);
  ensureArticlesFeaturedSortOrderColumnSync(db);
  ensureSponsorAdminAndSponsorshipTablesSync(db);
  ensureIceBookingsTableSync(db);
  migrateIceBookingsGuestPurposeExpandSync(db);
  ensureGovernanceTablesSync(db);
  ensureRbacTablesSync(db);
  ensurePaymentDomainTablesSync(db);
  ensureEventsTablesSync(db);
  ensurePermalinksTablesSync(db);
  ensurePermalinksLegacyClickCountColumnSync(db);

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
  } catch {
    // Ignore migration errors - column might not exist yet or already migrated
    console.log('Admin migration skipped (may already be complete)');
  }
}
