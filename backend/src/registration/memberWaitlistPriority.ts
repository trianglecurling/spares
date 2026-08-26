import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { RegistrationMemberValidationError, removeMemberWaitlistEntry } from './registrationMemberService.js';
import { timestampToMillis, WAITLIST_OFFER_RESPONSE_PREFERENCE_LABELS } from './waitlistOfferPreference.js';
import { insertWaitlistAuditEvent } from './waitlistAudit.js';
import { isPrimaryWaitlistEntryMember, waitlistEntryIncludesMember } from './waitlistMemberMembership.js';
import { getMemberWaitlistJoinContext, joinMemberWaitlist } from './memberWaitlistJoinService.js';
import { getActiveWaitlistEntryPosition } from './waitlistEntityService.js';
import { listWaitlistsOverview } from './waitlistStaffService.js';
import { hydrateTeamRosterPlacementsForEntry } from './waitlistTeamRoster.js';
import { clampWaitlistPreferenceOrder, isWaitlistPreferenceOrderClamped } from './waitlistPreferenceOrder.js';
import { sendWaitlistEntriesJoinedNotifications } from './waitlistJoinedNotificationService.js';

export type MemberWaitlistPrioritySortKey = {
  id: number;
  priorityRank: number | null;
  joinedAt: Date | string | number;
};

