import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { MAX_DESIRED_LEAGUE_COUNT, type CurlingRegistrationStatusSqlite } from '../db/drizzle-schema.js';

type PlacementExecutor = Pick<ReturnType<typeof getDrizzleDb>['db'], 'select' | 'update' | 'delete'>;

const LIVE_REGISTRATION_STATUSES: CurlingRegistrationStatusSqlite[] = [
  'submitted',
  'awaiting_payment',
  'payment_started',
  'awaiting_placement',
  'awaiting_staff_review',
  'confirmed',
  'paid',
];

/**
 * The registrant's priority list for a session: how many leagues they want and
 * where each league they asked for sits in their ordering.
 */
export async function loadMemberPriorityContext(
  executor: PlacementExecutor,
  memberId: number,
  sessionId: number,
): Promise<{ desiredLeagueCount: number | null; rankByLeagueId: Map<number, number> } | null> {
  const { schema } = getDrizzleDb();
  const [registration] = await executor
    .select({
      id: schema.curlingRegistrations.id,
      desiredLeagueCount: schema.curlingRegistrations.desired_league_count,
    })
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.curler_member_id, memberId),
        eq(schema.curlingRegistrations.session_id, sessionId),
        inArray(schema.curlingRegistrations.status, LIVE_REGISTRATION_STATUSES),
      ),
    )
    .orderBy(desc(schema.curlingRegistrations.id))
    .limit(1);
  if (!registration) return null;

  const priorities = await executor
    .select({
      leagueId: schema.registrationLeaguePriorities.league_id,
      priorityRank: schema.registrationLeaguePriorities.priority_rank,
    })
    .from(schema.registrationLeaguePriorities)
    .where(eq(schema.registrationLeaguePriorities.registration_id, registration.id));

  return {
    desiredLeagueCount: registration.desiredLeagueCount ?? null,
    rankByLeagueId: new Map(priorities.map((priority) => [priority.leagueId, priority.priorityRank])),
  };
}

/**
 * Keeps a member's placements within the league count they asked for. When a new
 * placement pushes them over, their lowest-priority held league is released —
 * this is what replaces the old explicit REPLACE waitlist entry.
 *
 * Returns the leagues that were released.
 */
export async function releaseOverflowLeaguePlacements(input: {
  tx?: PlacementExecutor;
  memberId: number;
  sessionId: number;
  /** Never release this league; it is the placement that just happened. */
  keepLeagueId: number;
}): Promise<number[]> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;

  const priorityContext = await loadMemberPriorityContext(executor, input.memberId, input.sessionId);
  const desiredLeagueCount = priorityContext?.desiredLeagueCount ?? null;
  if (desiredLeagueCount == null) return [];

  const held = await executor
    .select({
      id: schema.leagueRoster.id,
      leagueId: schema.leagueRoster.league_id,
    })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .where(
      and(
        eq(schema.leagueRoster.member_id, input.memberId),
        eq(schema.leagueRoster.status, 'active'),
        eq(schema.leagues.session_id, input.sessionId),
      ),
    );
  const overflow = held.length - desiredLeagueCount;
  if (overflow <= 0) return [];

  // Unranked leagues (staff placements, say) sort last so they are released first.
  const releaseOrder = held
    .filter((row) => row.leagueId !== input.keepLeagueId)
    .sort(
      (a, b) =>
        (priorityContext?.rankByLeagueId.get(b.leagueId) ?? MAX_DESIRED_LEAGUE_COUNT + 1) -
        (priorityContext?.rankByLeagueId.get(a.leagueId) ?? MAX_DESIRED_LEAGUE_COUNT + 1),
    )
    .slice(0, overflow);

  for (const row of releaseOrder) {
    await executor
      .update(schema.leagueRoster)
      .set({ status: 'removed', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.leagueRoster.id, row.id));
  }
  return releaseOrder.map((row) => row.leagueId);
}
