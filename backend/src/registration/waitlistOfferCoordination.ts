import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { WaitlistOfferKindSqlite } from '../db/drizzle-schema.js';
import type { WaitlistAuditInput } from './waitlistAudit.js';

export type WaitlistEntryCoordinationRow = {
  id: number;
  member_id: number;
  waitlist_id: number;
  source_registration_id: number | null;
  entry_type: 'add' | 'replace';
  desired_add_waitlist_league_count: number | null;
  add_waitlist_priority_rank: number | null;
  status: string;
};

type FulfillmentGroupKey = string;

function fulfillmentGroupKey(entry: Pick<WaitlistEntryCoordinationRow, 'member_id' | 'source_registration_id'>): FulfillmentGroupKey {
  return `${entry.member_id}:${entry.source_registration_id ?? 'none'}`;
}

export function sortAddEntriesByPriority(entries: WaitlistEntryCoordinationRow[]): WaitlistEntryCoordinationRow[] {
  return [...entries].sort((a, b) => {
    const rankA = a.add_waitlist_priority_rank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.add_waitlist_priority_rank ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.id - b.id;
  });
}

export async function countPermanentAddWaitlistPlacementsForMember(input: {
  memberId: number;
  sessionId: number;
  sourceRegistrationId?: number | null;
}): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.leagueRoster.id })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .where(
      and(
        eq(schema.leagueRoster.member_id, input.memberId),
        eq(schema.leagues.session_id, input.sessionId),
        eq(schema.leagueRoster.status, 'active'),
        eq(schema.leagueRoster.is_temporary_sabbatical_fill, 0),
        inArray(schema.leagueRoster.placement_type, ['waitlist_add', 'new_placement']),
        input.sourceRegistrationId
          ? eq(schema.leagueRoster.source_registration_id, input.sourceRegistrationId)
          : sql`1 = 1`,
      ),
    );
  return rows.length;
}

export async function countPendingPermanentOffersForMember(input: {
  memberId: number;
  sessionId: number;
  sourceRegistrationId?: number | null;
  excludeOfferId?: number;
}): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.waitlistOffers.id })
    .from(schema.waitlistOffers)
    .innerJoin(schema.waitlistEntries, eq(schema.waitlistOffers.waitlist_entry_id, schema.waitlistEntries.id))
    .innerJoin(schema.leagues, eq(schema.waitlistOffers.league_id, schema.leagues.id))
    .where(
      and(
        eq(schema.waitlistOffers.member_id, input.memberId),
        eq(schema.leagues.session_id, input.sessionId),
        eq(schema.waitlistOffers.status, 'pending'),
        eq(schema.waitlistOffers.offer_type, 'permanent'),
        eq(schema.waitlistEntries.entry_type, 'add'),
        input.sourceRegistrationId
          ? eq(schema.waitlistEntries.source_registration_id, input.sourceRegistrationId)
          : sql`1 = 1`,
        input.excludeOfferId ? sql`${schema.waitlistOffers.id} <> ${input.excludeOfferId}` : sql`1 = 1`,
      ),
    );
  return rows.length;
}

