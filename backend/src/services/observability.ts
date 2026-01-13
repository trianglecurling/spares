import { getDrizzleDb } from '../db/drizzle-db.js';
import { getCurrentDateStringAsync } from '../utils/time.js';

function safeStringify(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return null;
  try {
    const json = JSON.stringify(value);
    // Avoid unbounded growth if someone passes a big object
    return json.length > 5000 ? json.slice(0, 5000) : json;
  } catch {
    return null;
  }
}

export async function logEvent(params: {
  eventType: string;
  memberId?: number | null;
  relatedId?: number | null;
  meta?: unknown;
}): Promise<void> {
  try {
    const { db, schema } = getDrizzleDb();
    await db.insert(schema.observabilityEvents).values({
      event_type: params.eventType,
      member_id: params.memberId ?? null,
      related_id: params.relatedId ?? null,
      meta: safeStringify(params.meta),
    });
  } catch {
    // Best-effort. Never block user flows if observability logging fails.
  }
}

export async function recordDailyActivity(memberId: number): Promise<void> {
  try {
    const activityDate = await getCurrentDateStringAsync(); // YYYY-MM-DD
    const { db, schema } = getDrizzleDb();
    await db.insert(schema.dailyActivity).values({
      member_id: memberId,
      activity_date: activityDate,
    });
  } catch {
    // Most common failure is unique constraint (already recorded today). Ignore.
  }
}

