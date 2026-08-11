import { and, eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { WaitlistOfferKindSqlite } from '../db/drizzle-schema.js';
import type { WaitlistAuditInput } from './waitlistAudit.js';

export type WaitlistEntryCoordinationRow = {
  id: number;
  member_id: number;
  waitlist_id: number;
  source_registration_id: number | null;
  /** Rank of this league on the member's priority list at submit. */
  priority_rank: number | null;
  /** How many leagues the member wants in total. */
  desired_league_count: number | null;
  status: string;
};

function fulfillmentGroupKey(entry: Pick<WaitlistEntryCoordinationRow, 'member_id' | 'source_registration_id'>): string {
  return `${entry.member_id}:${entry.source_registration_id ?? 'none'}`;
}

export function sortEntriesByPriority(entries: WaitlistEntryCoordinationRow[]): WaitlistEntryCoordinationRow[] {
  return [...entries].sort((a, b) => {
    const rankA = a.priority_rank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.priority_rank ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.id - b.id;
  });
}

/** Leagues the member currently holds for the session, ignoring sabbatical fills. */
export async function countActiveLeaguesForMember(memberId: number, sessionId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .where(
      and(
        eq(schema.leagueRoster.member_id, memberId),
        eq(schema.leagues.session_id, sessionId),
        eq(schema.leagueRoster.status, 'active'),
        eq(schema.leagueRoster.is_temporary_sabbatical_fill, 0),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function countPendingPermanentOffersForMember(input: {
  memberId: number;
  sessionId: number;
  excludeOfferId?: number;
}): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.waitlistOffers.id })
    .from(schema.waitlistOffers)
    .innerJoin(schema.leagues, eq(schema.waitlistOffers.league_id, schema.leagues.id))
    .where(
      and(
        eq(schema.waitlistOffers.member_id, input.memberId),
        eq(schema.leagues.session_id, input.sessionId),
        eq(schema.waitlistOffers.status, 'pending'),
        eq(schema.waitlistOffers.offer_type, 'permanent'),
        input.excludeOfferId ? sql`${schema.waitlistOffers.id} <> ${input.excludeOfferId}` : sql`1 = 1`,
      ),
    );
  return rows.length;
}

/**
 * How many more leagues this member can be offered before they hit the count
 * they asked for, counting leagues they already hold and offers still pending.
 */
export async function remainingWaitlistOfferSlots(
  entry: WaitlistEntryCoordinationRow,
  sessionId: number,
): Promise<number> {
  const desired = entry.desired_league_count;
  if (desired == null || desired <= 0) return Number.MAX_SAFE_INTEGER;

  const held = await countActiveLeaguesForMember(entry.member_id, sessionId);
  const pendingOffers = await countPendingPermanentOffersForMember({ memberId: entry.member_id, sessionId });
  return Math.max(0, desired - held - pendingOffers);
}

/**
 * Offers run down the member's priority list: a league is only offered when the
 * member still wants more leagues and nothing they ranked higher is still in
 * play for this round.
 */
export async function shouldOfferPermanentWaitlistEntry(input: {
  entry: WaitlistEntryCoordinationRow;
  sessionId: number;
  offerType: WaitlistOfferKindSqlite;
  alreadySelectedEntryIds: Set<number>;
}): Promise<{ allowed: boolean; reason?: string }> {
  if (input.offerType !== 'permanent' || input.entry.desired_league_count == null) {
    return { allowed: true };
  }

  const remainingSlots = await remainingWaitlistOfferSlots(input.entry, input.sessionId);
  if (remainingSlots <= 0) {
    return {
      allowed: false,
      reason: 'Member has already reached the number of leagues they asked for.',
    };
  }

  const groupEntries = await loadActiveEntriesInFulfillmentGroup(input.entry);
  const sorted = sortEntriesByPriority(groupEntries);
  const slotsUsedInBatch = sorted.filter((candidate) => input.alreadySelectedEntryIds.has(candidate.id)).length;
  if (slotsUsedInBatch >= remainingSlots) {
    return {
      allowed: false,
      reason: 'A higher-priority league from this member is already being offered.',
    };
  }

  const entryRank = input.entry.priority_rank ?? Number.MAX_SAFE_INTEGER;
  const offerableRanks = sorted
    .slice(0, remainingSlots + slotsUsedInBatch)
    .map((candidate) => candidate.priority_rank ?? Number.MAX_SAFE_INTEGER);
  if (!offerableRanks.includes(entryRank)) {
    return {
      allowed: false,
      reason: `Only priority ranks ${offerableRanks.join(', ')} can be offered right now.`,
    };
  }

  return { allowed: true };
}

async function loadActiveEntriesInFulfillmentGroup(
  entry: Pick<WaitlistEntryCoordinationRow, 'id' | 'member_id' | 'source_registration_id'>,
): Promise<WaitlistEntryCoordinationRow[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.waitlistEntries.id,
      member_id: schema.waitlistEntries.member_id,
      waitlist_id: schema.waitlistEntries.waitlist_id,
      source_registration_id: schema.waitlistEntries.source_registration_id,
      priority_rank: schema.waitlistEntries.priority_rank,
      desired_league_count: schema.waitlistEntries.desired_league_count,
      status: schema.waitlistEntries.status,
    })
    .from(schema.waitlistEntries)
    .where(
      and(
        eq(schema.waitlistEntries.member_id, entry.member_id),
        eq(schema.waitlistEntries.status, 'active'),
        entry.source_registration_id
          ? eq(schema.waitlistEntries.source_registration_id, entry.source_registration_id)
          : sql`${schema.waitlistEntries.source_registration_id} IS NULL`,
      ),
    );
  return rows as WaitlistEntryCoordinationRow[];
}

