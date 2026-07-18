import { sql } from 'drizzle-orm';
import { getDrizzleDb } from './drizzle-db.js';
import {
  migrateLegacyCalendarTypeId,
  serializeCalendarTypeIds,
} from '../services/eventCalendarTypes.js';

async function sqliteTableExists(tableName: string): Promise<boolean> {
  const { db } = getDrizzleDb();
  const result = await db.execute(
    sql.raw(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table'
        AND name = '${tableName}'
      LIMIT 1
    `),
  );
  const rows = (result as { rows?: unknown[] }).rows ?? result;
  return Array.isArray(rows) && rows.length > 0;
}

async function sqliteColumnNames(tableName: string): Promise<Set<string>> {
  const { db } = getDrizzleDb();
  const result = await db.execute(sql.raw(`PRAGMA table_info(${tableName})`));
  const rows = (result as { rows?: Array<{ name?: string | null }> }).rows ?? result;
  const names = new Set<string>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row.name) names.add(row.name);
    }
  }
  return names;
}

/**
 * Migrate single calendar_type_id → calendar_type_ids JSON + tournament_format
 * before drizzle-kit push drops the legacy column on SQLite.
 */
export async function migrateEventCalendarTypesToMultiSelectSqlite(): Promise<void> {
  if (!(await sqliteTableExists('events'))) {
    return;
  }

  const columns = await sqliteColumnNames('events');
  const { db } = getDrizzleDb();

  if (!columns.has('calendar_type_ids')) {
    await db.execute(sql.raw(`ALTER TABLE events ADD COLUMN calendar_type_ids text DEFAULT '[]' NOT NULL`));
  }
  if (!columns.has('tournament_format')) {
    await db.execute(sql.raw(`ALTER TABLE events ADD COLUMN tournament_format text`));
  }

  if (!columns.has('calendar_type_id')) {
    return;
  }

  const result = await db.execute(
    sql.raw(`SELECT id, calendar_type_id, calendar_type_ids, tournament_format FROM events`),
  );
  const rows = ((result as { rows?: unknown[] }).rows ?? result) as Array<{
    id: number;
    calendar_type_id: string | null;
    calendar_type_ids: string | null;
    tournament_format: string | null;
  }>;

  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  let updated = 0;
  for (const row of rows) {
    const existingIds = (row.calendar_type_ids ?? '').trim();
    const alreadyMigrated = existingIds.startsWith('[') && existingIds !== '[]';
    if (alreadyMigrated && row.tournament_format != null) {
      continue;
    }

    const legacy = migrateLegacyCalendarTypeId(row.calendar_type_id);
    // Prefer existing format if already set (e.g. mid-migration).
    const format = row.tournament_format === 'fours' || row.tournament_format === 'doubles'
      ? row.tournament_format
      : legacy.tournamentFormat;
    const typeIdsJson = alreadyMigrated ? existingIds : serializeCalendarTypeIds(legacy.typeIds);
    const formatSql = format == null ? 'NULL' : `'${format}'`;

    await db.execute(
      sql.raw(`
        UPDATE events
        SET calendar_type_ids = '${typeIdsJson.replace(/'/g, "''")}',
            tournament_format = ${formatSql}
        WHERE id = ${Number(row.id)}
      `),
    );
    updated += 1;
  }

  if (updated > 0) {
    console.log(`Migrated ${updated} SQLite event(s) to multi-select calendar types`);
  }
}
