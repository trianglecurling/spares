import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { RegistrationConfigValidationError } from './registrationConfigValidation.js';
import { lineageRootLeagueId, loadLeagueContinuityMap } from './waitlistLineage.js';

export class WaitlistEntityValidationError extends RegistrationConfigValidationError {}

export async function listLeagueWaitlistsForAttach() {
  const { db, schema } = getDrizzleDb();
  const waitlists = await db
    .select()
    .from(schema.leagueWaitlists)
    .where(eq(schema.leagueWaitlists.status, 'active'))
    .orderBy(asc(schema.leagueWaitlists.name));

  const leagues = await db
    .select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      sessionId: schema.leagues.session_id,
      waitlistId: schema.leagues.waitlist_id,
    })
    .from(schema.leagues)
    .where(sql`${schema.leagues.waitlist_id} IS NOT NULL`);

  const sessionIds = [...new Set(leagues.map((l) => l.sessionId).filter((id): id is number => id != null))];
  const sessions =
    sessionIds.length > 0
      ? await db
          .select({ id: schema.curlingSessions.id, name: schema.curlingSessions.name })
          .from(schema.curlingSessions)
          .where(inArray(schema.curlingSessions.id, sessionIds))
      : [];
  const sessionNameById = new Map(sessions.map((s) => [s.id, s.name]));

  const entryCounts = await db
    .select({
      waitlistId: schema.waitlistEntries.waitlist_id,
      total: sql<number>`COUNT(*)`,
    })
    .from(schema.waitlistEntries)
    .where(eq(schema.waitlistEntries.status, 'active'))
    .groupBy(schema.waitlistEntries.waitlist_id);

  const countByWaitlist = new Map(entryCounts.map((row) => [row.waitlistId, Number(row.total ?? 0)]));

  return waitlists.map((waitlist) => ({
    id: waitlist.id,
    name: waitlist.name,
    status: waitlist.status,
    activeEntryCount: countByWaitlist.get(waitlist.id) ?? 0,
    attachedLeagues: leagues
      .filter((league) => league.waitlistId === waitlist.id)
      .map((league) => ({
        id: league.id,
        name: league.name,
        sessionName: league.sessionId ? (sessionNameById.get(league.sessionId) ?? null) : null,
      })),
  }));
}

export async function createLeagueWaitlist(input: { name: string }) {
  const name = input.name.trim();
  if (!name) {
    throw new WaitlistEntityValidationError({ name: 'Waitlist name is required.' });
  }
  const { db, schema } = getDrizzleDb();
  const [created] = await db
    .insert(schema.leagueWaitlists)
    .values({ name, status: 'active' })
    .returning();
  return created;
}

export async function attachWaitlistToLeague(input: {
  leagueId: number;
  waitlistId: number;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, input.leagueId)).limit(1);
  if (!league) {
    throw new WaitlistEntityValidationError({ leagueId: 'League was not found.' });
  }
  const [waitlist] = await db
    .select()
    .from(schema.leagueWaitlists)
    .where(eq(schema.leagueWaitlists.id, input.waitlistId))
    .limit(1);
  if (!waitlist || waitlist.status !== 'active') {
    throw new WaitlistEntityValidationError({ waitlistId: 'Waitlist was not found.' });
  }

  if (league.session_id != null) {
    const sessionLeagues = await db
      .select({
        id: schema.leagues.id,
        sessionId: schema.leagues.session_id,
        waitlistId: schema.leagues.waitlist_id,
      })
      .from(schema.leagues)
      .where(eq(schema.leagues.session_id, league.session_id));
    const conflictId = findSessionWaitlistAttachmentConflict(
      sessionLeagues.map((row) => ({
        id: row.id,
        sessionId: row.sessionId,
        waitlistId: row.waitlistId,
      })),
      input.leagueId,
      league.session_id,
      input.waitlistId
    );
    if (conflictId != null) {
      throw new WaitlistEntityValidationError({
        waitlistId: 'Another league in this session already uses this waitlist.',
      });
    }
  }

  await db
    .update(schema.leagues)
    .set({
      waitlist_id: input.waitlistId,
      allows_waitlist: 1,
      is_play_in_based: 0,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.leagues.id, input.leagueId));
}

