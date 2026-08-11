import { and, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { recordAndDeleteWaitlistEntry } from './waitlistAudit.js';

type WaitlistCleanupExecutor = Pick<
  ReturnType<typeof getDrizzleDb>['db'],
  'select' | 'delete' | 'insert'
>;

/**
 * Drops waitlist entries this registration created for leagues the registrant
 * has since removed from their priority list, or that are now guaranteed and so
 * no longer need a queue spot.
 */
export async function removeOrphanedRegistrationWaitlistEntries(input: {
  registrationId: number;
  curlerMemberId: number;
  actorMemberId: number;
  /** Leagues that should keep an active waitlist entry. */
  waitlistedLeagueIds: Iterable<number>;
  tx?: WaitlistCleanupExecutor;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const keepLeagueIds = new Set(input.waitlistedLeagueIds);

  const entries = await executor
    .select()
    .from(schema.waitlistEntries)
    .where(
      and(
        eq(schema.waitlistEntries.member_id, input.curlerMemberId),
        eq(schema.waitlistEntries.source_registration_id, input.registrationId),
        eq(schema.waitlistEntries.status, 'active')
      )
    );

  for (const entry of entries) {
    const [league] = await executor
      .select({ id: schema.leagues.id, name: schema.leagues.name })
      .from(schema.leagues)
      .where(eq(schema.leagues.waitlist_id, entry.waitlist_id))
      .limit(1);
    if (!league || keepLeagueIds.has(league.id)) continue;

    await recordAndDeleteWaitlistEntry(executor, {
      entry,
      leagueId: league.id,
      actorMemberId: input.actorMemberId,
      source: 'registration_submission',
      reason: 'WAITLIST_REMOVED_FROM_REGISTRATION_EDIT',
      metadata: { sourceRegistrationId: input.registrationId, reason: 'REGISTRATION_EDIT' },
    });
  }
}

/**
 * Drops waitlist entries the registrant holds from any source for leagues that
 * are no longer on their priority list at all.
 */
export async function removeWaitlistEntriesNotOnPriorityList(input: {
  curlerMemberId: number;
  actorMemberId: number;
  priorityLeagueIds: Iterable<number>;
  tx?: WaitlistCleanupExecutor;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const keepLeagueIds = new Set(input.priorityLeagueIds);

  const entries = await executor
    .select()
    .from(schema.waitlistEntries)
    .where(and(eq(schema.waitlistEntries.member_id, input.curlerMemberId), eq(schema.waitlistEntries.status, 'active')));

  for (const entry of entries) {
    const [league] = await executor
      .select({ id: schema.leagues.id })
      .from(schema.leagues)
      .where(eq(schema.leagues.waitlist_id, entry.waitlist_id))
      .limit(1);
    if (!league || keepLeagueIds.has(league.id)) continue;

    await recordAndDeleteWaitlistEntry(executor, {
      entry,
      leagueId: league.id,
      actorMemberId: input.actorMemberId,
      source: 'registration_submission',
      reason: 'WAITLIST_REMOVED_FROM_REGISTRATION',
      metadata: { reason: 'REGISTRATION_PRIORITY_LIST_REMOVAL' },
    });
  }
}
