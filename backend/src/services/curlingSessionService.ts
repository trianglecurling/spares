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

export type SessionSeason = {
  sessionId: number;
  sessionName: string;
  seasonId: number;
  seasonName: string;
  seasonStartDate: string;
  seasonEndDate: string;
};

function dateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}

/**
 * Season attached to a calendar date: the session underway on that date,
 * otherwise the next session that starts after it.
 */
export async function resolveSeasonAttachedToDate(
  asOfDate: string
): Promise<SessionSeason | null> {
  const { db, schema } = getDrizzleDb();
  const asOfValue = dateColumnBindValue(asOfDate);

  const selectFields = {
    sessionId: schema.curlingSessions.id,
    sessionName: schema.curlingSessions.name,
    seasonId: schema.curlingSeasons.id,
    seasonName: schema.curlingSeasons.name,
    seasonStartDate: schema.curlingSeasons.start_date,
    seasonEndDate: schema.curlingSeasons.end_date,
  };

  const [currentSession] = await db
    .select(selectFields)
    .from(schema.curlingSessions)
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
    .where(
      and(
        lte(schema.curlingSessions.start_date, asOfValue as never),
        gte(schema.curlingSessions.end_date, asOfValue as never)
      )
    )
    .orderBy(desc(schema.curlingSessions.start_date))
    .limit(1);

  const row =
    currentSession ??
    (
      await db
        .select(selectFields)
        .from(schema.curlingSessions)
        .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
        .where(gt(schema.curlingSessions.start_date, asOfValue as never))
        .orderBy(asc(schema.curlingSessions.start_date))
        .limit(1)
    )[0] ??
    null;

  if (!row) return null;
  const seasonStartDate = dateOnly(row.seasonStartDate);
  const seasonEndDate = dateOnly(row.seasonEndDate);
  if (!seasonStartDate || !seasonEndDate) return null;
  return {
    sessionId: row.sessionId,
    sessionName: row.sessionName,
    seasonId: row.seasonId,
    seasonName: row.seasonName,
    seasonStartDate,
    seasonEndDate,
  };
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