/**
 * Once a member's accepted placements fill the count they asked for, their
 * lower-priority waitlist entries are pointless — remove them and cancel any
 * offers still outstanding on them.
 */
export async function skipLowerPriorityWaitlistEntriesAfterAcceptance(input: {
  tx: any;
  acceptedEntry: WaitlistEntryCoordinationRow;
  sessionId: number;
  actorMemberId?: number | null;
  reason: string;
  createAuditEvent: (tx: any, event: WaitlistAuditInput) => Promise<void>;
}): Promise<number[]> {
  if (input.acceptedEntry.desired_league_count == null) return [];

  const remainingSlots = await remainingWaitlistOfferSlots(input.acceptedEntry, input.sessionId);
  if (remainingSlots > 0) return [];

  const groupEntries = await loadActiveEntriesInFulfillmentGroup(input.acceptedEntry);
  const acceptedRank = input.acceptedEntry.priority_rank ?? Number.MAX_SAFE_INTEGER;
  const toSkip = groupEntries.filter(
    (entry) => entry.id !== input.acceptedEntry.id && (entry.priority_rank ?? Number.MAX_SAFE_INTEGER) > acceptedRank,
  );
  if (toSkip.length === 0) return [];

  const { schema } = getDrizzleDb();
  const skippedIds: number[] = [];
  for (const entry of toSkip) {
    await input.tx
      .update(schema.waitlistEntries)
      .set({ status: 'removed', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.waitlistEntries.id, entry.id));

    const pendingOffers = await input.tx
      .select()
      .from(schema.waitlistOffers)
      .where(and(eq(schema.waitlistOffers.waitlist_entry_id, entry.id), eq(schema.waitlistOffers.status, 'pending')));
    for (const offer of pendingOffers) {
      await input.tx
        .update(schema.waitlistOffers)
        .set({
          status: 'cancelled',
          cancellation_reason: 'preference_fulfilled_elsewhere',
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.waitlistOffers.id, offer.id));
    }

    await input.createAuditEvent(input.tx, {
      waitlistEntryId: entry.id,
      memberId: entry.member_id,
      actorMemberId: input.actorMemberId ?? null,
      source: 'placement_process',
      action: 'entry_preference_skipped',
      reason: input.reason,
      before: { status: entry.status },
      after: { status: 'removed' },
      metadata: {
        acceptedEntryId: input.acceptedEntry.id,
        groupKey: fulfillmentGroupKey(entry),
      },
    });
    skippedIds.push(entry.id);
  }

  return skippedIds;
}

/**
 * Trims a bulk-offer batch so each member only receives offers for their
 * highest-priority leagues, up to the count they asked for.
 */
export function filterEntriesForBatchOffers<T extends WaitlistEntryCoordinationRow>(
  entries: T[],
  alreadySelectedEntryIds: Set<number>,
): T[] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = fulfillmentGroupKey(entry);
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  const allowedIds = new Set<number>();
  for (const groupEntries of groups.values()) {
    const desired = groupEntries.find((entry) => entry.desired_league_count != null)?.desired_league_count;
    if (desired == null) {
      for (const entry of groupEntries) allowedIds.add(entry.id);
      continue;
    }
    const sorted = sortEntriesByPriority(groupEntries as WaitlistEntryCoordinationRow[]);
    const alreadySelected = sorted.filter((entry) => alreadySelectedEntryIds.has(entry.id)).length;
    for (const entry of sorted.slice(0, Math.max(alreadySelected, desired))) {
      allowedIds.add(entry.id);
    }
  }

  return entries.filter((entry) => allowedIds.has(entry.id));
}
