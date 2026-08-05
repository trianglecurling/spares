import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { getDrizzleDb } from './drizzle-db.js';

async function sqliteTableExists(tableName: string): Promise<boolean> {
  const { db } = getDrizzleDb();
  const result = await db.execute(
    sql.raw(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table'
        AND name = '${tableName}'
      LIMIT 1
    `)
  );
  const rows = (result as { rows?: unknown[] }).rows ?? result;
  return Array.isArray(rows) && rows.length > 0;
}

async function sqliteColumnExists(tableName: string, columnName: string): Promise<boolean> {
  const { db } = getDrizzleDb();
  const result = await db.execute(sql.raw(`PRAGMA table_info(${tableName})`));
  const rows = (result as { rows?: Array<{ name?: string | null }> }).rows ?? result;
  if (!Array.isArray(rows)) return false;
  return rows.some((column) => String(column.name) === columnName);
}

/**
 * Ensures SQLite has transfer-group / field_key columns before drizzle-kit push,
 * and backfills stable field keys for existing registration fields.
 */
export async function migrateEventTransferGroupsSqlite(): Promise<void> {
  if (!(await sqliteTableExists('events'))) {
    return;
  }

  const { db } = getDrizzleDb();

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS event_transfer_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `));

  if (!(await sqliteColumnExists('events', 'transfer_group_id'))) {
    await db.execute(sql.raw(`
      ALTER TABLE events
      ADD COLUMN transfer_group_id INTEGER REFERENCES event_transfer_groups(id) ON DELETE SET NULL
    `));
  }
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_events_transfer_group_id ON events(transfer_group_id)`));

  if (!(await sqliteTableExists('event_registration_fields'))) {
    return;
  }

  if (!(await sqliteColumnExists('event_registration_fields', 'field_key'))) {
    await db.execute(sql.raw(`ALTER TABLE event_registration_fields ADD COLUMN field_key TEXT`));
  }

  const missingKeys = await db.execute(
    sql.raw(`
      SELECT id
      FROM event_registration_fields
      WHERE field_key IS NULL OR trim(field_key) = ''
    `)
  );
  const rows = ((missingKeys as { rows?: Array<{ id?: number }> }).rows ?? missingKeys) as Array<{ id?: number }>;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.id == null) continue;
    const key = randomUUID();
    await db.execute(
      sql.raw(`UPDATE event_registration_fields SET field_key = '${key}' WHERE id = ${Number(row.id)}`)
    );
  }

  console.log('Applied SQLite data migration for event transfer groups / field_key');
}
