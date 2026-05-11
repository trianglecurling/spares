import { asc, eq, sql } from 'drizzle-orm';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';

export class WaitlistRolloverValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Waitlist rollover validation failed');
  }
}

export type RollWaitlistForwardInput = {
  fromLeagueId: number;
  toLeagueId?: number;
  actorMemberId?: number | null;
  reason?: string | null;
};

function dbJson(value: unknown): never {
  return (getDatabaseConfig()?.type === 'postgres' ? value : JSON.stringify(value)) as never;
}

function dbNow(): never {
  return (getDatabaseConfig()?.type === 'postgres' ? new Date() : new Date().toISOString()) as never;
}

export async function rollWaitlistForward(input: RollWaitlistForwardInput): Promise<{ rolledEntryIds: number[] }> {
  const { db, schema } = getDrizzleDb();
  const [fromLeague] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, input.fromLeagueId)).limit(1);
  if (!fromLeague) {
    throw new WaitlistRolloverValidationError({ fromLeagueId: 'Source league was not found.' });
  }
  const toLeagueId = input.toLeagueId ?? fromLeague.successor_league_id;
  if (!toLeagueId) {
    throw new WaitlistRolloverValidationError({ toLeagueId: 'A successor league is required for waitlist rollover.' });
  }
  const [toLeague] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, toLeagueId)).limit(1);
  if (!toLeague) {
    throw new WaitlistRolloverValidationError({ toLeagueId: 'Successor league was not found.' });
  }

  const entries = await db
    .select()
    .from(schema.waitlistEntries)
    .where(eq(schema.waitlistEntries.league_id, input.fromLeagueId))
    .orderBy(asc(schema.waitlistEntries.position_sort_key), asc(schema.waitlistEntries.joined_at), asc(schema.waitlistEntries.id));

  const activeEntries = entries.filter((entry) => entry.status === 'active');
  const rolledEntryIds: number[] = [];
  await db.transaction(async (tx) => {
    for (const entry of activeEntries) {
      const before = {
        id: entry.id,
        leagueId: entry.league_id,
        entryType: entry.entry_type,
        replacesLeagueId: entry.replaces_league_id,
        positionSortKey: entry.position_sort_key,
        status: entry.status,
      };
      const after = { ...before, leagueId: toLeagueId, rolledOverFromWaitlistEntryId: entry.id };
      await tx
        .update(schema.waitlistEntries)
        .set({
          league_id: toLeagueId,
          rolled_over_from_waitlist_entry_id: entry.id,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.waitlistEntries.id, entry.id));
      await tx.insert(schema.waitlistAuditEvents).values({
        waitlist_entry_id: entry.id,
        league_id: toLeagueId,
        member_id: entry.member_id,
        actor_member_id: input.actorMemberId ?? null,
        source: 'waitlist_rollover',
        action: 'entry_rolled_over',
        reason: input.reason ?? `Rolled forward from ${fromLeague.name} to ${toLeague.name}.`,
        before_json: dbJson(before),
        after_json: dbJson(after),
        metadata_json: dbJson({ fromLeagueId: input.fromLeagueId, toLeagueId }),
        created_at: dbNow(),
      });
      rolledEntryIds.push(entry.id);
    }
  });

  return { rolledEntryIds };
}
