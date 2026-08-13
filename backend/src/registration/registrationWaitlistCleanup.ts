import { and, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { recordAndDeleteWaitlistEntry, updateWaitlistOfferPreference } from './waitlistAudit.js';
import {
  WAITLIST_OFFER_RESPONSE_PREFERENCE_LABELS,
  waitlistOfferPreferenceAfterRegistration,
} from './waitlistOfferPreference.js';

type WaitlistCleanupExecutor = Pick<
  ReturnType<typeof getDrizzleDb>['db'],
  'select' | 'delete' | 'insert' | 'update'
>;

/**
 * Drops waitlist entries this registration created for leagues that are still
 * on the priority list but are no longer waitlisted (for example a guaranteed
 * return). Leagues left off the list stay queued with auto-decline.
 */
export async function removeOrphanedRegistrationWaitlistEntries(input: {
  registrationId: number;
  curlerMemberId: number;
  actorMemberId: number;
  /** Leagues that should keep an active waitlist entry. */
  waitlistedLeagueIds: Iterable<number>;
  /** Leagues currently on the registrant's priority list. */
  priorityLeagueIds?: Iterable<number>;
  tx?: WaitlistCleanupExecutor;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const keepLeagueIds = new Set(input.waitlistedLeagueIds);
  const priorityLeagueIds = input.priorityLeagueIds != null ? new Set(input.priorityLeagueIds) : null;

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
    if (priorityLeagueIds && !priorityLeagueIds.has(league.id)) continue;

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
 * Confirms waitlist offer preferences from a submitted priority list.
 * Leagues on the list auto-accept; session waitlists left off the list
 * auto-decline and stay in the queue. Other sessions are left alone.
 */
export async function applyRegistrationWaitlistOfferPreferences(input: {
  curlerMemberId: number;
  actorMemberId: number;
  sessionId: number;
  priorityLeagueIds: Iterable<number>;
  tx?: WaitlistCleanupExecutor;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const priorityLeagueIds = [...input.priorityLeagueIds];

  const entries = await executor
    .select()
    .from(schema.waitlistEntries)
    .where(and(eq(schema.waitlistEntries.member_id, input.curlerMemberId), eq(schema.waitlistEntries.status, 'active')));

  for (const entry of entries) {
    const [league] = await executor
      .select({ id: schema.leagues.id, sessionId: schema.leagues.session_id })
      .from(schema.leagues)
      .where(eq(schema.leagues.waitlist_id, entry.waitlist_id))
      .limit(1);
    if (!league || league.sessionId !== input.sessionId) continue;

    const preference = waitlistOfferPreferenceAfterRegistration({
      leagueId: league.id,
      priorityLeagueIds,
    });
    const preferenceLabel = WAITLIST_OFFER_RESPONSE_PREFERENCE_LABELS[preference];
    await updateWaitlistOfferPreference(executor, {
      entry,
      leagueId: league.id,
      preference,
      actorMemberId: input.actorMemberId,
      source: 'registration_submission',
      reason:
        preference === 'auto_accept'
          ? 'WAITLIST_PREFERENCE_AUTO_ACCEPT_FROM_REGISTRATION'
          : 'WAITLIST_PREFERENCE_AUTO_DECLINE_FROM_REGISTRATION',
      summary: `Waitlist offer preference set to ${preferenceLabel.toLowerCase()} from registration`,
      metadata: { reason: 'REGISTRATION_PRIORITY_LIST' },
    });
  }
}
