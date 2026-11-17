import { desc, gte, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { dateColumnBindValue } from '../services/curlingSessionService.js';
import { getCurrentDateStringAsync, getCurrentTimeAsync } from '../utils/time.js';
import { timestampToMillis } from './waitlistOfferPreference.js';
import { WaitlistStaffValidationError } from './waitlistErrors.js';

export type WaitlistOfferSessionTransition = {
  sessionId: number;
  state: string;
  effectiveAtMs: number;
};

export const WAITLIST_OFFER_SESSION_REQUIRED_MESSAGE =
  'Waitlist offers can only be sent after registration closes, for a session that has not ended.';

/** Registration for the session opened at some point and its latest state is closed. */
export function sessionRegistrationHasClosed(
  sessionId: number,
  transitions: WaitlistOfferSessionTransition[],
  nowMs: number,
): boolean {
  const effective = transitions
    .filter((transition) => transition.sessionId === sessionId && transition.effectiveAtMs <= nowMs)
    .sort((left, right) => left.effectiveAtMs - right.effectiveAtMs);
  const latest = effective.at(-1);
  if (latest?.state !== 'closed') return false;
  return effective.some((transition) => transition.state === 'priority' || transition.state === 'open');
}

/**
 * Picks the session waitlist offers fill vacancies for. Sessions are ordered
 * newest first and must not have ended yet.
 */
export function pickWaitlistOfferSessionId(input: {
  sessionIdsNewestFirst: number[];
  transitions: WaitlistOfferSessionTransition[];
  nowMs: number;
}): number | null {
  return (
    input.sessionIdsNewestFirst.find((sessionId) =>
      sessionRegistrationHasClosed(sessionId, input.transitions, input.nowMs),
    ) ?? null
  );
}

/**
 * Offers fill vacancies once a session's rosters are set, so they only apply
 * after that session's registration has closed and before the session ends.
 */
export async function resolveWaitlistOfferSession(): Promise<{ id: number; name: string } | null> {
  const { db, schema } = getDrizzleDb();
  const today = dateColumnBindValue(await getCurrentDateStringAsync());
  const sessions = await db
    .select({ id: schema.curlingSessions.id, name: schema.curlingSessions.name })
    .from(schema.curlingSessions)
    .where(gte(schema.curlingSessions.end_date, today as never))
    .orderBy(desc(schema.curlingSessions.start_date), desc(schema.curlingSessions.id));
  if (sessions.length === 0) return null;

  const transitionRows = await db
    .select({
      sessionId: schema.registrationStateTransitions.session_id,
      state: schema.registrationStateTransitions.state,
      effectiveAt: schema.registrationStateTransitions.effective_at,
    })
    .from(schema.registrationStateTransitions)
    .where(
      inArray(
        schema.registrationStateTransitions.session_id,
        sessions.map((session) => session.id),
      ),
    );
  const transitions = transitionRows.flatMap((row) => {
    const effectiveAtMs = timestampToMillis(row.effectiveAt as Date | string);
    return effectiveAtMs == null ? [] : [{ sessionId: row.sessionId, state: row.state, effectiveAtMs }];
  });

  const sessionId = pickWaitlistOfferSessionId({
    sessionIdsNewestFirst: sessions.map((session) => session.id),
    transitions,
    nowMs: (await getCurrentTimeAsync()).getTime(),
  });
  return sessions.find((session) => session.id === sessionId) ?? null;
}

export async function assertWaitlistOfferSession(sessionId: number | null): Promise<void> {
  const offerSession = await resolveWaitlistOfferSession();
  if (sessionId == null || offerSession?.id !== sessionId) {
    throw new WaitlistStaffValidationError({ offers: WAITLIST_OFFER_SESSION_REQUIRED_MESSAGE });
  }
}
