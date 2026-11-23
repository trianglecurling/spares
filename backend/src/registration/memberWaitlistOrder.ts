import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { timestampToMillis } from './waitlistOfferPreference.js';
import { clampWaitlistPreferenceOrder } from './waitlistPreferenceOrder.js';
import { parseTeamRosterPlacements } from './waitlistTeamRoster.js';

export type MemberWaitlistPrioritySortKey = {
  id: number;
  priorityRank: number | null;
  joinedAt: Date | string | number;
};

export function sortMemberWaitlistPriorityEntries<T extends MemberWaitlistPrioritySortKey>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const rankA = a.priorityRank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.priorityRank ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    const joinedA = timestampToMillis(a.joinedAt) ?? 0;
    const joinedB = timestampToMillis(b.joinedAt) ?? 0;
    if (joinedA !== joinedB) return joinedA - joinedB;
    return a.id - b.id;
  });
}

/**
 * The order a member sees on their own waitlists page: team waitlists first,
 * then by priority rank. The first entry is the member's #1 waitlist.
 */
export function orderMemberWaitlistPreference<T extends MemberWaitlistPrioritySortKey & { waitlistId: number }>(
  entries: T[],
  byotWaitlistIds: ReadonlySet<number>,
): T[] {
  const flagged = entries.map((entry) => ({
    entry,
    id: entry.id,
    priorityRank: entry.priorityRank,
    joinedAt: entry.joinedAt,
    requiresByotRoster: byotWaitlistIds.has(entry.waitlistId),
  }));
  return clampWaitlistPreferenceOrder(sortMemberWaitlistPriorityEntries(flagged)).map((row) => row.entry);
}

/** Active waitlists attached to at least one bring-your-own-team league. */
export async function loadByotWaitlistIds(waitlistIds: number[]): Promise<Set<number>> {
  const ids = [...new Set(waitlistIds)];
  if (ids.length === 0) return new Set();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ waitlistId: schema.leagues.waitlist_id })
    .from(schema.leagues)
    .innerJoin(schema.leagueWaitlists, eq(schema.leagues.waitlist_id, schema.leagueWaitlists.id))
    .where(
      and(
        inArray(schema.leagues.waitlist_id, ids),
        eq(schema.leagues.league_type, 'bring_your_own_team'),
        eq(schema.leagueWaitlists.status, 'active'),
      ),
    );
  return new Set(rows.map((row) => row.waitlistId).filter((id): id is number => id != null));
}

/**
 * Each member's #1 waitlist (member id → waitlist id), counting team entries
 * that list them as a teammate. Members with no active entries are omitted.
 */
export async function loadTopWaitlistIdByMember(memberIds: number[]): Promise<Map<number, number>> {
  const wanted = new Set(memberIds.filter((id) => Number.isInteger(id) && id > 0));
  const result = new Map<number, number>();
  if (wanted.size === 0) return result;

  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.waitlistEntries.id,
      memberId: schema.waitlistEntries.member_id,
      waitlistId: schema.waitlistEntries.waitlist_id,
      priorityRank: schema.waitlistEntries.priority_rank,
      joinedAt: schema.waitlistEntries.joined_at,
      teamRosterPlacements: schema.waitlistEntries.team_roster_placements,
    })
    .from(schema.waitlistEntries)
    .where(
      and(
        eq(schema.waitlistEntries.status, 'active'),
        or(
          inArray(schema.waitlistEntries.member_id, [...wanted]),
          isNotNull(schema.waitlistEntries.team_roster_placements),
        ),
      ),
    );

  const entriesByMember = new Map<number, typeof rows>();
  for (const row of rows) {
    if (!wanted.has(row.memberId)) continue;
    const list = entriesByMember.get(row.memberId) ?? [];
    list.push(row);
    entriesByMember.set(row.memberId, list);
  }
  const primaryWaitlistIdsByMember = new Map(
    [...entriesByMember.entries()].map(([memberId, list]) => [memberId, new Set(list.map((row) => row.waitlistId))]),
  );
  for (const row of rows) {
    for (const placement of parseTeamRosterPlacements(row.teamRosterPlacements)) {
      const memberId = placement.memberId;
      if (memberId === row.memberId || !wanted.has(memberId)) continue;
      if (primaryWaitlistIdsByMember.get(memberId)?.has(row.waitlistId)) continue;
      const list = entriesByMember.get(memberId) ?? [];
      list.push(row);
      entriesByMember.set(memberId, list);
    }
  }

  const byotWaitlistIds = await loadByotWaitlistIds(rows.map((row) => row.waitlistId));
  for (const [memberId, list] of entriesByMember) {
    const top = orderMemberWaitlistPreference(list, byotWaitlistIds)[0];
    if (top) result.set(memberId, top.waitlistId);
  }
  return result;
}