export type MemberWaitlistSaveEntry = {
  waitlistId: number;
  teamRosterText?: string | null;
  teamRosterPlacements?: Array<{ memberId: number }> | null;
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

export function nextTrailingPriorityRank(
  entries: Array<{ id: number; priorityRank: number | null }>,
  excludeEntryId?: number,
): number {
  const maxRank = entries
    .filter((entry) => entry.id !== excludeEntryId)
    .reduce((max, entry) => Math.max(max, entry.priorityRank ?? 0), 0);
  return maxRank + 1;
}

/** Fill null ranks after the current max, preserving registration-derived ranks. */
export function fillNullPriorityRanks<T extends MemberWaitlistPrioritySortKey>(
  entries: T[],
): Array<{ id: number; priorityRank: number }> {
  const maxRank = entries.reduce((max, entry) => Math.max(max, entry.priorityRank ?? 0), 0);
  return sortMemberWaitlistPriorityEntries(entries.filter((entry) => entry.priorityRank == null)).map(
    (entry, index) => ({
      id: entry.id,
      priorityRank: maxRank + index + 1,
    }),
  );
}

export function compactPriorityRanks(orderedEntryIds: number[]): Array<{ id: number; priorityRank: number }> {
  return orderedEntryIds.map((id, index) => ({ id, priorityRank: index + 1 }));
}

type ActiveEntryRow = {
  id: number;
  memberId: number;
  waitlistId: number;
  priorityRank: number | null;
  desiredLeagueCount: number | null;
  offerResponsePreference: string;
  teamRosterText: string | null;
  teamRosterPlacements: string | null;
  joinedAt: Date | string;
  sourceRegistrationId: number | null;
};

const activeEntrySelect = () => {
  const { schema } = getDrizzleDb();
  return {
    id: schema.waitlistEntries.id,
    memberId: schema.waitlistEntries.member_id,
    waitlistId: schema.waitlistEntries.waitlist_id,
    priorityRank: schema.waitlistEntries.priority_rank,
    desiredLeagueCount: schema.waitlistEntries.desired_league_count,
    offerResponsePreference: schema.waitlistEntries.offer_response_preference,
    teamRosterText: schema.waitlistEntries.team_roster_text,
    teamRosterPlacements: schema.waitlistEntries.team_roster_placements,
    joinedAt: schema.waitlistEntries.joined_at,
    sourceRegistrationId: schema.waitlistEntries.source_registration_id,
  };
};

async function loadPrimaryActiveEntries(memberId: number): Promise<ActiveEntryRow[]> {
  const { db, schema } = getDrizzleDb();
  return db
    .select(activeEntrySelect())
    .from(schema.waitlistEntries)
    .where(and(eq(schema.waitlistEntries.member_id, memberId), eq(schema.waitlistEntries.status, 'active')));
}

async function loadTeammateActiveEntries(memberId: number, occupiedWaitlistIds: Set<number>): Promise<ActiveEntryRow[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select(activeEntrySelect())
    .from(schema.waitlistEntries)
    .where(and(eq(schema.waitlistEntries.status, 'active'), isNotNull(schema.waitlistEntries.team_roster_placements)));

  return rows.filter(
    (row) =>
      !occupiedWaitlistIds.has(row.waitlistId) &&
      row.memberId !== memberId &&
      waitlistEntryIncludesMember(memberId, {
        memberId: row.memberId,
        teamRosterPlacements: row.teamRosterPlacements,
      }),
  );
}

async function loadAllActiveEntriesForMember(memberId: number): Promise<ActiveEntryRow[]> {
  const primary = await loadPrimaryActiveEntries(memberId);
  const occupiedWaitlistIds = new Set(primary.map((entry) => entry.waitlistId));
  const teammate = await loadTeammateActiveEntries(memberId, occupiedWaitlistIds);
  return [...primary, ...teammate];
}

async function persistPriorityRanks(
  updates: Array<{ id: number; priorityRank: number }>,
  actorMemberId: number,
  reason: string,
): Promise<void> {
  if (updates.length === 0) return;
  const { db, schema } = getDrizzleDb();
  const ids = updates.map((update) => update.id);
  const currentRows = await db
    .select({
      id: schema.waitlistEntries.id,
      memberId: schema.waitlistEntries.member_id,
      waitlistId: schema.waitlistEntries.waitlist_id,
      priorityRank: schema.waitlistEntries.priority_rank,
    })
    .from(schema.waitlistEntries)
    .where(inArray(schema.waitlistEntries.id, ids));
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const changed = updates.filter((update) => currentById.get(update.id)?.priorityRank !== update.priorityRank);
  if (changed.length === 0) return;

  await db.transaction(async (tx) => {
    for (const update of changed) {
      const before = currentById.get(update.id);
      if (!before) continue;
      await tx
        .update(schema.waitlistEntries)
        .set({ priority_rank: update.priorityRank, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(eq(schema.waitlistEntries.id, update.id));
      await insertWaitlistAuditEvent(tx, {
        waitlistEntryId: update.id,
        memberId: before.memberId,
        actorMemberId,
        source: 'member_self',
        action: 'entry_priority_changed',
        reason,
        before: { priority_rank: before.priorityRank },
        after: { priority_rank: update.priorityRank },
      });
    }
  });
}

type WaitlistOverview = Awaited<ReturnType<typeof listWaitlistsOverview>>['waitlists'][number];

function attachedLeagueSummaries(waitlist: WaitlistOverview | undefined) {
  return (waitlist?.attachedLeagues ?? []).map((league) => ({
    id: league.id,
    name: league.name,
    sessionId: league.sessionId,
    sessionName: league.sessionName,
    leagueType: league.leagueType,
  }));
}

function requiresByotRoster(waitlist: WaitlistOverview | undefined): boolean {
  return (waitlist?.attachedLeagues ?? []).some((league) => league.leagueType === 'bring_your_own_team');
}

function withRosterFlag<T extends { waitlistId: number }>(
  entries: T[],
  waitlistById: Map<number, WaitlistOverview>,
): Array<T & { requiresByotRoster: boolean }> {
  return entries.map((entry) => ({
    ...entry,
    requiresByotRoster: requiresByotRoster(waitlistById.get(entry.waitlistId)),
  }));
}

async function persistClampedPreferenceOrder(
  entries: ActiveEntryRow[],
  waitlistById: Map<number, WaitlistOverview>,
  actorMemberId: number,
  reason: string,
): Promise<ActiveEntryRow[]> {
  const sorted = sortMemberWaitlistPriorityEntries(withRosterFlag(entries, waitlistById));
  if (isWaitlistPreferenceOrderClamped(sorted)) {
    return sorted;
  }
  const clamped = clampWaitlistPreferenceOrder(sorted);
  await persistPriorityRanks(compactPriorityRanks(clamped.map((entry) => entry.id)), actorMemberId, reason);
  const byId = new Map(clamped.map((entry, index) => [entry.id, { ...entry, priorityRank: index + 1 }]));
  return entries
    .map((entry) => byId.get(entry.id) ?? entry)
    .sort((left, right) => (left.priorityRank ?? 0) - (right.priorityRank ?? 0));
}

async function backfillMemberWaitlistPreference(memberId: number): Promise<ActiveEntryRow[]> {
  const overview = await listWaitlistsOverview();
  const waitlistById = new Map(overview.waitlists.map((waitlist) => [waitlist.id, waitlist]));
  const entries = await loadAllActiveEntriesForMember(memberId);
  const fills = fillNullPriorityRanks(
    entries.map((entry) => ({
      id: entry.id,
      priorityRank: entry.priorityRank,
      joinedAt: entry.joinedAt,
    })),
  );
  if (fills.length > 0) {
    await persistPriorityRanks(fills, memberId, 'Backfill waitlist preference from join order.');
  }
  const afterFill = fills.length > 0 ? await loadAllActiveEntriesForMember(memberId) : entries;
  return persistClampedPreferenceOrder(
    afterFill,
    waitlistById,
    memberId,
    'Clamp waitlist preference so team waitlists stay above individual waitlists.',
  );
}

export async function assignTrailingWaitlistPriorityRank(memberId: number, entryId: number): Promise<void> {
  const entries = await loadAllActiveEntriesForMember(memberId);
  const current = entries.find((entry) => entry.id === entryId);
  if (!current || current.priorityRank != null) return;
  const nextRank = nextTrailingPriorityRank(entries, entryId);
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.waitlistEntries)
    .set({ priority_rank: nextRank, updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(schema.waitlistEntries.id, entryId));
  await backfillMemberWaitlistPreference(memberId);
}

async function loadPendingOffersByEntryId(entryIds: number[]) {
  if (entryIds.length === 0) return new Map<number, { id: number; offerType: string; expiresAt: Date | string }>();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.waitlistOffers.id,
      entryId: schema.waitlistOffers.waitlist_entry_id,
      offerType: schema.waitlistOffers.offer_type,
      expiresAt: schema.waitlistOffers.expires_at,
    })
    .from(schema.waitlistOffers)
    .where(and(inArray(schema.waitlistOffers.waitlist_entry_id, entryIds), eq(schema.waitlistOffers.status, 'pending')));
  return new Map(rows.map((row) => [row.entryId, { id: row.id, offerType: row.offerType, expiresAt: row.expiresAt }]));
}

export async function getMemberWaitlists(member: Member) {
  const entries = await backfillMemberWaitlistPreference(member.id);
  const overview = await listWaitlistsOverview();
  const waitlistById = new Map(overview.waitlists.map((waitlist) => [waitlist.id, waitlist]));
  const pendingByEntryId = await loadPendingOffersByEntryId(entries.map((entry) => entry.id));
  const sorted = clampWaitlistPreferenceOrder(
    sortMemberWaitlistPriorityEntries(withRosterFlag(entries, waitlistById)),
  );

  const mappedEntries = await Promise.all(
    sorted.map(async (entry, index) => {
      const waitlist = waitlistById.get(entry.waitlistId);
      const rostered = requiresByotRoster(waitlist);
      const { position, total } = await getActiveWaitlistEntryPosition(entry.waitlistId, entry.id);
      const preference = (entry.offerResponsePreference || 'ask') as keyof typeof WAITLIST_OFFER_RESPONSE_PREFERENCE_LABELS;
      const pendingOffer = pendingByEntryId.get(entry.id) ?? null;
      const hydratedRoster = rostered
        ? await hydrateTeamRosterPlacementsForEntry({
            primaryMemberId: entry.memberId,
            teamRosterPlacementsJson: entry.teamRosterPlacements,
            teamRosterText: entry.teamRosterText,
          })
        : [];
      const isPrimaryMember = isPrimaryWaitlistEntryMember({ memberId: entry.memberId }, member.id);
      const addedByMemberName = isPrimaryMember
        ? null
        : (hydratedRoster.find((placement) => placement.memberId === entry.memberId)?.memberName ?? null);
      return {
        entryId: entry.id,
        waitlistId: entry.waitlistId,
        waitlistName: waitlist?.name ?? `Waitlist #${entry.waitlistId}`,
        priorityRank: index + 1,
        queuePosition: position,
        queueTotal: total,
        desiredLeagueCount: entry.desiredLeagueCount,
        offerResponsePreference: preference,
        offerResponsePreferenceLabel: WAITLIST_OFFER_RESPONSE_PREFERENCE_LABELS[preference] ?? 'Ask me',
        pendingOffer,
        requiresByotRoster: rostered,
        attachedLeagues: attachedLeagueSummaries(waitlist),
        canLeave: true,
        isPrimaryMember,
        addedByMemberName,
        teamMemberNames: hydratedRoster.map((placement) => placement.memberName),
      };
    }),
  );

  const occupiedWaitlistIds = new Set(sorted.map((entry) => entry.waitlistId));
  const joinableWaitlists = overview.waitlists
    .filter((waitlist) => !occupiedWaitlistIds.has(waitlist.id))
    .map((waitlist) => ({
      waitlistId: waitlist.id,
      name: waitlist.name,
      requiresByotRoster: requiresByotRoster(waitlist),
      attachedLeagues: attachedLeagueSummaries(waitlist),
    }));

  return {
    entries: mappedEntries,
    joinableWaitlists,
  };
}

export async function saveMemberWaitlists(member: Member, input: { entries: MemberWaitlistSaveEntry[] }) {
  const requested = input.entries;
  const seen = new Set<number>();
  for (const entry of requested) {
    if (!Number.isInteger(entry.waitlistId) || entry.waitlistId <= 0) {
      throw new RegistrationMemberValidationError({ waitlistId: 'Each waitlist must have a valid id.' });
    }
    if (seen.has(entry.waitlistId)) {
      throw new RegistrationMemberValidationError({ waitlistId: 'Waitlists cannot be listed more than once.' });
    }
    seen.add(entry.waitlistId);
  }

  const current = await loadAllActiveEntriesForMember(member.id);
  const currentByWaitlistId = new Map(current.map((entry) => [entry.waitlistId, entry]));
  const requestedIds = new Set(requested.map((entry) => entry.waitlistId));

  const toJoin = requested.filter((entry) => !currentByWaitlistId.has(entry.waitlistId));
  const toLeave = current.filter((entry) => !requestedIds.has(entry.waitlistId));

  const joinContexts = new Map<number, Awaited<ReturnType<typeof getMemberWaitlistJoinContext>>>();
  for (const entry of toJoin) {
    const context = await getMemberWaitlistJoinContext(member, entry.waitlistId);
    joinContexts.set(entry.waitlistId, context);
    if (!context.canJoin) {
      throw new RegistrationMemberValidationError({
        waitlistId: context.blockingErrors.join(' ') || 'You cannot join this waitlist.',
      });
    }
  }

  const joinedItems: Array<{ waitlistId: number; entryId: number; leagueName: string }> = [];
  for (const entry of toJoin) {
    const result = await joinMemberWaitlist({
      member,
      waitlistId: entry.waitlistId,
      teamRosterText: entry.teamRosterText,
      teamRosterPlacements: entry.teamRosterPlacements,
      notifyJoined: false,
    });
    const context = joinContexts.get(entry.waitlistId);
    joinedItems.push({
      waitlistId: entry.waitlistId,
      entryId: result.entryId,
      leagueName: context?.placementLeague.name ?? `Waitlist #${entry.waitlistId}`,
    });
  }

  for (const entry of toLeave) {
    await removeMemberWaitlistEntry({ entryId: entry.id, actor: member });
  }

  const remaining = await loadAllActiveEntriesForMember(member.id);
  const remainingByWaitlistId = new Map(remaining.map((entry) => [entry.waitlistId, entry]));
  const overview = await listWaitlistsOverview();
  const waitlistById = new Map(overview.waitlists.map((waitlist) => [waitlist.id, waitlist]));
  const ordered: ActiveEntryRow[] = [];
  for (const entry of requested) {
    const remainingEntry = remainingByWaitlistId.get(entry.waitlistId);
    if (!remainingEntry) {
      throw new RegistrationMemberValidationError({
        waitlistId: `Unable to update waitlist preference for waitlist ${entry.waitlistId}.`,
      });
    }
    ordered.push(remainingEntry);
  }

  const clamped = clampWaitlistPreferenceOrder(withRosterFlag(ordered, waitlistById));
  await persistPriorityRanks(
    compactPriorityRanks(clamped.map((entry) => entry.id)),
    member.id,
    'Member updated waitlist preference order.',
  );
  if (joinedItems.length > 0) {
    await sendWaitlistEntriesJoinedNotifications({
      addedByMemberId: member.id,
      addedBySource: 'member_self',
      items: joinedItems.map((item) => ({
        waitlistId: item.waitlistId,
        entryId: item.entryId,
        leagueName: item.leagueName,
        registrationId: remainingByWaitlistId.get(item.waitlistId)?.sourceRegistrationId ?? null,
      })),
    });
  }
  return getMemberWaitlists(member);
}
