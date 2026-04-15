/**
 * Delete every row in `permalinks`. Related `permalink_hits` rows are removed via ON DELETE CASCADE.
 *
 * Does nothing destructive unless you pass --confirm (prevents accidents).
 *
 *   bun run src/scripts/delete-all-permalinks.ts --dry-run
 *   bun run src/scripts/delete-all-permalinks.ts --confirm
 *
 * Or: bun run db:delete-all-permalinks -- --dry-run
 *
 * Note: This connects with `getDrizzleDb()` only. It does not call `initializeDatabase()`, which
 * re-runs the full schema/migration pipeline and can take tens of seconds. Run `bun run db:migrate`
 * if the DB has never been initialized or needs schema updates.
 */

import { sql } from 'drizzle-orm';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const confirm = args.includes('--confirm');

  if (!dryRun && !confirm) {
    console.error('Refusing to run: pass --dry-run to list counts, or --confirm to delete all permalinks.');
    process.exit(1);
  }

  if (dryRun && confirm) {
    console.error('Use only one of --dry-run or --confirm.');
    process.exit(1);
  }

  if (!getDatabaseConfig()) {
    console.error('Database config not found (backend/data/db-config.json).');
    process.exit(1);
  }

  const { db, schema } = getDrizzleDb();

  const [plinkRow] = await db
    .select({ n: sql<number>`cast(count(*) as integer)` })
    .from(schema.permalinks);
  const [hitRow] = await db
    .select({ n: sql<number>`cast(count(*) as integer)` })
    .from(schema.permalinkHits);

  const permalinkCount = Number(plinkRow?.n ?? 0);
  const hitCount = Number(hitRow?.n ?? 0);

  console.log(`Permalinks: ${permalinkCount}`);
  console.log(`Permalink hit rows: ${hitCount}`);

  if (dryRun) {
    console.log('\nDry run only. Pass --confirm to delete all permalinks (and hits).');
    return;
  }

  if (permalinkCount === 0) {
    console.log('\nNothing to delete.');
    return;
  }

  await db.delete(schema.permalinks).where(sql`1 = 1`);

  console.log(`\nDeleted ${permalinkCount} permalink(s). Hit rows were cascade-deleted with them.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
