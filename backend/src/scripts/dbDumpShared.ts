/**
 * Shared Postgres dump helpers for copy-db and dump-db.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool, type PoolClient } from 'pg';
import type { DatabaseConfig } from '../db/config.js';
import { getDatabaseConfigFileName } from '../db-config-path.js';

export const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const COPY_PAGE_SIZE = 200;

export type PostgresConfig = NonNullable<DatabaseConfig['postgres']>;

export type LoadedProfile = {
  profile: string;
  configPath: string;
  postgres: PostgresConfig;
};

export type LibpqTools = {
  dump: string;
  restore: string;
  major: number;
};

export type PgDumpTool = {
  dump: string;
  major: number;
};

export type ForeignKey = {
  schema: string;
  table: string;
  name: string;
  definition: string;
};

export type SequenceValue = {
  schema: string;
  name: string;
  lastValue: string | null;
  isCalled: boolean;
};

export type TableCopyPlan = {
  schema: string;
  name: string;
  columns: string[];
  hasIdentity: boolean;
};

export function argvFlag(name: string): boolean {
  return process.argv.includes(name);
}

export function argvValue(name: string): string | undefined {
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

export function loadProfile(profile: string): LoadedProfile {
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

export function libpqEnv(postgres: PostgresConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGPASSWORD: postgres.password ?? '',
    PGSSLMODE: postgres.ssl ? 'require' : 'disable',
  };
}

export function listClientToolCandidates(name: 'pg_dump' | 'pg_restore'): string[] {
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

export function parseMajorVersion(text: string): number | null {
  const match = text.match(/(\d+)\.\d+/);
  return match ? Number(match[1]) : null;
}

export function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
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

export function runCommandOutput(command: string, args: string[]): Promise<string> {
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

export async function resolvePgDump(minMajor: number): Promise<PgDumpTool | null> {
  let best: PgDumpTool | null = null;
  for (const dump of listClientToolCandidates('pg_dump')) {
    try {
      const major = parseMajorVersion(await runCommandOutput(dump, ['--version']));
      if (major == null || major < minMajor) {
        continue;
      }
      if (!best || major > best.major) {
        best = { dump, major };
      }
    } catch {
      // Skip unreadable binaries.
    }
  }
  return best;
}

export async function resolveLibpqTools(minMajor: number): Promise<LibpqTools | null> {
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

export function timestampForFileName(date = new Date()): string {
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

export function defaultBackupPath(profile: string, extension: 'dump' | 'sql'): string {
  return path.join(backendRoot, 'data', 'db-dumps', `${profile}-${timestampForFileName()}.${extension}`);
}

export function resolveBackupPath(profile: string, extension: 'dump' | 'sql', override?: string): string {
  if (!override) {
    return defaultBackupPath(profile, extension);
  }
  return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
}

export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function qualifyTable(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

export async function dumpDatabase(
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

export async function getServerMajor(client: Pool | PoolClient): Promise<number> {
  const result = await client.query<{ server_version: string }>('SHOW server_version');
  const major = parseMajorVersion(result.rows[0]?.server_version ?? '');
  if (major == null) {
    throw new Error(`Could not parse server version: ${result.rows[0]?.server_version ?? '(empty)'}`);
  }
  return major;
}

export async function assertReachable(
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

export async function listTablePlans(client: Pool | PoolClient): Promise<TableCopyPlan[]> {
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

export async function listForeignKeys(client: Pool | PoolClient): Promise<ForeignKey[]> {
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

export async function listSequences(client: Pool | PoolClient): Promise<SequenceValue[]> {
  // pg_sequences has no is_called; last_value is null until the sequence is used.
  const result = await client.query<SequenceValue>(`
    SELECT
      schemaname AS schema,
      sequencename AS name,
      last_value::text AS "lastValue",
      (last_value IS NOT NULL) AS "isCalled"
    FROM pg_sequences
    WHERE schemaname = 'public'
    ORDER BY sequencename
  `);
  return result.rows;
}

export async function writeSqlBackup(source: Pool, profile: LoadedProfile, backupPath: string): Promise<void> {
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

    await write(`-- Broomstack database dump (${profile.profile})`);
    await write(`-- ${describeTarget(profile)}`);
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
