/**
 * Restore league waitlists from a snapshot created by db:snapshot-waitlists.
 *
 *   bun run db:restore-waitlists -- --dry-run
 *   bun run db:restore-waitlists -- --yes
 *   bun run db:restore-waitlists -- --yes --file path.json
 */

import path from 'path';
import {
  argvFlag,
  argvValue,
  currentWaitlistCounts,
  defaultSnapshotDir,
  describeTarget,
  findLatestSnapshotFile,
  loadCurrentPostgresProfile,
  loadSnapshotFile,
  printSnapshotCounts,
  restoreUsage,
  restoreWaitlists,
  snapshotFileName,
  timestampForFileName,
} from './waitlistSnapshot.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argvFlag(argv, '--help')) {
    console.log(restoreUsage());
    return;
  }

  const loaded = loadCurrentPostgresProfile();
  const dryRun = argvFlag(argv, '--dry-run');
  const confirmed = argvFlag(argv, '--yes');
  const skipBackup = argvFlag(argv, '--no-backup');
  const outputDir = path.resolve(argvValue(argv, '--output-dir') ?? defaultSnapshotDir());
  const fileArg = argvValue(argv, '--file');
  const snapshotPath = fileArg ? path.resolve(fileArg) : findLatestSnapshotFile(outputDir, loaded.profile);

  if (!snapshotPath) {
    throw new Error(
      `No waitlist snapshot found in ${outputDir} for profile "${loaded.profile}". Pass --file or run db:snapshot-waitlists first.`,
    );
  }

  const snapshot = loadSnapshotFile(snapshotPath);
  console.log(`Target: ${describeTarget(loaded)}`);
  console.log(`Snapshot: ${snapshotPath}`);
  console.log(`Snapshot created: ${snapshot.createdAt} (profile ${snapshot.profile}, ${snapshot.database.host}/${snapshot.database.name})`);
  printSnapshotCounts('Snapshot', snapshot.counts);

  const current = await currentWaitlistCounts(loaded);
  printSnapshotCounts('Current database', current);

  if (
    snapshot.database.host !== loaded.postgres.host ||
    snapshot.database.name !== loaded.postgres.database
  ) {
    console.warn(
      `Warning: snapshot database ${snapshot.database.host}/${snapshot.database.name} differs from ${loaded.postgres.host}/${loaded.postgres.database}.`,
    );
  }

  if (dryRun) {
    console.log('Dry run only. Pass --yes to replace current waitlists with this snapshot.');
    return;
  }

  if (!confirmed) {
    throw new Error('Refusing to restore: pass --yes to replace current waitlists, or --dry-run to preview.');
  }

  const backupPath = skipBackup
    ? undefined
    : path.join(outputDir, snapshotFileName(loaded.profile, timestampForFileName(), '-pre-restore'));
  const result = await restoreWaitlists({ loaded, snapshot, backupPath });
  if (result.backupPath) {
    console.log(`Pre-restore backup: ${result.backupPath}`);
  }
  printSnapshotCounts('Restored', {
    ...result.restored,
    leagueWaitlistAssignments: result.restoredAssignments,
    outboundMessageLinks: result.restoredMessageLinks,
  });

  for (const [table, columns] of Object.entries(result.skippedColumns)) {
    console.warn(`Skipped snapshot columns not in ${table}: ${columns.join(', ')}`);
  }
  for (const [table, columns] of Object.entries(result.missingLiveColumns)) {
    console.warn(`${table} has columns not in the snapshot (left at defaults): ${columns.join(', ')}`);
  }
  if (result.missingLeagues.length > 0) {
    console.warn(`Leagues missing while restoring waitlist assignments: ${result.missingLeagues.join(', ')}`);
  }
  if (result.missingMessages.length > 0) {
    console.warn(`Outbound messages missing while restoring waitlist links: ${result.missingMessages.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
