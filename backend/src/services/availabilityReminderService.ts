import { eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { resolveRelevantSessionIdForLeagues } from './curlingSessionService.js';
import { getCurrentDateStringAsync } from '../utils/time.js';
import { isLeagueEligibleForSpares } from '../utils/leagueSpareEligibility.js';
import { memberIsSocialMember } from '../utils/memberMembershipHelpers.js';
import type { Member } from '../types.js';

export type AvailabilityReminderStatus = {
  visible: boolean;
  session: { id: number; name: string } | null;
};

async function sessionHasSpareEligibleLeagues(sessionId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const leagues = await db
    .select({
      format: schema.leagues.format,
      allows_drop_ins: schema.leagues.allows_drop_ins,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.session_id, sessionId));

  return leagues.some((league) => isLeagueEligibleForSpares(league));
}

export async function getAvailabilityReminderStatus(
  member: Member,
): Promise<AvailabilityReminderStatus> {
  if (memberIsSocialMember(member)) {
    return { visible: false, session: null };
  }

  const today = await getCurrentDateStringAsync();
  const sessionId = await resolveRelevantSessionIdForLeagues(today);
  if (sessionId == null) {
    return { visible: false, session: null };
  }

  const { db, schema } = getDrizzleDb();
  const [session] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
    })
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.id, sessionId))
    .limit(1);

  if (!session) {
    return { visible: false, session: null };
  }

  if (!(await sessionHasSpareEligibleLeagues(session.id))) {
    return { visible: false, session };
  }

  const [row] = await db
    .select({
      ackedSessionId: schema.members.availability_reminder_acked_session_id,
    })
    .from(schema.members)
    .where(eq(schema.members.id, member.id))
    .limit(1);

  const ackedSessionId = row?.ackedSessionId ?? null;
  const visible = ackedSessionId !== session.id;

  return {
    visible,
    session: { id: session.id, name: session.name },
  };
}

/** Mark the availability reminder acknowledged for the member's current relevant session. */
export async function ackAvailabilityReminderForRelevantSession(memberId: number): Promise<{
  success: boolean;
  sessionId: number | null;
}> {
  const today = await getCurrentDateStringAsync();
  const sessionId = await resolveRelevantSessionIdForLeagues(today);
  if (sessionId == null) {
    return { success: true, sessionId: null };
  }

  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.members)
    .set({
      availability_reminder_acked_session_id: sessionId,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.members.id, memberId));

  return { success: true, sessionId };
}
