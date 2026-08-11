import { sql } from 'drizzle-orm';
import { getDrizzleDb } from './drizzle-db.js';

/**
 * Registrations submitted before the league priority redesign carry league
 * choices in a shape that no longer exists: ranked selections, ADD/REPLACE
 * waitlist entries, and third-league interest. There is no faithful way to
 * translate those into a single ordered priority list, so they are cancelled
 * and their members re-register on the new flow.
 *
 * Cancelling rather than deleting keeps the payment and communication history
 * intact, and staff refund the cancelled registrations as usual.
 *
 * Identified by "submitted but has no priority list", which makes this
 * naturally idempotent: a registration that comes back through the new flow has
 * priority rows and is never touched again. Drafts are left alone — they simply
 * resume into the new league priority step.
 */
const PRE_PRIORITY_SUBMITTED_STATUSES = [
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
  'paid',
  'confirmed',
];

async function tableExists(tableName: string, dialect: 'sqlite' | 'postgres'): Promise<boolean> {
  const { db } = getDrizzleDb();
  const query =
    dialect === 'postgres'
      ? `SELECT 1 FROM information_schema.tables WHERE table_name = '${tableName}' LIMIT 1`
      : `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${tableName}' LIMIT 1`;
  try {
    const result = await db.execute(sql.raw(query));
    const rows = (result as { rows?: unknown[] }).rows ?? result;
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

export async function cancelPrePriorityModelRegistrations(dialect: 'sqlite' | 'postgres'): Promise<void> {
  if (
    !(await tableExists('curling_registrations', dialect)) ||
    !(await tableExists('registration_league_priorities', dialect))
  ) {
    return;
  }

  const { db } = getDrizzleDb();
  const statusList = PRE_PRIORITY_SUBMITTED_STATUSES.map((status) => `'${status}'`).join(', ');
  const targets = await db.execute(
    sql.raw(`
      SELECT id
      FROM curling_registrations
      WHERE status IN (${statusList})
        AND NOT EXISTS (
          SELECT 1
          FROM registration_league_priorities
          WHERE registration_league_priorities.registration_id = curling_registrations.id
        )
    `),
  );
  const rows = ((targets as { rows?: Array<{ id?: number }> }).rows ?? targets) as Array<{ id?: number }>;
  const ids = (Array.isArray(rows) ? rows : []).map((row) => Number(row.id)).filter(Number.isFinite);
  if (ids.length === 0) return;

  await db.execute(
    sql.raw(`
      UPDATE curling_registrations
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${ids.join(', ')})
    `),
  );

  console.log(
    `Cancelled ${ids.length} registration(s) submitted before the league priority model. Members must re-register.`,
  );
}
