/**
 * Save a Postgres database dump without copying or restoring.
 *
 * Default: production (`db-config.json`) → backend/data/db-dumps/<profile>-<timestamp>.dump
 * Uses `pg_dump` when the client is new enough for the server.
 * Otherwise writes a SQL data dump with the Node `pg` client.
 *
 * Usage (from repo root):
 *   bun run db:dump -- --dry-run
 *   bun run db:dump
 *   bun run db:dump -- --profile preview
 *   bun run db:dump -- --file /path/to/out.dump
 */

import {
  argvFlag,
  argvValue,
  assertReachable,
  describeTarget,
  dumpDatabase,
  loadProfile,
  resolveBackupPath,
  resolvePgDump,
  writeSqlBackup,
} from './dbDumpShared.js';

function printUsage(): void {
  console.log(`Save a Postgres database dump without copying or restoring.

Usage:
  bun run db:dump -- --dry-run
  bun run db:dump
  bun run db:dump -- --profile preview

Options:
  --profile <profile>  Source profile (default: default / db-config.json)
  --file <path>        Output path (default: backend/data/db-dumps/<profile>-<timestamp>.dump|.sql)
  --dry-run            Connect and print the plan only
  --help               Show this message`);
}

async function main(): Promise<void> {
  if (argvFlag('--help')) {
    printUsage();
    return;
  }

  const profileName = argvValue('--profile') ?? 'default';
  const file = argvValue('--file');
  const dryRun = argvFlag('--dry-run');

  const source = loadProfile(profileName);

  console.log(`Source: ${source.profile} (${source.configPath})`);
  console.log(`        ${describeTarget(source)}`);
  console.log('This writes a dump file only. It does not restore or overwrite any database.');

  console.log('Checking connection...');
  const sourceConn = await assertReachable('source', source.postgres);
  const tools = await resolvePgDump(sourceConn.major);
  const strategy = tools ? 'pg_dump' : 'node';
  const dumpPath = resolveBackupPath(source.profile, strategy === 'pg_dump' ? 'dump' : 'sql', file);

  console.log(`Output:   ${dumpPath}`);
  if (tools) {
    console.log(`Strategy: pg_dump ${tools.major} (${tools.dump})`);
  } else {
    console.log(
      `Strategy: Node client SQL dump (no pg_dump >= Postgres ${sourceConn.major}; installed 16.x cannot dump 18.x)`
    );
  }

  try {
    if (dryRun) {
      console.log('Dry run only. Re-run without --dry-run to write the dump.');
      return;
    }

    if (tools) {
      console.log(`Dumping ${source.profile} to ${dumpPath}...`);
      await dumpDatabase(tools.dump, source.postgres, dumpPath);
    } else {
      console.log(`Dumping ${source.profile} to ${dumpPath}...`);
      await writeSqlBackup(sourceConn.pool, source, dumpPath);
    }

    console.log(`Dump saved at ${dumpPath}`);
    if (!tools) {
      console.log(`Restore that dump with: psql ... -v ON_ERROR_STOP=1 -f ${dumpPath}`);
    } else {
      console.log(`Restore that dump with: pg_restore --clean --if-exists --no-owner --no-acl -d <database> ${dumpPath}`);
    }
  } finally {
    await sourceConn.pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
