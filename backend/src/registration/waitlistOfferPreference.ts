import { and, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { ROSTER_COMMIT_REGISTRATION_STATUS_LIST } from './registrationRosterService.js';

export type WaitlistOfferResponsePreference = 'auto_accept' | 'auto_decline';

export const WAITLIST_OFFER_RESPONSE_PREFERENCE_LABELS: Record<WaitlistOfferResponsePreference, string> = {
  auto_accept: 'Accept automatically',
  auto_decline: 'Decline automatically',
};

export function timestampToMillis(value: Date | string | number | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const isoish = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoish) ? isoish : `${isoish}Z`;
  const ms = new Date(withZone).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A waitlist entry auto-accepts when the league is on the member's current
 * registration priority list. Otherwise it auto-declines. There is no Ask-me
 * state; members who never registered have an empty list and auto-decline.
 */
export function waitlistOfferPreferenceFromPriorityList(input: {
  leagueId: number;
  priorityLeagueIds: Iterable<number>;
}): WaitlistOfferResponsePreference {
  return new Set(input.priorityLeagueIds).has(input.leagueId) ? 'auto_accept' : 'auto_decline';
}

export function waitlistOfferPreferenceForLeagues(input: {
  leagueIds: Iterable<number>;
  priorityLeagueIds: Iterable<number>;
}): WaitlistOfferResponsePreference {
  const ranked = new Set(input.priorityLeagueIds);
  for (const leagueId of input.leagueIds) {
    if (ranked.has(leagueId)) return 'auto_accept';
  }
  return 'auto_decline';
}

type PriorityLookupExecutor = Pick<ReturnType<typeof getDrizzleDb>['db'], 'select'>;

/**
 * Highest-id commit-eligible registration per member in the session, mapped to
 * the league ids on that registration's priority list.
 */
export async function loadPriorityLeagueIdsByMember(input: {
  sessionId: number;
  memberIds: number[];
  tx?: PriorityLookupExecutor;
}): Promise<Map<number, Set<number>>> {
  const result = new Map<number, Set<number>>();
  const memberIds = [...new Set(input.memberIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (memberIds.length === 0) return result;

  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const registrations = await executor
    .select({
      id: schema.curlingRegistrations.id,
      memberId: schema.curlingRegistrations.curler_member_id,
    })
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.session_id, input.sessionId),
        inArray(schema.curlingRegistrations.curler_member_id, memberIds),
        inArray(schema.curlingRegistrations.status, [...ROSTER_COMMIT_REGISTRATION_STATUS_LIST]),
      ),
    );

  const registrationIdByMember = new Map<number, number>();
  for (const row of [...registrations].sort((a, b) => b.id - a.id)) {
    if (row.memberId == null) continue;
    if (!registrationIdByMember.has(row.memberId)) registrationIdByMember.set(row.memberId, row.id);
  }
  const registrationIds = [...registrationIdByMember.values()];
  if (registrationIds.length === 0) return result;

  const memberByRegistration = new Map(
    [...registrationIdByMember.entries()].map(([memberId, registrationId]) => [registrationId, memberId]),
  );
  const priorities = await executor
    .select({
      registrationId: schema.registrationLeaguePriorities.registration_id,
      leagueId: schema.registrationLeaguePriorities.league_id,
    })
    .from(schema.registrationLeaguePriorities)
    .where(inArray(schema.registrationLeaguePriorities.registration_id, registrationIds));

  for (const row of priorities) {
    const memberId = memberByRegistration.get(row.registrationId);
    if (memberId == null) continue;
    const leagueIds = result.get(memberId) ?? new Set<number>();
    leagueIds.add(row.leagueId);
    result.set(memberId, leagueIds);
  }
  return result;
}
