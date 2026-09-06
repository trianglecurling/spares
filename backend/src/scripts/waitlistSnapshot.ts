/**
 * Snapshot and restore league waitlist state (containers, entries, offers, audit,
 * frozen counts, league assignments, and outbound-message links).
 *
 * Postgres only. Uses the current DB profile (`db-config.json`, or
 * `DB_CONFIG_PROFILE=preview` → `db-config.preview.json`).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool, type PoolClient } from 'pg';
import type { DatabaseConfig } from '../db/config.js';
import { getDatabaseConfig, getDatabaseConfigFilePath } from '../db/config.js';
import { getDatabaseConfigProfile } from '../db-config-path.js';

export const WAITLIST_SNAPSHOT_VERSION = 1;
export const WAITLIST_SNAPSHOT_KIND = 'league-waitlists';

export const WAITLIST_TABLES = [
  'league_waitlists',
  'waitlist_entries',
  'waitlist_offers',
  'waitlist_audit_events',
] as const;

export type WaitlistTableName = (typeof WAITLIST_TABLES)[number];

const INSERT_BATCH_SIZE = 100;
const SNAPSHOT_FILE_PATTERN = /^(.+)-waitlists-(.+)\.json$/;

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export type PostgresConfig = NonNullable<DatabaseConfig['postgres']>;

export type ColumnMeta = {
  name: string;
  formattedType: string;
  udtName: string;
  isIdentity: boolean;
};

export type SnapshotTable = {
  name: WaitlistTableName;
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
};

export type LeagueWaitlistAssignment = {
  leagueId: number;
  leagueName: string;
  waitlistId: number;
};

export type OutboundMessageLink = {
  id: number;
  waitlistOfferId: number | null;
  waitlistEntryId: number | null;
};

export type WaitlistQueueSummary = {
  waitlistId: number;
  name: string;
  status: string;
  frozenEntryCount: number;
  leagueIds: number[];
  leagueNames: string[];
  activeEntries: Array<{
    id: number;
    memberId: number;
    status: string;
    positionSortKey: string;
    storedPosition: number;
    frozen: boolean;
  }>;
};

export type WaitlistSnapshotFile = {
  version: number;
  kind: typeof WAITLIST_SNAPSHOT_KIND;
  createdAt: string;
  profile: string;
  database: {
    type: 'postgres';
    host: string;
    port: number;
    name: string;
    username: string;
  };
  counts: Record<string, number>;
  tables: SnapshotTable[];
  leagueWaitlistAssignments: LeagueWaitlistAssignment[];
  outboundMessageLinks: OutboundMessageLink[];
  queues: WaitlistQueueSummary[];
};

export type LoadedProfile = {
  profile: string;
  configPath: string;
  postgres: PostgresConfig;
};

export function defaultSnapshotDir(): string {
  return path.join(backendRoot, 'data', 'waitlist-snapshots');
}

export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function timestampForFileName(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function snapshotFileName(profile: string, stamp: string, suffix = ''): string {
  return `${profile}-waitlists-${stamp}${suffix}.json`;
}

export function isPreRestoreSnapshotFile(fileName: string): boolean {
  return fileName.includes('-pre-restore');
}

export function parseSnapshotFileName(fileName: string): { profile: string; stamp: string } | null {
  const match = fileName.match(SNAPSHOT_FILE_PATTERN);
  if (!match) return null;
  return { profile: match[1]!, stamp: match[2]! };
}

export function findLatestSnapshotFile(dir: string, profile?: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const candidates = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => !isPreRestoreSnapshotFile(name))
    .map((name) => ({ name, parsed: parseSnapshotFileName(name) }))
    .filter((entry): entry is { name: string; parsed: { profile: string; stamp: string } } => entry.parsed != null)
    .filter((entry) => (profile ? entry.parsed.profile === profile : true))
    .sort((a, b) => a.parsed.stamp.localeCompare(b.parsed.stamp));
  const latest = candidates[candidates.length - 1];
  return latest ? path.join(dir, latest.name) : null;
}

export function argvFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

export function argvValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

export function serializeCell(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function deserializeCell(value: unknown, column: ColumnMeta): unknown {
  if (value == null) return null;
  const type = `${column.formattedType} ${column.udtName}`.toLowerCase();
  if (type.includes('timestamp') || type === 'date date' || column.udtName === 'date') {
    return value instanceof Date ? value : new Date(String(value));
  }
  if (column.udtName === 'jsonb' || column.udtName === 'json' || type.includes('json')) {
    return typeof value === 'string' ? JSON.parse(value) : value;
  }
  return value;
}

export function insertSql(table: string, columns: string[], rowCount: number, hasIdentity: boolean): string {
  const qualified = quoteIdent(table);
  const columnList = columns.map(quoteIdent).join(', ');
  const overriding = hasIdentity ? ' OVERRIDING SYSTEM VALUE' : '';
  const values = Array.from({ length: rowCount }, (_, rowIndex) => {
    const placeholders = columns.map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`);
    return `(${placeholders.join(', ')})`;
  });
  return `INSERT INTO ${qualified} (${columnList})${overriding} VALUES ${values.join(', ')}`;
}

export function buildSummaryMarkdown(snapshot: WaitlistSnapshotFile): string {
  const lines: string[] = [
    '# Waitlist snapshot',
    '',
    `- Created: ${snapshot.createdAt}`,
    `- Profile: ${snapshot.profile}`,
    `- Database: ${snapshot.database.username}@${snapshot.database.host}:${snapshot.database.port}/${snapshot.database.name}`,
    `- Waitlists: ${snapshot.counts.league_waitlists ?? 0}`,
    `- Entries: ${snapshot.counts.waitlist_entries ?? 0}`,
    `- Offers: ${snapshot.counts.waitlist_offers ?? 0}`,
    `- Audit events: ${snapshot.counts.waitlist_audit_events ?? 0}`,
    `- League assignments: ${snapshot.counts.leagueWaitlistAssignments ?? 0}`,
    `- Outbound message links: ${snapshot.counts.outboundMessageLinks ?? 0}`,
    '',
    '## Waitlists',
    '',
    '| id | name | status | frozen | active entries | leagues |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const queue of snapshot.queues) {
    lines.push(
      `| ${queue.waitlistId} | ${escapeMarkdownCell(queue.name)} | ${queue.status} | ${queue.frozenEntryCount} | ${queue.activeEntries.length} | ${escapeMarkdownCell(queue.leagueNames.join(', '))} |`,
    );
  }
  if (snapshot.queues.length === 0) {
    lines.push('| *(none)* | | | | | |');
  }
  lines.push('', '## Stored active order', '');
  for (const queue of snapshot.queues) {
    lines.push(`### ${queue.name} (id ${queue.waitlistId})`);
    lines.push('');
    if (queue.activeEntries.length === 0) {
      lines.push('_No active entries._', '');
      continue;
    }
    lines.push('| pos | frozen | entry id | member id | status | sort key |', '| --- | --- | --- | --- | --- | --- |');
    for (const entry of queue.activeEntries) {
      lines.push(
        `| ${entry.storedPosition} | ${entry.frozen ? 'yes' : ''} | ${entry.id} | ${entry.memberId} | ${entry.status} | ${escapeMarkdownCell(entry.positionSortKey)} |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function loadCurrentPostgresProfile(): LoadedProfile {
  const profile = getDatabaseConfigProfile() ?? 'default';
  const configPath = getDatabaseConfigFilePath();
  const config = getDatabaseConfig();
  if (!config) {
    throw new Error(`Database config not found: ${configPath}`);
  }
  if (config.type !== 'postgres' || !config.postgres) {
    throw new Error(`Waitlist snapshot/restore requires Postgres. ${configPath} is ${config.type}.`);
  }
  const postgres = config.postgres;
  if (!postgres.host || !postgres.database || !postgres.username) {
    throw new Error(`${configPath} is missing host, database, or username`);
  }
  return { profile, configPath, postgres };
}

export function describeTarget(loaded: LoadedProfile): string {
  const { host, port, database, username } = loaded.postgres;
  return `${username}@${host}:${port ?? 5432}/${database}`;
}

export function createPool(postgres: PostgresConfig): Pool {
  return new Pool({
    host: postgres.host,
    port: postgres.port ?? 5432,
    database: postgres.database,
    user: postgres.username,
    password: postgres.password,
    ssl: postgres.ssl ? { rejectUnauthorized: false } : false,
  });
}

export function isWaitlistSnapshot(value: unknown): value is WaitlistSnapshotFile {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as WaitlistSnapshotFile;
  return (
    snapshot.version === WAITLIST_SNAPSHOT_VERSION &&
    snapshot.kind === WAITLIST_SNAPSHOT_KIND &&
    Array.isArray(snapshot.tables) &&
    Array.isArray(snapshot.leagueWaitlistAssignments) &&
    Array.isArray(snapshot.outboundMessageLinks)
  );
}

export function loadSnapshotFile(filePath: string): WaitlistSnapshotFile {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Snapshot file not found: ${filePath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  if (!isWaitlistSnapshot(parsed)) {
    throw new Error(`Not a waitlist snapshot (expected version ${WAITLIST_SNAPSHOT_VERSION} ${WAITLIST_SNAPSHOT_KIND}): ${filePath}`);
  }
  return parsed;
}

async function listColumns(client: Pool | PoolClient, table: string): Promise<ColumnMeta[]> {
  const result = await client.query<{
    name: string;
    identity: string;
    formattedType: string;
    udtName: string;
  }>(
    `
      SELECT
        a.attname AS name,
        a.attidentity AS identity,
        format_type(a.atttypid, a.atttypmod) AS "formattedType",
        t.typname AS "udtName"
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
      WHERE n.nspname = 'public'
        AND c.relname = $1
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attgenerated = ''
      ORDER BY a.attnum
    `,
    [table],
  );
  if (result.rows.length === 0) {
    throw new Error(`Table public.${table} was not found`);
  }
  return result.rows.map((row) => ({
    name: row.name,
    formattedType: row.formattedType,
    udtName: row.udtName,
    isIdentity: row.identity !== '',
  }));
}

async function dumpTable(client: Pool | PoolClient, name: WaitlistTableName): Promise<SnapshotTable> {
  const columns = await listColumns(client, name);
  const columnList = columns.map((column) => quoteIdent(column.name)).join(', ');
  const orderBy = columns.some((column) => column.name === 'id') ? 'id' : columns[0]!.name;
  const result = await client.query(`SELECT ${columnList} FROM ${quoteIdent(name)} ORDER BY ${quoteIdent(orderBy)}`);
  const rows = result.rows.map((row) => {
    const serialized: Record<string, unknown> = {};
    for (const column of columns) {
      serialized[column.name] = serializeCell(row[column.name]);
    }
    return serialized;
  });
  return { name, columns, rows };
}

function compareStoredOrder(a: { positionSortKey: string; id: number }, b: { positionSortKey: string; id: number }): number {
  if (a.positionSortKey !== b.positionSortKey) {
    return a.positionSortKey < b.positionSortKey ? -1 : 1;
  }
  return a.id - b.id;
}

function buildQueues(
  waitlists: SnapshotTable,
  entries: SnapshotTable,
  assignments: LeagueWaitlistAssignment[],
): WaitlistQueueSummary[] {
  const leaguesByWaitlist = new Map<number, LeagueWaitlistAssignment[]>();
  for (const assignment of assignments) {
    const list = leaguesByWaitlist.get(assignment.waitlistId) ?? [];
    list.push(assignment);
    leaguesByWaitlist.set(assignment.waitlistId, list);
  }

  const entriesByWaitlist = new Map<number, Array<{ id: number; memberId: number; status: string; positionSortKey: string }>>();
  for (const row of entries.rows) {
    const waitlistId = Number(row.waitlist_id);
    const status = String(row.status ?? '');
    if (status !== 'active') continue;
    const list = entriesByWaitlist.get(waitlistId) ?? [];
    list.push({
      id: Number(row.id),
      memberId: Number(row.member_id),
      status,
      positionSortKey: String(row.position_sort_key ?? ''),
    });
    entriesByWaitlist.set(waitlistId, list);
  }

  return waitlists.rows
    .map((row) => {
      const waitlistId = Number(row.id);
      const frozenEntryCount = Number(row.frozen_entry_count ?? 0);
      const leagues = leaguesByWaitlist.get(waitlistId) ?? [];
      const stored = [...(entriesByWaitlist.get(waitlistId) ?? [])].sort(compareStoredOrder);
      const frozenCount = Math.min(Math.max(0, frozenEntryCount), stored.length);
      return {
        waitlistId,
        name: String(row.name ?? ''),
        status: String(row.status ?? ''),
        frozenEntryCount,
        leagueIds: leagues.map((league) => league.leagueId),
        leagueNames: leagues.map((league) => league.leagueName),
        activeEntries: stored.map((entry, index) => ({
          id: entry.id,
          memberId: entry.memberId,
          status: entry.status,
          positionSortKey: entry.positionSortKey,
          storedPosition: index + 1,
          frozen: index < frozenCount,
        })),
      };
    })
    .sort((a, b) => a.waitlistId - b.waitlistId);
}

export async function captureWaitlistSnapshot(
  client: Pool | PoolClient,
  loaded: LoadedProfile,
): Promise<WaitlistSnapshotFile> {
  const tables: SnapshotTable[] = [];
  for (const name of WAITLIST_TABLES) {
    tables.push(await dumpTable(client, name));
  }

  const assignmentResult = await client.query<{ league_id: number; league_name: string; waitlist_id: number }>(`
    SELECT id AS league_id, name AS league_name, waitlist_id
    FROM leagues
    WHERE waitlist_id IS NOT NULL
    ORDER BY id
  `);
  const leagueWaitlistAssignments: LeagueWaitlistAssignment[] = assignmentResult.rows.map((row) => ({
    leagueId: row.league_id,
    leagueName: row.league_name,
    waitlistId: row.waitlist_id,
  }));

  const linkResult = await client.query<{
    id: number;
    waitlist_offer_id: number | null;
    waitlist_entry_id: number | null;
  }>(`
    SELECT id, waitlist_offer_id, waitlist_entry_id
    FROM registration_outbound_messages
    WHERE waitlist_offer_id IS NOT NULL OR waitlist_entry_id IS NOT NULL
    ORDER BY id
  `);
  const outboundMessageLinks: OutboundMessageLink[] = linkResult.rows.map((row) => ({
    id: row.id,
    waitlistOfferId: row.waitlist_offer_id,
    waitlistEntryId: row.waitlist_entry_id,
  }));

  const tableByName = new Map(tables.map((table) => [table.name, table]));
  const queues = buildQueues(
    tableByName.get('league_waitlists')!,
    tableByName.get('waitlist_entries')!,
    leagueWaitlistAssignments,
  );

  const counts: Record<string, number> = {
    leagueWaitlistAssignments: leagueWaitlistAssignments.length,
    outboundMessageLinks: outboundMessageLinks.length,
  };
  for (const table of tables) {
    counts[table.name] = table.rows.length;
  }

  return {
    version: WAITLIST_SNAPSHOT_VERSION,
    kind: WAITLIST_SNAPSHOT_KIND,
    createdAt: new Date().toISOString(),
    profile: loaded.profile,
    database: {
      type: 'postgres',
      host: loaded.postgres.host,
      port: loaded.postgres.port ?? 5432,
      name: loaded.postgres.database,
      username: loaded.postgres.username,
    },
    counts,
    tables,
    leagueWaitlistAssignments,
    outboundMessageLinks,
    queues,
  };
}

export function writeSnapshotFiles(snapshot: WaitlistSnapshotFile, filePath: string): { jsonPath: string; summaryPath: string } {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  const summaryPath = filePath.replace(/\.json$/i, '.md');
  fs.writeFileSync(summaryPath, buildSummaryMarkdown(snapshot), 'utf8');
  return { jsonPath: filePath, summaryPath };
}

export async function snapshotWaitlists(input: {
  loaded: LoadedProfile;
  outputPath: string;
}): Promise<{ snapshot: WaitlistSnapshotFile; jsonPath: string; summaryPath: string }> {
  const pool = createPool(input.loaded.postgres);
  try {
    const client = await pool.connect();
    try {
      const snapshot = await captureWaitlistSnapshot(client, input.loaded);
      const written = writeSnapshotFiles(snapshot, input.outputPath);
      return { snapshot, ...written };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

function tableFromSnapshot(snapshot: WaitlistSnapshotFile, name: WaitlistTableName): SnapshotTable {
  const table = snapshot.tables.find((entry) => entry.name === name);
  if (!table) {
    throw new Error(`Snapshot is missing table ${name}`);
  }
  return table;
}

function overlappingColumns(snapshotColumns: ColumnMeta[], liveColumns: ColumnMeta[]): ColumnMeta[] {
  const liveByName = new Map(liveColumns.map((column) => [column.name, column]));
  const overlap: ColumnMeta[] = [];
  for (const column of snapshotColumns) {
    const live = liveByName.get(column.name);
    if (live) overlap.push(live);
  }
  return overlap;
}

async function insertTable(
  client: PoolClient,
  table: SnapshotTable,
  liveColumns: ColumnMeta[],
): Promise<{ inserted: number; skippedColumns: string[]; missingLiveColumns: string[] }> {
  const overlap = overlappingColumns(table.columns, liveColumns);
  const skippedColumns = table.columns
    .map((column) => column.name)
    .filter((name) => !overlap.some((column) => column.name === name));
  const missingLiveColumns = liveColumns
    .map((column) => column.name)
    .filter((name) => !table.columns.some((column) => column.name === name));
  if (overlap.length === 0) {
    throw new Error(`No overlapping columns to restore into ${table.name}`);
  }
  if (!overlap.some((column) => column.name === 'id') && table.rows.length > 0) {
    throw new Error(`Cannot restore ${table.name} without an id column`);
  }

  const hasIdentity = overlap.some((column) => column.isIdentity);
  const columnNames = overlap.map((column) => column.name);
  let inserted = 0;
  for (let index = 0; index < table.rows.length; index += INSERT_BATCH_SIZE) {
    const batch = table.rows.slice(index, index + INSERT_BATCH_SIZE);
    const sql = insertSql(table.name, columnNames, batch.length, hasIdentity);
    const values = batch.flatMap((row) =>
      overlap.map((column) => deserializeCell(row[column.name], column)),
    );
    await client.query(sql, values);
    inserted += batch.length;
  }
  return { inserted, skippedColumns, missingLiveColumns };
}

async function resetIdentity(client: PoolClient, table: string, idColumn: string): Promise<void> {
  const seq = await client.query<{ seq: string | null }>(`SELECT pg_get_serial_sequence($1, $2) AS seq`, [
    `public.${table}`,
    idColumn,
  ]);
  const sequenceName = seq.rows[0]?.seq;
  if (!sequenceName) return;
  const max = await client.query<{ max: string | null }>(
    `SELECT MAX(${quoteIdent(idColumn)})::text AS max FROM ${quoteIdent(table)}`,
  );
  const maxId = max.rows[0]?.max;
  if (maxId == null) {
    await client.query('SELECT setval($1::regclass, 1, false)', [sequenceName]);
    return;
  }
  await client.query('SELECT setval($1::regclass, $2, true)', [sequenceName, Number(maxId)]);
}

export async function restoreWaitlists(input: {
  loaded: LoadedProfile;
  snapshot: WaitlistSnapshotFile;
  backupPath?: string;
}): Promise<{
  restored: Record<string, number>;
  skippedColumns: Record<string, string[]>;
  missingLiveColumns: Record<string, string[]>;
  restoredAssignments: number;
  missingLeagues: number[];
  restoredMessageLinks: number;
  missingMessages: number[];
  backupPath?: string;
}> {
  for (const name of WAITLIST_TABLES) {
    tableFromSnapshot(input.snapshot, name);
  }

  const pool = createPool(input.loaded.postgres);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query(`
        LOCK TABLE
          league_waitlists,
          waitlist_entries,
          waitlist_offers,
          waitlist_audit_events,
          leagues,
          registration_outbound_messages
        IN ACCESS EXCLUSIVE MODE
      `);

      let backupPath: string | undefined;
      if (input.backupPath) {
        const backup = await captureWaitlistSnapshot(client, input.loaded);
        backupPath = writeSnapshotFiles(backup, input.backupPath).jsonPath;
      }

      const liveColumns = new Map<WaitlistTableName, ColumnMeta[]>();
      for (const name of WAITLIST_TABLES) {
        liveColumns.set(name, await listColumns(client, name));
      }

      // TRUNCATE cannot be used: leagues.waitlist_id and registration_outbound_messages
      // still have FK references even after those columns are nulled.
      await client.query('DELETE FROM waitlist_audit_events');
      await client.query('DELETE FROM waitlist_offers');
      await client.query('DELETE FROM waitlist_entries');
      await client.query('DELETE FROM league_waitlists');

      const restored: Record<string, number> = {};
      const skippedColumns: Record<string, string[]> = {};
      const missingLiveColumns: Record<string, string[]> = {};
      for (const name of WAITLIST_TABLES) {
        const result = await insertTable(client, tableFromSnapshot(input.snapshot, name), liveColumns.get(name)!);
        restored[name] = result.inserted;
        if (result.skippedColumns.length > 0) skippedColumns[name] = result.skippedColumns;
        if (result.missingLiveColumns.length > 0) missingLiveColumns[name] = result.missingLiveColumns;
      }

      for (const name of WAITLIST_TABLES) {
        const columns = liveColumns.get(name)!;
        if (columns.some((column) => column.name === 'id' && column.isIdentity)) {
          await resetIdentity(client, name, 'id');
        }
      }

      let restoredAssignments = 0;
      const missingLeagues: number[] = [];
      for (const assignment of input.snapshot.leagueWaitlistAssignments) {
        const result = await client.query(`UPDATE leagues SET waitlist_id = $1 WHERE id = $2`, [
          assignment.waitlistId,
          assignment.leagueId,
        ]);
        if ((result.rowCount ?? 0) === 0) {
          missingLeagues.push(assignment.leagueId);
        } else {
          restoredAssignments += 1;
        }
      }

      let restoredMessageLinks = 0;
      const missingMessages: number[] = [];
      for (const link of input.snapshot.outboundMessageLinks) {
        const result = await client.query(
          `UPDATE registration_outbound_messages SET waitlist_offer_id = $1, waitlist_entry_id = $2 WHERE id = $3`,
          [link.waitlistOfferId, link.waitlistEntryId, link.id],
        );
        if ((result.rowCount ?? 0) === 0) {
          missingMessages.push(link.id);
        } else {
          restoredMessageLinks += 1;
        }
      }

      await client.query('COMMIT');
      return {
        restored,
        skippedColumns,
        missingLiveColumns,
        restoredAssignments,
        missingLeagues,
        restoredMessageLinks,
        missingMessages,
        backupPath,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

export async function currentWaitlistCounts(loaded: LoadedProfile): Promise<Record<string, number>> {
  const pool = createPool(loaded.postgres);
  try {
    const counts: Record<string, number> = {};
    for (const name of WAITLIST_TABLES) {
      const result = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${quoteIdent(name)}`);
      counts[name] = Number(result.rows[0]?.n ?? 0);
    }
    const assignments = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM leagues WHERE waitlist_id IS NOT NULL`);
    const links = await pool.query<{ n: string }>(`
      SELECT COUNT(*)::text AS n
      FROM registration_outbound_messages
      WHERE waitlist_offer_id IS NOT NULL OR waitlist_entry_id IS NOT NULL
    `);
    counts.leagueWaitlistAssignments = Number(assignments.rows[0]?.n ?? 0);
    counts.outboundMessageLinks = Number(links.rows[0]?.n ?? 0);
    return counts;
  } finally {
    await pool.end();
  }
}

export function snapshotUsage(): string {
  return `Create a full snapshot of league waitlists (entries, frozen counts, offers, audit history).

Usage:
  bun run db:snapshot-waitlists
  bun run db:snapshot-waitlists -- --file path.json
  bun run db:snapshot-waitlists -- --dry-run

Options:
  --file <path>         Output JSON path (default: backend/data/waitlist-snapshots/<profile>-waitlists-<timestamp>.json)
  --output-dir <dir>    Directory for the default filename
  --dry-run             Connect and print counts only
  --help                Show this message

Uses the current DB profile. Preview: DB_CONFIG_PROFILE=preview bun run db:snapshot-waitlists`;
}

export function restoreUsage(): string {
  return `Replace current league waitlists with a snapshot taken by db:snapshot-waitlists.

Usage:
  bun run db:restore-waitlists -- --yes
  bun run db:restore-waitlists -- --yes --file path.json
  bun run db:restore-waitlists -- --dry-run

Options:
  --file <path>         Snapshot JSON (default: latest snapshot for this profile)
  --yes                 Required to actually replace waitlist tables
  --no-backup           Skip the automatic pre-restore snapshot
  --output-dir <dir>    Directory to search for the latest snapshot / write the pre-restore backup
  --dry-run             Connect and print the plan only
  --help                Show this message

This overwrites league_waitlists, waitlist_entries, waitlist_offers, and
waitlist_audit_events, then restores league waitlist_id assignments and
outbound-message waitlist links. Member, league, and registration rows are not
rewritten.`;
}

export function printSnapshotCounts(label: string, counts: Record<string, number>): void {
  console.log(`${label}:`);
  console.log(`  waitlists: ${counts.league_waitlists ?? 0}`);
  console.log(`  entries: ${counts.waitlist_entries ?? 0}`);
  console.log(`  offers: ${counts.waitlist_offers ?? 0}`);
  console.log(`  audit events: ${counts.waitlist_audit_events ?? 0}`);
  console.log(`  league assignments: ${counts.leagueWaitlistAssignments ?? 0}`);
  console.log(`  outbound message links: ${counts.outboundMessageLinks ?? 0}`);
}
