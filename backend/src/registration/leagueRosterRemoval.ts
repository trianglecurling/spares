import { and, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';

type RosterRemovalExecutor = Pick<ReturnType<typeof getDrizzleDb>['db'], 'select' | 'delete'>;

/**
 * Takes members out of a league: deletes their roster rows and their spots on
 * that league's teams. Returns the number of roster rows deleted.
 */
export async function removeMembersFromLeagueRoster(input: {
  executor?: RosterRemovalExecutor;
  leagueId: number;
  memberIds: number[];
}): Promise<number> {
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) return 0;

  const { db, schema } = getDrizzleDb();
  const executor = input.executor ?? db;

  await executor
    .delete(schema.teamMembers)
    .where(
      and(
        inArray(schema.teamMembers.member_id, memberIds),
        inArray(
          schema.teamMembers.team_id,
          executor
            .select({ id: schema.leagueTeams.id })
            .from(schema.leagueTeams)
            .where(eq(schema.leagueTeams.league_id, input.leagueId)),
        ),
      ),
    );

  const deleted = await executor
    .delete(schema.leagueRoster)
    .where(and(eq(schema.leagueRoster.league_id, input.leagueId), inArray(schema.leagueRoster.member_id, memberIds)))
    .returning({ id: schema.leagueRoster.id });
  return deleted.length;
}
