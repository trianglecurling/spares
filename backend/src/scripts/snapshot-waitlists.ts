/**
 * Write a full league-waitlist snapshot.
 *
 *   bun run db:snapshot-waitlists
 *   bun run db:snapshot-waitlists -- --dry-run
 *   bun run db:snapshot-waitlists -- --file path.json
 */

import path from 'path';
import {
  argvFlag,
  argvValue,
  currentWaitlistCounts,
  defaultSnapshotDir,
  describeTarget,
  loadCurrentPostgresProfile,
  printSnapshotCounts,
  snapshotFileName,
  snapshotUsage,
  snapshotWaitlists,
  timestampForFileName,
} from './waitlistSnapshot.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argvFlag(argv, '--help')) {
    console.log(snapshotUsage());
    return;
  }

  const loaded = loadCurrentPostgresProfile();
  const dryRun = argvFlag(argv, '--dry-run');
  const fileArg = argvValue(argv, '--file');
  const outputDir = path.resolve(argvValue(argv, '--output-dir') ?? defaultSnapshotDir());
  const outputPath = fileArg
    ? path.resolve(fileArg)
    : path.join(outputDir, snapshotFileName(loaded.profile, timestampForFileName()));

  console.log(`Target: ${describeTarget(loaded)} (profile ${loaded.profile})`);

  if (dryRun) {
    const counts = await currentWaitlistCounts(loaded);
    console.log(`Would write ${outputPath}`);
    printSnapshotCounts('Current waitlists', counts);
    return;
  }

  const { snapshot, jsonPath, summaryPath } = await snapshotWaitlists({ loaded, outputPath });
  printSnapshotCounts('Wrote waitlist snapshot', snapshot.counts);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Summary: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