export async function countActiveFirstTwoLeaguesForMember(memberId: number, sessionId: number): Promise<number> {
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

export async function remainingAddWaitlistOfferSlots(entry: WaitlistEntryCoordinationRow, sessionId: number): Promise<number> {
  if (entry.entry_type !== 'add') return Number.MAX_SAFE_INTEGER;
  const desired = entry.desired_add_waitlist_league_count;
  if (desired == null || desired <= 0) return Number.MAX_SAFE_INTEGER;

  const activeLeagues = await countActiveFirstTwoLeaguesForMember(entry.member_id, sessionId);
  const remainingFirstTwoSlots = Math.max(0, 2 - activeLeagues);
  const targetSlots = Math.min(desired, remainingFirstTwoSlots);
  if (targetSlots <= 0) return 0;

  const placedFromRegistration = entry.source_registration_id
    ? await countPermanentAddWaitlistPlacementsForMember({
        memberId: entry.member_id,
        sessionId,
        sourceRegistrationId: entry.source_registration_id,
      })
    : 0;
  const pendingOffers = entry.source_registration_id
    ? await countPendingPermanentOffersForMember({
        memberId: entry.member_id,
        sessionId,
        sourceRegistrationId: entry.source_registration_id,
      })
    : 0;

  return Math.max(0, targetSlots - placedFromRegistration - pendingOffers);
}

export async function shouldOfferPermanentWaitlistEntry(input: {
  entry: WaitlistEntryCoordinationRow;
  sessionId: number;
  offerType: WaitlistOfferKindSqlite;
  alreadySelectedEntryIds: Set<number>;
}): Promise<{ allowed: boolean; reason?: string }> {
  if (input.offerType !== 'permanent' || input.entry.entry_type !== 'add') {
    return { allowed: true };
  }

  const remainingSlots = await remainingAddWaitlistOfferSlots(input.entry, input.sessionId);
  if (remainingSlots <= 0) {
    return {
      allowed: false,
      reason: 'Member has already reached their desired waitlist league count.',
    };
  }

  const groupEntries = await loadActiveAddEntriesInFulfillmentGroup(input.entry);
  const sorted = sortAddEntriesByPriority(groupEntries);
  const selectedInBatch = sorted.filter((candidate) => input.alreadySelectedEntryIds.has(candidate.id));
  const slotsUsedInBatch = selectedInBatch.length;
  if (slotsUsedInBatch >= remainingSlots) {
    return {
      allowed: false,
      reason: 'A higher-priority waitlist from this member is already being offered.',
    };
  }

  const nextRankSlot = slotsUsedInBatch + 1;
  const entryRank = input.entry.add_waitlist_priority_rank ?? Number.MAX_SAFE_INTEGER;
  const allowedRanks = sorted
    .slice(0, remainingSlots)
    .map((candidate) => candidate.add_waitlist_priority_rank ?? Number.MAX_SAFE_INTEGER);
  if (!allowedRanks.includes(entryRank)) {
    return {
      allowed: false,
      reason: `Only priority ranks ${allowedRanks.join(', ')} can be offered right now.`,
    };
  }

  const higherPriorityUnselected = sorted
    .filter(
      (candidate) =>
        (candidate.add_waitlist_priority_rank ?? Number.MAX_SAFE_INTEGER) < entryRank &&
        !input.alreadySelectedEntryIds.has(candidate.id),
    )
    .slice(0, Math.max(0, remainingSlots - nextRankSlot));
  if (higherPriorityUnselected.length > 0) {
    return {
      allowed: false,
      reason: 'A higher-priority waitlist must be offered before this one.',
    };
  }

  return { allowed: true };
}

async function loadActiveAddEntriesInFulfillmentGroup(
  entry: Pick<WaitlistEntryCoordinationRow, 'id' | 'member_id' | 'source_registration_id'>,
): Promise<WaitlistEntryCoordinationRow[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.waitlistEntries.id,
      member_id: schema.waitlistEntries.member_id,
      waitlist_id: schema.waitlistEntries.waitlist_id,
      source_registration_id: schema.waitlistEntries.source_registration_id,
      entry_type: schema.waitlistEntries.entry_type,
      desired_add_waitlist_league_count: schema.waitlistEntries.desired_add_waitlist_league_count,
      add_waitlist_priority_rank: schema.waitlistEntries.add_waitlist_priority_rank,
      status: schema.waitlistEntries.status,
    })
    .from(schema.waitlistEntries)
    .where(
      and(
        eq(schema.waitlistEntries.member_id, entry.member_id),
        eq(schema.waitlistEntries.entry_type, 'add'),
        eq(schema.waitlistEntries.status, 'active'),
        entry.source_registration_id
          ? eq(schema.waitlistEntries.source_registration_id, entry.source_registration_id)
          : sql`${schema.waitlistEntries.source_registration_id} IS NULL`,
      ),
    );
  return rows as WaitlistEntryCoordinationRow[];
}

export async function skipLowerPriorityWaitlistEntriesAfterAcceptance(input: {
  tx: any;
  acceptedEntry: WaitlistEntryCoordinationRow;
  sessionId: number;
  actorMemberId?: number | null;
  reason: string;
  createAuditEvent: (tx: any, event: WaitlistAuditInput) => Promise<void>;
}): Promise<number[]> {
  if (input.acceptedEntry.entry_type !== 'add' || input.acceptedEntry.desired_add_waitlist_league_count == null) {
    return [];
  }

  const remainingSlots = await remainingAddWaitlistOfferSlots(input.acceptedEntry, input.sessionId);
  if (remainingSlots > 0) return [];

  const groupEntries = await loadActiveAddEntriesInFulfillmentGroup(input.acceptedEntry);
  const acceptedRank = input.acceptedEntry.add_waitlist_priority_rank ?? Number.MAX_SAFE_INTEGER;
  const toSkip = groupEntries.filter(
    (entry) =>
      entry.id !== input.acceptedEntry.id &&
      (entry.add_waitlist_priority_rank ?? Number.MAX_SAFE_INTEGER) > acceptedRank,
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

export function filterEntriesForBatchOffers<T extends WaitlistEntryCoordinationRow>(
  entries: T[],
  alreadySelectedEntryIds: Set<number>,
): T[] {
  const addEntries = entries.filter((entry) => entry.entry_type === 'add' && entry.desired_add_waitlist_league_count != null);
  if (addEntries.length === 0) return entries;

  const groups = new Map<FulfillmentGroupKey, T[]>();
  for (const entry of entries) {
    const key = fulfillmentGroupKey(entry);
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  const allowedIds = new Set<number>();
  for (const groupEntries of groups.values()) {
    const addGroup = groupEntries.filter((entry) => entry.entry_type === 'add');
    if (addGroup.length === 0) {
      for (const entry of groupEntries) allowedIds.add(entry.id);
      continue;
    }
    const desired = addGroup.find((entry) => entry.desired_add_waitlist_league_count != null)?.desired_add_waitlist_league_count;
    if (desired == null) {
      for (const entry of groupEntries) allowedIds.add(entry.id);
      continue;
    }
    const sorted = sortAddEntriesByPriority(addGroup as WaitlistEntryCoordinationRow[]);
    const alreadySelected = sorted.filter((entry) => alreadySelectedEntryIds.has(entry.id)).length;
    const slots = Math.max(0, desired - alreadySelected);
    for (const entry of sorted.slice(0, slots + alreadySelected)) {
      if (alreadySelectedEntryIds.has(entry.id) || allowedIds.size < entries.length) {
        allowedIds.add(entry.id);
      }
    }
    for (const entry of groupEntries) {
      if (entry.entry_type !== 'add') allowedIds.add(entry.id);
    }
  }

  return entries.filter((entry) => allowedIds.has(entry.id) || entry.entry_type !== 'add');
}