export async function detachWaitlistFromLeague(leagueId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).limit(1);
  if (!league) {
    throw new WaitlistEntityValidationError({ leagueId: 'League was not found.' });
  }
  await db
    .update(schema.leagues)
    .set({ waitlist_id: null, allows_waitlist: 0, updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(schema.leagues.id, leagueId));
}

export async function createAndAttachWaitlistToLeague(input: {
  leagueId: number;
  name: string;
}) {
  const waitlist = await createLeagueWaitlist({ name: input.name });
  await attachWaitlistToLeague({ leagueId: input.leagueId, waitlistId: waitlist.id });
  return waitlist;
}

export function leagueAllowsWaitlist(league: { waitlist_id?: number | null; allows_waitlist?: number | null }): boolean {
  return league.waitlist_id != null;
}

/** Returns the id of another league in the same session already using this waitlist, if any. */
export function findSessionWaitlistAttachmentConflict(
  leagues: Array<{ id: number; sessionId: number | null; waitlistId: number | null }>,
  leagueId: number,
  sessionId: number,
  waitlistId: number
): number | null {
  const conflict = leagues.find(
    (league) => league.id !== leagueId && league.sessionId === sessionId && league.waitlistId === waitlistId
  );
  return conflict?.id ?? null;
}

export async function resolvePlacementLeagueForWaitlist(
  waitlistId: number,
  sessionId?: number | null
): Promise<{ leagueId: number; leagueName: string } | null> {
  const { db, schema } = getDrizzleDb();
  const leagues = await db
    .select({ id: schema.leagues.id, name: schema.leagues.name, sessionId: schema.leagues.session_id })
    .from(schema.leagues)
    .where(eq(schema.leagues.waitlist_id, waitlistId))
    .orderBy(asc(schema.leagues.id));
  if (leagues.length === 0) return null;
  const match =
    sessionId != null ? leagues.find((league) => league.sessionId === sessionId) ?? leagues[leagues.length - 1] : leagues[leagues.length - 1];
  return { leagueId: match.id, leagueName: match.name };
}

export async function replacementLineageFromLeagueId(replacesLeagueId: number): Promise<{
  lineageStartLeagueId: number;
  originalReplacesLeagueId: number;
}> {
  const continuity = await loadLeagueContinuityMap();
  return {
    lineageStartLeagueId: lineageRootLeagueId(replacesLeagueId, continuity),
    originalReplacesLeagueId: replacesLeagueId,
  };
}

export async function loadActiveWaitlistEntryCountsByLeagueId(leagueIds: number[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (leagueIds.length === 0) return counts;

  const { db, schema } = getDrizzleDb();
  const leagueWaitlistLinks = await db
    .select({ leagueId: schema.leagues.id, waitlistId: schema.leagues.waitlist_id })
    .from(schema.leagues)
    .where(inArray(schema.leagues.id, leagueIds));
  const waitlistIds = [
    ...new Set(leagueWaitlistLinks.map((row) => row.waitlistId).filter((id): id is number => id != null)),
  ];
  if (waitlistIds.length === 0) return counts;

  const waitlistRows = await db
    .select({ waitlistId: schema.waitlistEntries.waitlist_id, total: sql<number>`COUNT(*)` })
    .from(schema.waitlistEntries)
    .where(and(inArray(schema.waitlistEntries.waitlist_id, waitlistIds), eq(schema.waitlistEntries.status, 'active')))
    .groupBy(schema.waitlistEntries.waitlist_id);
  const countByWaitlist = new Map(waitlistRows.map((row) => [row.waitlistId, Number(row.total ?? 0)]));
  for (const link of leagueWaitlistLinks) {
    if (link.waitlistId != null) {
      counts.set(link.leagueId, countByWaitlist.get(link.waitlistId) ?? 0);
    }
  }
  return counts;
}

export async function getActiveWaitlistEntryPosition(
  waitlistId: number,
  entryId: number
): Promise<{ position: number | null; total: number }> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.waitlistEntries.id })
    .from(schema.waitlistEntries)
    .where(and(eq(schema.waitlistEntries.waitlist_id, waitlistId), eq(schema.waitlistEntries.status, 'active')))
    .orderBy(asc(schema.waitlistEntries.position_sort_key), asc(schema.waitlistEntries.joined_at), asc(schema.waitlistEntries.id));
  const index = rows.findIndex((row) => row.id === entryId);
  return {
    position: index >= 0 ? index + 1 : null,
    total: rows.length,
  };
}
