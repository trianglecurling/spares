import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from 'drizzle-orm';
import type { DatabaseConfig } from './config.js';
import { getDrizzleDb } from './drizzle-db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.join(__dirname, '../../drizzle');

const MIGRATIONS_SCHEMA = 'public';
const MIGRATIONS_TABLE = '__drizzle_migrations';

function isSqliteIncompatibleMigrationStatement(statement: string): boolean {
  return /\bALTER\s+COLUMN\b/i.test(statement);
}

/** Migrations already satisfied by the legacy createSchema bootstrap on existing DBs. */
const LEGACY_BASELINE_TAGS = new Set(['0000_furry_annihilus']);

type JournalEntry = {
  idx: number;
  tag: string;
  when: number;
};

type MigrationJournal = {
  entries: JournalEntry[];
};

type MigrationFile = {
  tag: string;
  when: number;
  hash: string;
  statements: string[];
};

function readJournal(): MigrationJournal {
  const journalPath = path.join(drizzleDir, 'meta/_journal.json');
  return JSON.parse(fs.readFileSync(journalPath, 'utf8')) as MigrationJournal;
}

function readMigrationFile(entry: JournalEntry): MigrationFile {
  const filePath = path.join(drizzleDir, `${entry.tag}.sql`);
  const contents = fs.readFileSync(filePath, 'utf8');
  return {
    tag: entry.tag,
    when: entry.when,
    hash: createHash('sha256').update(contents).digest('hex'),
    statements: contents
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean),
  };
}

async function tableExists(tableName: string): Promise<boolean> {
  const { db } = getDrizzleDb();
  const result = await db.execute(
    sql.raw(`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = '${MIGRATIONS_SCHEMA}'
        AND table_name = '${tableName}'
      LIMIT 1
    `)
  );
  const rows = (result as { rows?: unknown[] }).rows ?? result;
  return Array.isArray(rows) && rows.length > 0;
}

async function ensureMigrationsTable(): Promise<void> {
  const { db } = getDrizzleDb();
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `));
}

async function latestAppliedMigrationWhen(): Promise<number | null> {
  const { db } = getDrizzleDb();
  if (!(await tableExists(MIGRATIONS_TABLE))) {
    return null;
  }
  const result = await db.execute(
    sql.raw(`SELECT created_at FROM ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`)
  );
  const rows = (result as { rows?: Array<{ created_at?: string | number | null }> }).rows ?? result;
  if (!Array.isArray(rows) || rows.length === 0 || rows[0]?.created_at == null) {
    return null;
  }
  return Number(rows[0].created_at);
}

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

/**
 * Marks existing Drizzle journal migrations as applied when the database was
 * created by the legacy createSchema bootstrap (no __drizzle_migrations table).
 */
export async function baselineExistingPostgresDatabaseIfNeeded(): Promise<void> {
  if (!(await tableExists('members'))) {
    return;
  }

  await ensureMigrationsTable();
  const latestWhen = await latestAppliedMigrationWhen();
  if (latestWhen != null) {
    return;
  }

  const { db } = getDrizzleDb();
  const journal = readJournal();
  for (const entry of journal.entries) {
    if (!LEGACY_BASELINE_TAGS.has(entry.tag)) {
      continue;
    }
    const migration = readMigrationFile(entry);
    await db.execute(
      sql.raw(`
        INSERT INTO ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (hash, created_at)
        VALUES ('${migration.hash}', ${migration.when})
      `)
    );
    console.log(`Baselined migration ${entry.tag}`);
  }
}

async function ensureSqliteEventsPointOfContactColumn(): Promise<void> {
  if (!(await sqliteTableExists('events'))) {
    return;
  }

  const { db } = getDrizzleDb();
  const result = await db.execute(sql.raw(`PRAGMA table_info(events)`));
  const rows = (result as { rows?: Array<{ name?: string | null }> }).rows ?? result;
  if (!Array.isArray(rows)) {
    return;
  }
  if (rows.some((column) => column.name === 'point_of_contact')) {
    return;
  }

  const migration = readMigrationFile({
    idx: 17,
    tag: '0017_add_events_point_of_contact',
    when: 1780352498458,
  });
  for (const statement of migration.statements) {
    if (isSqliteIncompatibleMigrationStatement(statement)) {
      continue;
    }
    await db.execute(sql.raw(statement));
  }
  console.log('Applied SQLite data migration 0017_add_events_point_of_contact');
}

async function applyPendingPostgresMigrations(): Promise<void> {
  await ensureMigrationsTable();
  const latestWhen = await latestAppliedMigrationWhen();
  const journal = readJournal();
  const { db } = getDrizzleDb();

  for (const entry of journal.entries) {
    const migration = readMigrationFile(entry);
    if (latestWhen != null && migration.when <= latestWhen) {
      continue;
    }

    for (const statement of migration.statements) {
      await db.execute(sql.raw(statement));
    }

    await db.execute(
      sql.raw(`
        INSERT INTO ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (hash, created_at)
        VALUES ('${migration.hash}', ${migration.when})
      `)
    );
    console.log(`Applied migration ${entry.tag}`);
  }
}

async function spawnDrizzleKit(args: string[]): Promise<void> {
  const proc = Bun.spawn(['bunx', 'drizzle-kit', ...args], {
    cwd: path.join(__dirname, '../..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  if (exitCode !== 0) {
    const detail = [stdout, stderr].filter(Boolean).join('\n').trim();
    throw new Error(`drizzle-kit ${args.join(' ')} failed with exit code ${exitCode}${detail ? `: ${detail}` : ''}`);
  }
}

export async function runDrizzleMigrations(config: DatabaseConfig): Promise<void> {
  if (config.type === 'sqlite') {
    await ensureSqliteEventsPointOfContactColumn();
    await spawnDrizzleKit(['push', '--force']);
    return;
  }

  await baselineExistingPostgresDatabaseIfNeeded();
  await applyPendingPostgresMigrations();
}
