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
 *
 * Dump only (no copy):
 *   bun run db:dump
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Pool, type PoolClient } from 'pg';
import {
  COPY_PAGE_SIZE,
  argvFlag,
  argvValue,
  assertReachable,
  describeTarget,
  dumpDatabase,
  libpqEnv,
  listForeignKeys,
  listSequences,
  listTablePlans,
  loadProfile,
  qualifyTable,
  quoteIdent,
  resolveBackupPath,
  resolveLibpqTools,
  runCommand,
  writeSqlBackup,
  type ForeignKey,
  type LibpqTools,
  type LoadedProfile,
  type PostgresConfig,
  type TableCopyPlan,
} from './dbDumpShared.js';

const INSERT_BATCH_SIZE = 100;
const DEFAULT_APP_RESTART_CMD = 'sudo systemctl restart tccnc-web-preview';

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

The destination cannot be the default/production profile.

To save a dump without copying, use: bun run db:dump`);
}

function sameDatabase(left: PostgresConfig, right: PostgresConfig): boolean {
  return (
    left.host === right.host &&
    (left.port ?? 5432) === (right.port ?? 5432) &&
    left.database === right.database
  );
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
