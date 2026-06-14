import type { FastifyReply } from 'fastify';
import { count, eq } from 'drizzle-orm';
import { sendValidationError } from '../api/errors.js';
import { getDrizzleDb } from '../db/drizzle-db.js';

export const DROP_IN_LEAGUE_NO_TEAMS_MESSAGE =
  'Drop-in leagues keep a league roster only and cannot have teams.';

export function toAllowsDropIns(value: number | boolean | undefined | null): boolean {
  return value === true || value === 1;
}

export async function leagueAllowsDropIns(leagueId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ allows_drop_ins: schema.leagues.allows_drop_ins })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);
  return row ? toAllowsDropIns(row.allows_drop_ins) : false;
}

export async function leagueTeamCount(leagueId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ teamCount: count() })
    .from(schema.leagueTeams)
    .where(eq(schema.leagueTeams.league_id, leagueId));
  return Number(row?.teamCount ?? 0);
}

export function sendDropInLeagueTeamsValidationError(
  reply: FastifyReply,
  field: 'allowsDropIns' | 'teams' = 'allowsDropIns',
  message = DROP_IN_LEAGUE_NO_TEAMS_MESSAGE
): void {
  sendValidationError(reply, message, {
    [field]: message,
  });
}
