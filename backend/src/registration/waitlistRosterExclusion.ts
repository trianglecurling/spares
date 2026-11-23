import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { WaitlistAuditSourceSqlite } from '../db/drizzle-schema.js';
import { dateColumnBindValue } from '../services/curlingSessionService.js';
import { getCurrentDateStringAsync } from '../utils/time.js';
import { insertWaitlistAuditEvent } from './waitlistAudit.js';

type ExclusionExecutor = Pick<ReturnType<typeof getDrizzleDb>['db'], 'select' | 'insert' | 'update'>;

/**
 * Members holding a permanent spot in a league attached to this waitlist, in a
 * session that has not ended. Their return is guaranteed, so they cannot also
 * wait for the league. A temporary sabbatical-fill spot does not count.
 */
export async function loadMembersRosteredForWaitlist(input: {
  executor?: Pick<ExclusionExecutor, 'select'>;
  waitlistId: number;
  memberIds: number[];
}): Promise<Set<number>> {
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) return new Set();
  const { db, schema } = getDrizzleDb();
  const executor = input.executor ?? db;
  const today = dateColumnBindValue(await getCurrentDateStringAsync());
  const rows = await executor
    .select({ memberId: schema.leagueRoster.member_id })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .innerJoin(schema.curlingSessions, eq(schema.leagues.session_id, schema.curlingSessions.id))
    .where(
      and(
        eq(schema.leagues.waitlist_id, input.waitlistId),
        inArray(schema.leagueRoster.member_id, memberIds),
        eq(schema.leagueRoster.is_temporary_sabbatical_fill, 0),
        gte(schema.curlingSessions.end_date, today as never),
      ),
    );
  return new Set(rows.map((row) => row.memberId));
}

/**
 * Removes the members' own active entries on this league's waitlist when they
 * hold a permanent spot it covers, and cancels pending offers on them.
 * Returns the removed entry ids.
 */
export async function removeWaitlistEntriesForRosteredMembers(input: {
  executor?: ExclusionExecutor;
  leagueId: number;
  memberIds: number[];
  actorMemberId?: number | null;
  source: WaitlistAuditSourceSqlite;
}): Promise<number[]> {
  if (input.memberIds.length === 0) return [];
  const { db, schema } = getDrizzleDb();
  const executor = input.executor ?? db;
  const [league] = await executor
    .select({ waitlistId: schema.leagues.waitlist_id })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, input.leagueId))
    .limit(1);
  if (league?.waitlistId == null) return [];
  const waitlistId = league.waitlistId;

  const rosteredMemberIds = await loadMembersRosteredForWaitlist({
    executor,
    waitlistId,
    memberIds: input.memberIds,
  });
  if (rosteredMemberIds.size === 0) return [];

  const entries = await executor
    .select({ id: schema.waitlistEntries.id, memberId: schema.waitlistEntries.member_id })
    .from(schema.waitlistEntries)
    .where(
      and(
        eq(schema.waitlistEntries.waitlist_id, waitlistId),
        eq(schema.waitlistEntries.status, 'active'),
        inArray(schema.waitlistEntries.member_id, [...rosteredMemberIds]),
      ),
    );
  if (entries.length === 0) return [];

  const { releaseFrozenSlotIfNeeded } = await import('./waitlistQueueService.js');
  for (const entry of entries) {
    await releaseFrozenSlotIfNeeded(waitlistId, entry.id, executor as never);
    await executor
      .update(schema.waitlistEntries)
      .set({ status: 'removed', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.waitlistEntries.id, entry.id));
    await executor
      .update(schema.waitlistOffers)
      .set({ status: 'cancelled', cancellation_reason: 'member_rostered', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(schema.waitlistOffers.waitlist_entry_id, entry.id), eq(schema.waitlistOffers.status, 'pending')));
    await insertWaitlistAuditEvent(executor, {
      waitlistEntryId: entry.id,
      leagueId: input.leagueId,
      memberId: entry.memberId,
      actorMemberId: input.actorMemberId ?? null,
      source: input.source,
      action: 'entry_removed',
      reason: 'Member is on the league roster.',
      before: { status: 'active' },
      after: { status: 'removed' },
    });
  }
  return entries.map((entry) => entry.id);
}
