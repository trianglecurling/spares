import { eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';

export type LeagueContinuityRow = {
  id: number;
  sessionId: number | null;
  predecessorLeagueId: number | null;
  successorLeagueId: number | null;
};

/** Walk predecessor links to the oldest league in the continuity chain. */
export function lineageRootLeagueId(leagueId: number, leaguesById: Map<number, LeagueContinuityRow>): number {
  const seen = new Set<number>();
  let current = leagueId;
  while (true) {
    if (seen.has(current)) break;
    seen.add(current);
    const row = leaguesById.get(current);
    if (!row?.predecessorLeagueId) break;
    current = row.predecessorLeagueId;
  }
  return current;
}

/** Resolve a lineage seed to the league instance in `sessionId`, following successor links. */
export function resolveLeagueInSession(
  lineageStartLeagueId: number,
  sessionId: number,
  leaguesById: Map<number, LeagueContinuityRow>
): number | null {
  const seed = leaguesById.get(lineageStartLeagueId);
  if (!seed) return null;

  const inSession = new Map<number, LeagueContinuityRow>();
  for (const row of leaguesById.values()) {
    if (row.sessionId === sessionId) inSession.set(row.id, row);
  }
  if (inSession.size === 0) return null;

  if (inSession.has(lineageStartLeagueId)) return lineageStartLeagueId;

  const visited = new Set<number>();
  const queue: number[] = [lineageStartLeagueId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const row = leaguesById.get(current);
    if (!row) continue;
    if (row.successorLeagueId != null) {
      if (inSession.has(row.successorLeagueId)) return row.successorLeagueId;
      queue.push(row.successorLeagueId);
    }
    if (row.predecessorLeagueId != null) {
      queue.push(row.predecessorLeagueId);
    }
  }

  for (const row of inSession.values()) {
    if (lineageRootLeagueId(row.id, leaguesById) === lineageRootLeagueId(lineageStartLeagueId, leaguesById)) {
      return row.id;
    }
  }
  return null;
}

export async function loadLeagueContinuityMap(): Promise<Map<number, LeagueContinuityRow>> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.leagues.id,
      sessionId: schema.leagues.session_id,
      predecessorLeagueId: schema.leagues.predecessor_league_id,
      successorLeagueId: schema.leagues.successor_league_id,
    })
    .from(schema.leagues);
  const map = new Map<number, LeagueContinuityRow>();
  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      sessionId: row.sessionId,
      predecessorLeagueId: row.predecessorLeagueId,
      successorLeagueId: row.successorLeagueId,
    });
  }
  return map;
}

export async function resolveLeagueInSessionFromDb(
  lineageStartLeagueId: number,
  sessionId: number
): Promise<number | null> {
  const map = await loadLeagueContinuityMap();
  return resolveLeagueInSession(lineageStartLeagueId, sessionId, map);
}

export async function assertWaitlistNotSharedInSession(
  waitlistId: number,
  sessionId: number | null,
  excludeLeagueId?: number
): Promise<void> {
  if (sessionId == null) return;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.leagues.id })
    .from(schema.leagues)
    .where(eq(schema.leagues.waitlist_id, waitlistId));
  const conflict = rows.find((row) => row.id !== excludeLeagueId);
  if (conflict) {
    const [existing] = await db
      .select({ sessionId: schema.leagues.session_id })
      .from(schema.leagues)
      .where(eq(schema.leagues.id, conflict.id))
      .limit(1);
    if (existing?.sessionId === sessionId) {
      throw new Error('Another league in this session already uses this waitlist.');
    }
  }
  for (const row of rows) {
    if (row.id === excludeLeagueId) continue;
    const [league] = await db
      .select({ sessionId: schema.leagues.session_id })
      .from(schema.leagues)
      .where(eq(schema.leagues.id, row.id))
      .limit(1);
    if (league?.sessionId === sessionId) {
      throw new Error('Another league in this session already uses this waitlist.');
    }
  }
}
