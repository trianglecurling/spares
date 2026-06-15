import { and, asc, desc, eq, gt, gte, lte, sql, lt } from 'drizzle-orm';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';

function dateColumnBindValue(dateString: string): Date | string {
  if (getDatabaseConfig()?.type === 'postgres') {
    return new Date(`${dateString}T00:00:00`);
  }
  return dateString;
}

async function sessionHasLeagues(sessionId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.leagues)
    .where(eq(schema.leagues.session_id, sessionId))
    .limit(1);
  return Number(row?.count ?? 0) > 0;
}

/**
 * Session used for league-scoped UI and filters:
 * - current session when today falls within it
 * - otherwise upcoming session when it has leagues
 * - otherwise the most recent past session
 */
export async function resolveRelevantSessionIdForLeagues(today: string): Promise<number | null> {
  const { db, schema } = getDrizzleDb();
  const todayValue = dateColumnBindValue(today);

  const [currentSession] = await db
    .select({ id: schema.curlingSessions.id })
    .from(schema.curlingSessions)
    .where(
      and(
        lte(schema.curlingSessions.start_date, todayValue as never),
        gte(schema.curlingSessions.end_date, todayValue as never),
      ),
    )
    .orderBy(desc(schema.curlingSessions.start_date))
    .limit(1);

  if (currentSession) return currentSession.id;

  const [upcomingSession] = await db
    .select({ id: schema.curlingSessions.id })
    .from(schema.curlingSessions)
    .where(gt(schema.curlingSessions.start_date, todayValue as never))
    .orderBy(asc(schema.curlingSessions.start_date))
    .limit(1);

  if (upcomingSession && (await sessionHasLeagues(upcomingSession.id))) {
    return upcomingSession.id;
  }

  const [recentSession] = await db
    .select({ id: schema.curlingSessions.id })
    .from(schema.curlingSessions)
    .where(lte(schema.curlingSessions.end_date, todayValue as never))
    .orderBy(desc(schema.curlingSessions.end_date))
    .limit(1);

  return recentSession?.id ?? null;
}

export type PublicSessionNavItem = {
  id: number;
  name: string;
};

export async function resolveAdjacentSessionsForLeagues(
  sessionId: number
): Promise<{ previous: PublicSessionNavItem | null; next: PublicSessionNavItem | null }> {
  const { db, schema } = getDrizzleDb();
  const [current] = await db
    .select({
      id: schema.curlingSessions.id,
      startDate: schema.curlingSessions.start_date,
    })
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.id, sessionId))
    .limit(1);

  if (!current) {
    return { previous: null, next: null };
  }

  const [previous] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
    })
    .from(schema.curlingSessions)
    .where(lt(schema.curlingSessions.start_date, current.startDate as never))
    .orderBy(desc(schema.curlingSessions.start_date))
    .limit(1);

  const [next] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
    })
    .from(schema.curlingSessions)
    .where(gt(schema.curlingSessions.start_date, current.startDate as never))
    .orderBy(asc(schema.curlingSessions.start_date))
    .limit(1);

  return {
    previous: previous ? { id: previous.id, name: previous.name } : null,
    next: next ? { id: next.id, name: next.name } : null,
  };
}
