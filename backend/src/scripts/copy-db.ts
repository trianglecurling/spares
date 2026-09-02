/**
 * Overwrite one Postgres database with a full copy of another.
 *
 * Default: production (`db-config.json`) → preview (`db-config.preview.json`).
 * Uses `pg_dump`/`pg_restore` when the client is new enough for the server.
 * Otherwise copies table data with the Node `pg` client (schemas must match).
 *
 * Usage (from repo root):
 *   bun run db:copy-to-preview -- --dry-run
 *   bun run db:copy-to-preview -- --yes
 *
 * The destination is dumped to backend/data/db-dumps/ before overwrite.
 * After copy, preview server_config is set to test mode + bypass login verification,
 * then the preview application tier is restarted so in-memory caches reload.
 *
 * Other profiles:
 *   bun run --filter backend db:copy -- --from default --to preview --yes
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool, type PoolClient } from 'pg';
import type { DatabaseConfig } from '../db/config.js';
import { getDatabaseConfigFileName } from '../db-config-path.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COPY_PAGE_SIZE = 200;
const INSERT_BATCH_SIZE = 100;
const DEFAULT_APP_RESTART_CMD = 'sudo systemctl restart tccnc-web-preview';

type PostgresConfig = NonNullable<DatabaseConfig['postgres']>;

type LoadedProfile = {
  profile: string;
  configPath: string;
  postgres: PostgresConfig;
};

type LibpqTools = {
  dump: string;
  restore: string;
  major: number;
};

type ForeignKey = {
  schema: string;
  table: string;
  name: string;
  definition: string;
};

type SequenceValue = {
  schema: string;
  name: string;
  lastValue: string | null;
  isCalled: boolean;
};

type TableCopyPlan = {
  schema: string;
  name: string;
  columns: string[];
  hasIdentity: boolean;
};

function printUsage(): void {
  console.log(`Overwrite a Postgres database with a full copy of another.

Usage:
  bun run db:copy-to-preview -- --dry-run
  bun run db:copy-to-preview -- --yes

Options:
  --from <profile>         Source profile (default: default / db-config.json)
  --to <profile>           Destination profile (default: preview / db-config.preview.json)
  --backup-file <path>     Destination dump path (default: backend/data/db-dumps/<profile>-<timestamp>.dump|.sql)
  --dry-run                Connect and print the plan only
  --yes                    Required to actually overwrite the destination
  --restart-app            Restart the application tier after copy
  --restart-cmd <command>  Restart command (default: sudo systemctl restart tccnc-web-preview)
  --no-restart             Skip the application-tier restart
  --help                   Show this message

The destination cannot be the default/production profile.`);
}

function argvFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argvValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function loadProfile(profile: string): LoadedProfile {
  const fileName = getDatabaseConfigFileName(profile);
  const configPath = path.join(backendRoot, 'data', fileName);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Database config not found: ${configPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as DatabaseConfig;
  if (parsed.type !== 'postgres' || !parsed.postgres) {
    throw new Error(`${configPath} is not a Postgres config`);
  }
  const postgres = parsed.postgres;
  if (!postgres.host || !postgres.database || !postgres.username) {
    throw new Error(`${configPath} is missing host, database, or username`);
  }
  return { profile, configPath, postgres };
}

function describeTarget(loaded: LoadedProfile): string {
  const { host, port, database, username } = loaded.postgres;
  return `${username}@${host}:${port ?? 5432}/${database}`;
}

function sameDatabase(left: PostgresConfig, right: PostgresConfig): boolean {
  return (
    left.host === right.host &&
    (left.port ?? 5432) === (right.port ?? 5432) &&
    left.database === right.database
  );
}

function createPool(postgres: PostgresConfig): Pool {
  return new Pool({
    host: postgres.host,
    port: postgres.port ?? 5432,
    database: postgres.database,
    user: postgres.username,
    password: postgres.password,
    ssl: postgres.ssl ? { rejectUnauthorized: false } : false,
  });
}

function libpqEnv(postgres: PostgresConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGPASSWORD: postgres.password ?? '',
    PGSSLMODE: postgres.ssl ? 'require' : 'disable',
  };
}

function listClientToolCandidates(name: 'pg_dump' | 'pg_restore'): string[] {
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const extraDirs = ['/usr/bin', '/usr/local/bin'];
  try {
    for (const entry of fs.readdirSync('/usr/lib/postgresql')) {
      extraDirs.push(`/usr/lib/postgresql/${entry}/bin`);
    }
  } catch {
    // No multi-version PostgreSQL install layout.
  }

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const dir of [...pathDirs, ...extraDirs]) {
    const candidate = path.join(dir, name);
    if (!seen.has(candidate) && fs.existsSync(candidate)) {
      seen.add(candidate);
      candidates.push(candidate);
    }
  }
  return candidates;
}

function parseMajorVersion(text: string): number | null {
  const match = text.match(/(\d+)\.\d+/);
  return match ? Number(match[1]) : null;
}

function runShellCommand(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { env: process.env, shell: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Restart command exited with code ${code}: ${command}`));
    });
  });
}

function resolveAppRestartCommand(destProfile: string): string | null {
  if (argvFlag('--no-restart')) {
    return null;
  }
  const explicit = argvValue('--restart-cmd');
  if (explicit) {
    return explicit;
  }
  const fromEnv = process.env.DB_COPY_APP_RESTART_CMD?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (argvFlag('--restart-app') || destProfile === 'preview') {
    return DEFAULT_APP_RESTART_CMD;
  }
  return null;
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(command)} exited with code ${code}`));
    });
  });
}

function runCommandOutput(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(`${path.basename(command)} exited with code ${code}`));
    });
  });
}

async function resolveLibpqTools(minMajor: number): Promise<LibpqTools | null> {
  let best: LibpqTools | null = null;
  for (const dump of listClientToolCandidates('pg_dump')) {
    try {
      const major = parseMajorVersion(await runCommandOutput(dump, ['--version']));
      if (major == null || major < minMajor) {
        continue;
      }
      const restore = path.join(path.dirname(dump), 'pg_restore');
      if (!fs.existsSync(restore)) {
        continue;
      }
      if (!best || major > best.major) {
        best = { dump, restore, major };
      }
    } catch {
      // Skip unreadable binaries.
    }
  }
  return best;
}

function timestampForFileName(date = new Date()): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function defaultBackupPath(profile: string, extension: 'dump' | 'sql'): string {
  return path.join(backendRoot, 'data', 'db-dumps', `${profile}-${timestampForFileName()}.${extension}`);
}

function resolveBackupPath(profile: string, extension: 'dump' | 'sql', override?: string): string {
  if (!override) {
    return defaultBackupPath(profile, extension);
  }
  return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function qualifyTable(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

async function dumpDatabase(
  pgDump: string,
  postgres: PostgresConfig,
  dumpPath: string
): Promise<void> {
  fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
  await runCommand(
    pgDump,
    [
      '--format=custom',
      '--no-owner',
      '--no-acl',
      '--verbose',
      '--host',
      postgres.host,
      '--port',
      String(postgres.port ?? 5432),
      '--username',
      postgres.username,
      '--dbname',
      postgres.database,
      '--file',
      dumpPath,
    ],
    libpqEnv(postgres)
  );
}

async function getServerMajor(client: Pool | PoolClient): Promise<number> {
  const result = await client.query<{ server_version: string }>('SHOW server_version');
  const major = parseMajorVersion(result.rows[0]?.server_version ?? '');
  if (major == null) {
    throw new Error(`Could not parse server version: ${result.rows[0]?.server_version ?? '(empty)'}`);
  }
  return major;
}

async function assertReachable(
  label: string,
  postgres: PostgresConfig
): Promise<{ pool: Pool; major: number }> {
  const pool = createPool(postgres);
  try {
    const result = await pool.query<{ current_database: string; current_user: string }>(
      'SELECT current_database(), current_user'
    );
    const major = await getServerMajor(pool);
    const row = result.rows[0];
    console.log(`  ${label}: connected as ${row.current_user} to ${row.current_database} (Postgres ${major})`);
    return { pool, major };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

async function listTablePlans(client: Pool | PoolClient): Promise<TableCopyPlan[]> {
  const tables = await client.query<{ schema: string; name: string }>(`
    SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relispartition
    ORDER BY n.nspname, c.relname
  `);

  const plans: TableCopyPlan[] = [];
  for (const table of tables.rows) {
    const columns = await client.query<{ name: string; identity: string }>(
      `
        SELECT a.attname AS name, a.attidentity AS identity
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND c.relname = $2
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND a.attgenerated = ''
        ORDER BY a.attnum
      `,
      [table.schema, table.name]
    );
    if (columns.rows.length === 0) {
      continue;
    }
    plans.push({
      schema: table.schema,
      name: table.name,
      columns: columns.rows.map((column) => column.name),
      hasIdentity: columns.rows.some((column) => column.identity !== ''),
    });
  }
  return plans;
}

async function listForeignKeys(client: Pool | PoolClient): Promise<ForeignKey[]> {
  const result = await client.query<ForeignKey>(`
    SELECT
      n.nspname AS schema,
      rel.relname AS table,
      c.conname AS name,
      pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
    ORDER BY rel.relname, c.conname
  `);
  return result.rows;
}

async function listSequences(client: Pool | PoolClient): Promise<SequenceValue[]> {
  const result = await client.query<SequenceValue>(`
    SELECT
      schemaname AS schema,
      sequencename AS name,
      last_value::text AS "lastValue",
      is_called AS "isCalled"
    FROM pg_sequences
    WHERE schemaname = 'public'
    ORDER BY sequencename
  `);
  return result.rows;
}

function assertSameTables(source: TableCopyPlan[], dest: TableCopyPlan[]): void {
  const sourceByName = new Map(source.map((table) => [`${table.schema}.${table.name}`, table]));
  const destByName = new Map(dest.map((table) => [`${table.schema}.${table.name}`, table]));
  const missingOnDest = [...sourceByName.keys()].filter((key) => !destByName.has(key));
  const extraOnDest = [...destByName.keys()].filter((key) => !sourceByName.has(key));
  if (missingOnDest.length > 0 || extraOnDest.length > 0) {
    throw new Error(
      `Schema table mismatch. Missing on destination: ${missingOnDest.join(', ') || '(none)'}. Extra on destination: ${extraOnDest.join(', ') || '(none)'}.`
    );
  }
  for (const [key, sourceTable] of sourceByName) {
    const destTable = destByName.get(key);
    if (!destTable) {
      continue;
    }
    if (sourceTable.columns.join('\0') !== destTable.columns.join('\0')) {
      throw new Error(
        `Column mismatch on ${key}. Source: ${sourceTable.columns.join(', ')}. Destination: ${destTable.columns.join(', ')}.`
      );
    }
  }
}

async function dropForeignKeys(client: PoolClient, foreignKeys: ForeignKey[]): Promise<void> {
  for (const foreignKey of foreignKeys) {
    await client.query(
      `ALTER TABLE ${qualifyTable(foreignKey.schema, foreignKey.table)} DROP CONSTRAINT ${quoteIdent(foreignKey.name)}`
    );
  }
}

async function addForeignKeys(client: PoolClient, foreignKeys: ForeignKey[]): Promise<void> {
  for (const foreignKey of foreignKeys) {
    await client.query(
      `ALTER TABLE ${qualifyTable(foreignKey.schema, foreignKey.table)} ADD CONSTRAINT ${quoteIdent(foreignKey.name)} ${foreignKey.definition}`
    );
  }
}

function insertSql(plan: TableCopyPlan, rowCount: number): { text: string; valueCount: number } {
  const qualified = qualifyTable(plan.schema, plan.name);
  const columnList = plan.columns.map(quoteIdent).join(', ');
  const overriding = plan.hasIdentity ? ' OVERRIDING SYSTEM VALUE' : '';
  const values = Array.from({ length: rowCount }, (_, rowIndex) => {
    const placeholders = plan.columns.map((_, columnIndex) => `$${rowIndex * plan.columns.length + columnIndex + 1}`);
    return `(${placeholders.join(', ')})`;
  });
  return {
    text: `INSERT INTO ${qualified} (${columnList})${overriding} VALUES ${values.join(', ')}`,
    valueCount: rowCount * plan.columns.length,
  };
}

async function copyTableData(
  source: Pool | PoolClient,
  dest: PoolClient,
  plan: TableCopyPlan
): Promise<number> {
  const qualified = qualifyTable(plan.schema, plan.name);
  const columnList = plan.columns.map(quoteIdent).join(', ');
  let offset = 0;
  let copied = 0;

  while (true) {
    const page = await source.query(
      `SELECT ${columnList} FROM ${qualified} ORDER BY ctid OFFSET $1 LIMIT $2`,
      [offset, COPY_PAGE_SIZE]
    );
    if (page.rows.length === 0) {
      break;
    }

    for (let index = 0; index < page.rows.length; index += INSERT_BATCH_SIZE) {
      const batch = page.rows.slice(index, index + INSERT_BATCH_SIZE);
      const { text } = insertSql(plan, batch.length);
      const values = batch.flatMap((row) => plan.columns.map((column) => row[column]));
      await dest.query(text, values);
    }

    copied += page.rows.length;
    offset += page.rows.length;
    if (page.rows.length < COPY_PAGE_SIZE) {
      break;
    }
  }

  return copied;
}

async function writeSqlBackup(source: Pool, destProfile: LoadedProfile, backupPath: string): Promise<void> {
  const client = await source.connect();
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  const out = fs.createWriteStream(backupPath);

  const write = (line: string) =>
    new Promise<void>((resolve, reject) => {
      if (out.write(`${line}\n`)) {
        resolve();
        return;
      }
      out.once('drain', resolve);
      out.once('error', reject);
    });

  try {
    const plans = await listTablePlans(client);
    const foreignKeys = await listForeignKeys(client);
    const sequences = await listSequences(client);

    await write(`-- Broomstack destination backup (${destProfile.profile})`);
    await write(`-- ${describeTarget(destProfile)}`);
    await write(`-- ${new Date().toISOString()}`);
    await write('BEGIN;');
    for (const foreignKey of foreignKeys) {
      await write(
        `ALTER TABLE ${qualifyTable(foreignKey.schema, foreignKey.table)} DROP CONSTRAINT ${quoteIdent(foreignKey.name)};`
      );
    }
    if (plans.length > 0) {
      await write(
        `TRUNCATE TABLE ${plans.map((plan) => qualifyTable(plan.schema, plan.name)).join(', ')} RESTART IDENTITY;`
      );
    }

    for (const plan of plans) {
      const qualified = qualifyTable(plan.schema, plan.name);
      const columnList = plan.columns.map(quoteIdent).join(', ');
      const formatList = plan.columns.map((column) => `format('%L', ${quoteIdent(column)})`).join(', ');
      const overriding = plan.hasIdentity ? ' OVERRIDING SYSTEM VALUE' : '';
      let dumped = 0;
      let offset = 0;
      while (true) {
        const page = await client.query<{ literals: string[] }>(
          `SELECT ARRAY[${formatList}] AS literals FROM ${qualified} ORDER BY ctid OFFSET $1 LIMIT $2`,
          [offset, COPY_PAGE_SIZE]
        );
        if (page.rows.length === 0) {
          break;
        }
        for (const row of page.rows) {
          await write(
            `INSERT INTO ${qualified} (${columnList})${overriding} VALUES (${row.literals.join(', ')});`
          );
        }
        dumped += page.rows.length;
        offset += page.rows.length;
        if (page.rows.length < COPY_PAGE_SIZE) {
          break;
        }
      }
      console.log(`  backed up ${plan.schema}.${plan.name} (${dumped} rows)`);
    }

    for (const foreignKey of foreignKeys) {
      await write(
        `ALTER TABLE ${qualifyTable(foreignKey.schema, foreignKey.table)} ADD CONSTRAINT ${quoteIdent(foreignKey.name)} ${foreignKey.definition};`
      );
    }
    for (const sequence of sequences) {
      if (sequence.lastValue == null) {
        continue;
      }
      await write(
        `SELECT setval('${qualifyTable(sequence.schema, sequence.name)}', ${Number(sequence.lastValue)}, ${sequence.isCalled});`
      );
    }
    await write('COMMIT;');
  } finally {
    client.release();
    await new Promise<void>((resolve, reject) => {
      out.end((error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function copyWithNodeClient(sourcePool: Pool, destPool: Pool): Promise<void> {
  const sourcePlans = await listTablePlans(sourcePool);
  const destPlans = await listTablePlans(destPool);
  assertSameTables(sourcePlans, destPlans);

  const destClient = await destPool.connect();
  try {
    await destClient.query('BEGIN');
    const foreignKeys = await listForeignKeys(destClient);
    console.log(`Dropping ${foreignKeys.length} destination foreign keys...`);
    await dropForeignKeys(destClient, foreignKeys);

    if (sourcePlans.length > 0) {
      console.log(`Truncating ${sourcePlans.length} destination tables...`);
      await destClient.query(
        `TRUNCATE TABLE ${sourcePlans.map((plan) => qualifyTable(plan.schema, plan.name)).join(', ')} RESTART IDENTITY`
      );
    }

    for (const plan of sourcePlans) {
      const copied = await copyTableData(sourcePool, destClient, plan);
      console.log(`  copied ${plan.schema}.${plan.name} (${copied} rows)`);
    }

    console.log('Recreating destination foreign keys...');
    await addForeignKeys(destClient, foreignKeys);

    const sequences = await listSequences(sourcePool);
    for (const sequence of sequences) {
      if (sequence.lastValue == null) {
        continue;
      }
      await destClient.query('SELECT setval($1, $2, $3)', [
        `${sequence.schema}.${sequence.name}`,
        Number(sequence.lastValue),
        sequence.isCalled,
      ]);
    }

    await destClient.query('COMMIT');
  } catch (error) {
    await destClient.query('ROLLBACK');
    throw error;
  } finally {
    destClient.release();
  }
}

async function applyPreviewServerSettings(pool: Pool): Promise<void> {
  const result = await pool.query<{ test_mode: number; bypass_login_verification: number }>(
    `
      UPDATE server_config
      SET
        test_mode = 1,
        bypass_login_verification = 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
      RETURNING test_mode, bypass_login_verification
    `
  );
  if (result.rowCount !== 1) {
    throw new Error('Could not update destination server_config (expected a single id=1 row).');
  }
  console.log('Destination /admin/config: enabled test mode and bypass login verification.');
}

async function copyWithLibpq(
  tools: LibpqTools,
  source: LoadedProfile,
  dest: LoadedProfile,
  destBackupPath: string
): Promise<void> {
  const sourceDumpPath = path.join(os.tmpdir(), `broomstack-db-copy-${Date.now()}.dump`);
  try {
    console.log(`Dumping destination to ${destBackupPath}...`);
    await dumpDatabase(tools.dump, dest.postgres, destBackupPath);

    console.log(`Dumping source to ${sourceDumpPath}...`);
    await dumpDatabase(tools.dump, source.postgres, sourceDumpPath);

    console.log('Restoring dump over destination (--clean replaces existing objects)...');
    await runCommand(
      tools.restore,
      [
        '--clean',
        '--if-exists',
        '--exit-on-error',
        '--no-owner',
        '--no-acl',
        '--verbose',
        '--host',
        dest.postgres.host,
        '--port',
        String(dest.postgres.port ?? 5432),
        '--username',
        dest.postgres.username,
        '--dbname',
        dest.postgres.database,
        sourceDumpPath,
      ],
      libpqEnv(dest.postgres)
    );
  } finally {
    try {
      fs.unlinkSync(sourceDumpPath);
    } catch {
      // Source dump may not have been created if pg_dump failed immediately.
    }
  }
}

async function main(): Promise<void> {
  if (argvFlag('--help')) {
    printUsage();
    return;
  }

  const fromProfile = argvValue('--from') ?? 'default';
  const toProfile = argvValue('--to') ?? 'preview';
  const backupFile = argvValue('--backup-file');
  const dryRun = argvFlag('--dry-run');
  const confirmed = argvFlag('--yes');

  if (toProfile === 'default') {
    throw new Error('Refusing to overwrite the default/production profile. Choose a different --to.');
  }

  const source = loadProfile(fromProfile);
  const dest = loadProfile(toProfile);

  if (sameDatabase(source.postgres, dest.postgres)) {
    throw new Error('Source and destination point at the same host/database. Refusing to continue.');
  }

  console.log(`Source:      ${source.profile} (${source.configPath})`);
  console.log(`             ${describeTarget(source)}`);
  console.log(`Destination: ${dest.profile} (${dest.configPath})`);
  console.log(`             ${describeTarget(dest)}`);
  console.log('This replaces the destination data with a full copy of the source.');

  console.log('Checking connections...');
  const sourceConn = await assertReachable('source', source.postgres);
  const destConn = await assertReachable('destination', dest.postgres);
  const requiredMajor = Math.max(sourceConn.major, destConn.major);
  const tools = await resolveLibpqTools(requiredMajor);
  const strategy = tools ? 'pg_dump' : 'node';
  const destBackupPath = resolveBackupPath(dest.profile, strategy === 'pg_dump' ? 'dump' : 'sql', backupFile);

  const restartCommand = resolveAppRestartCommand(dest.profile);

  console.log(`Backup:      ${destBackupPath}`);
  if (tools) {
    console.log(`Strategy:    pg_dump/pg_restore ${tools.major} (${tools.dump})`);
  } else {
    console.log(
      `Strategy:    Node client data copy (no pg_dump >= Postgres ${requiredMajor}; installed 16.x cannot dump 18.x)`
    );
  }
  if (restartCommand) {
    console.log(`App restart: ${restartCommand}`);
  } else {
    console.log('App restart: skipped');
  }

  try {
    if (dryRun) {
      console.log('After copy, destination will enable test mode and bypass login verification.');
      if (restartCommand) {
        console.log(`After copy, the application tier will be restarted with: ${restartCommand}`);
      } else {
        console.log('After copy, restart the preview application tier so in-memory caches reload.');
      }
      console.log('Dry run only. Re-run with --yes to overwrite the destination.');
      return;
    }

    if (!confirmed) {
      printUsage();
      throw new Error('Refusing to overwrite without --yes (or pass --dry-run).');
    }

    if (tools) {
      await copyWithLibpq(tools, source, dest, destBackupPath);
    } else {
      console.log(`Dumping destination to ${destBackupPath}...`);
      await writeSqlBackup(destConn.pool, dest, destBackupPath);
      console.log('Copying source tables onto destination...');
      await copyWithNodeClient(sourceConn.pool, destConn.pool);
    }

    await applyPreviewServerSettings(destConn.pool);
    console.log(`Copied ${source.profile} onto ${dest.profile}.`);
    console.log(`Destination backup kept at ${destBackupPath}`);
    if (!tools) {
      console.log(`Restore that backup with: psql ... -v ON_ERROR_STOP=1 -f ${destBackupPath}`);
    }

    if (restartCommand) {
      console.log(`Restarting application tier: ${restartCommand}`);
      try {
        await runShellCommand(restartCommand);
        console.log('Application tier restarted.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Application-tier restart failed: ${message}`);
        console.error(
          'Copy succeeded. Restart the preview process yourself so bootstrap, search, and config caches reload.'
        );
        console.error(`Example: ${DEFAULT_APP_RESTART_CMD}`);
        console.error('From this machine, set DB_COPY_APP_RESTART_CMD to an ssh restart, or pass --restart-cmd.');
        process.exitCode = 1;
      }
    } else {
      console.log(
        `Restart the preview application tier so in-memory caches reload. Example: ${DEFAULT_APP_RESTART_CMD}`
      );
    }
  } finally {
    await sourceConn.pool.end();
    await destConn.pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
