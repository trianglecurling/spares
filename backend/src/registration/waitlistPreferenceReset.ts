import { and, desc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { updateWaitlistOfferPreference } from './waitlistAudit.js';
import { isPriorityEditableRegistrationStatus } from './registrationPriorityEdit.js';
import {
  WAITLIST_OFFER_RESPONSE_PREFERENCE_LABELS,
  isEnteringPriorityRegistration,
  shouldResetWaitlistPreferenceForPriorityOpen,
  type RegistrationWindowState,
} from './waitlistOfferPreference.js';

type WaitlistPreferenceResetExecutor = Pick<
  ReturnType<typeof getDrizzleDb>['db'],
  'select' | 'insert' | 'update' | 'delete'
>;

async function loadEffectiveRegistrationStates(
  seasonId: number,
  sessionId: number,
  at: Date,
): Promise<{ current: RegistrationWindowState | null; previous: RegistrationWindowState | null; openedAt: Date | string | null }> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      state: schema.registrationStateTransitions.state,
      effectiveAt: schema.registrationStateTransitions.effective_at,
    })
    .from(schema.registrationStateTransitions)
    .where(
      and(
        eq(schema.registrationStateTransitions.season_id, seasonId),
        eq(schema.registrationStateTransitions.session_id, sessionId),
        lte(schema.registrationStateTransitions.effective_at, at as never),
      ),
    )
    .orderBy(desc(schema.registrationStateTransitions.effective_at), desc(schema.registrationStateTransitions.id))
    .limit(2);

  return {
    current: (rows[0]?.state as RegistrationWindowState | undefined) ?? null,
    previous: (rows[1]?.state as RegistrationWindowState | undefined) ?? null,
    openedAt: rows[0]?.effectiveAt ?? null,
  };
}

export async function resetSessionWaitlistOfferPreferencesToAsk(input: {
  sessionId: number;
  priorityOpenedAt: Date | string;
  tx?: WaitlistPreferenceResetExecutor;
}): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const leagues = await executor
    .select({
      id: schema.leagues.id,
      waitlistId: schema.leagues.waitlist_id,
    })
    .from(schema.leagues)
    .where(and(eq(schema.leagues.session_id, input.sessionId), isNotNull(schema.leagues.waitlist_id)));
  const waitlistIds = leagues
    .map((league) => league.waitlistId)
    .filter((waitlistId): waitlistId is number => waitlistId != null);
  if (waitlistIds.length === 0) return 0;

  const leagueIdByWaitlistId = new Map(leagues.map((league) => [league.waitlistId, league.id]));
  const entries = await executor
    .select()
    .from(schema.waitlistEntries)
    .where(and(inArray(schema.waitlistEntries.waitlist_id, waitlistIds), eq(schema.waitlistEntries.status, 'active')));

  let updated = 0;
  const askLabel = WAITLIST_OFFER_RESPONSE_PREFERENCE_LABELS.ask;
  const confirmedRegistrationIds = new Set<number>();
  const rejectedRegistrationIds = new Set<number>();
  for (const entry of entries) {
    if (
      !shouldResetWaitlistPreferenceForPriorityOpen({
        preference: entry.offer_response_preference,
        updatedAt: entry.updated_at,
        priorityOpenedAt: input.priorityOpenedAt,
      })
    ) {
      continue;
    }
    const sourceRegistrationId = entry.source_registration_id ?? null;
    if (sourceRegistrationId != null) {
      if (confirmedRegistrationIds.has(sourceRegistrationId)) continue;
      if (!rejectedRegistrationIds.has(sourceRegistrationId)) {
        const [registration] = await executor
          .select({ status: schema.curlingRegistrations.status })
          .from(schema.curlingRegistrations)
          .where(eq(schema.curlingRegistrations.id, sourceRegistrationId))
          .limit(1);
        if (registration && isPriorityEditableRegistrationStatus(registration.status)) {
          confirmedRegistrationIds.add(sourceRegistrationId);
          continue;
        }
        rejectedRegistrationIds.add(sourceRegistrationId);
      }
    }
    const changed = await updateWaitlistOfferPreference(executor, {
      entry,
      leagueId: leagueIdByWaitlistId.get(entry.waitlist_id) ?? null,
      preference: 'ask',
      source: 'system_cleanup',
      reason: 'WAITLIST_PREFERENCE_RESET_FOR_PRIORITY_OPEN',
      summary: `Waitlist offer preference set to ${askLabel.toLowerCase()} because priority registration opened`,
      metadata: { reason: 'PRIORITY_REGISTRATION_OPENED' },
    });
    if (changed) updated += 1;
  }
  return updated;
}

/**
 * When a session's current window has just become priority, flip active
 * waitlist entries for that session to Ask. Registrations that already
 * confirmed a preference after the opening are left alone.
 */
export async function syncWaitlistOfferPreferencesForPriorityOpen(input?: {
  seasonId?: number;
  sessionId?: number;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const now = new Date();
  const sessions =
    input?.seasonId != null && input.sessionId != null
      ? [{ seasonId: input.seasonId, sessionId: input.sessionId }]
      : (
          await db
            .select({
              seasonId: schema.registrationStateTransitions.season_id,
              sessionId: schema.registrationStateTransitions.session_id,
            })
            .from(schema.registrationStateTransitions)
        ).filter(
          (row, index, all) =>
            all.findIndex((candidate) => candidate.seasonId === row.seasonId && candidate.sessionId === row.sessionId) ===
            index,
        );

  for (const session of sessions) {
    const { current, previous, openedAt } = await loadEffectiveRegistrationStates(
      session.seasonId,
      session.sessionId,
      now,
    );
    if (!current || !openedAt || !isEnteringPriorityRegistration(previous, current)) continue;
    await resetSessionWaitlistOfferPreferencesToAsk({
      sessionId: session.sessionId,
      priorityOpenedAt: openedAt,
    });
  }
}
