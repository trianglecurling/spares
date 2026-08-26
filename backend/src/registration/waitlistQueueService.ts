import { randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { timestampToMillis } from './waitlistOfferPreference.js';
import { WaitlistStaffValidationError } from './waitlistErrors.js';
import {
  clampFrozenEntryCount,
  compactWaitlistPositionSortKey,
  compareStoredWaitlistOrder,
  lifetimeInsertIndex,
  nextFrozenEntryCountAfterRemoval,
  sortWaitlistQueue,
  storedIndexById,
  type WaitlistQueueOrderEntry,
} from './waitlistQueueOrder.js';
import {
  emptyWaitlistQueueMemberStats,
  loadWaitlistQueueMemberStats,
  type WaitlistQueueMemberStats,
} from './waitlistQueueMemberStats.js';

type WaitlistQueueDb = {
  select: ReturnType<typeof getDrizzleDb>['db']['select'];
  update: ReturnType<typeof getDrizzleDb>['db']['update'];
};

export type StoredWaitlistQueueRow = {
  id: number;
  memberId: number;
  positionSortKey: string;
  joinedAt: Date | string | number;
  teamRosterPlacements: string | null;
};

export type RenderedWaitlistQueueEntry = StoredWaitlistQueueRow &
  WaitlistQueueOrderEntry & {
    rosterMemberIds: number[];
  };

function defaultDb(): WaitlistQueueDb {
  return getDrizzleDb().db;
}

function compareStoredQueueRows(a: StoredWaitlistQueueRow, b: StoredWaitlistQueueRow): number {
  return compareStoredWaitlistOrder(
    {
      id: a.id,
      positionSortKey: a.positionSortKey,
      joinedAtMs: timestampToMillis(a.joinedAt) ?? 0,
    },
    {
      id: b.id,
      positionSortKey: b.positionSortKey,
      joinedAtMs: timestampToMillis(b.joinedAt) ?? 0,
    },
  );
}

function parseRosterMemberIds(primaryMemberId: number, teamRosterPlacements: string | null): number[] {
  const ids = [primaryMemberId];
  if (!teamRosterPlacements?.trim()) return [...new Set(ids)];
  try {
    const parsed = JSON.parse(teamRosterPlacements) as unknown;
    if (!Array.isArray(parsed)) return [...new Set(ids)];
    for (const item of parsed) {
      const memberId = Number((item as { memberId?: unknown } | null)?.memberId);
      if (Number.isInteger(memberId) && memberId > 0) ids.push(memberId);
    }
  } catch {
    return [...new Set(ids)];
  }
  return [...new Set(ids)];
}

function aggregateRosterStats(
  rosterMemberIds: number[],
  statsByMember: Map<number, WaitlistQueueMemberStats>,
): { clubTenureYears: number; tieBreakerYears: number } {
  let clubTenureYears = 0;
  let otherClubYears = 0;
  let totalExperienceYears = 0;
  const isRoster = rosterMemberIds.length > 1;
  for (const memberId of rosterMemberIds) {
    const stats = statsByMember.get(memberId) ?? emptyWaitlistQueueMemberStats();
    clubTenureYears += stats.clubTenureYears;
    otherClubYears += stats.otherClubYears;
    totalExperienceYears += stats.totalExperienceYears;
  }
  return {
    clubTenureYears,
    tieBreakerYears: isRoster ? totalExperienceYears : otherClubYears,
  };
}

export function trailingWaitlistPositionSortKey(prefix = Date.now()): string {
  return `${prefix.toString().padStart(13, '0')}:${randomBytes(6).toString('hex')}`;
}

export async function loadFrozenEntryCount(waitlistId: number, db: WaitlistQueueDb = defaultDb()): Promise<number> {
  const { schema } = getDrizzleDb();
  const [row] = await db
    .select({ frozenEntryCount: schema.leagueWaitlists.frozen_entry_count })
    .from(schema.leagueWaitlists)
    .where(eq(schema.leagueWaitlists.id, waitlistId))
    .limit(1);
  return Math.max(0, Number(row?.frozenEntryCount ?? 0));
}

export async function persistFrozenEntryCount(
  waitlistId: number,
  frozenEntryCount: number,
  db: WaitlistQueueDb = defaultDb(),
): Promise<number> {
  const { schema } = getDrizzleDb();
  const count = Math.max(0, Math.floor(frozenEntryCount));
  await db
    .update(schema.leagueWaitlists)
    .set({ frozen_entry_count: count, updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(schema.leagueWaitlists.id, waitlistId));
  return count;
}

export async function loadStoredActiveWaitlistEntries(
  waitlistId: number,
  db: WaitlistQueueDb = defaultDb(),
): Promise<StoredWaitlistQueueRow[]> {
  const { schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.waitlistEntries.id,
      memberId: schema.waitlistEntries.member_id,
      positionSortKey: schema.waitlistEntries.position_sort_key,
      joinedAt: schema.waitlistEntries.joined_at,
      teamRosterPlacements: schema.waitlistEntries.team_roster_placements,
    })
    .from(schema.waitlistEntries)
    .where(and(eq(schema.waitlistEntries.waitlist_id, waitlistId), eq(schema.waitlistEntries.status, 'active')))
    .orderBy(
      asc(schema.waitlistEntries.position_sort_key),
      asc(schema.waitlistEntries.joined_at),
      asc(schema.waitlistEntries.id),
    );
  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    positionSortKey: row.positionSortKey,
    joinedAt: row.joinedAt,
    teamRosterPlacements: row.teamRosterPlacements ?? null,
  }));
}

async function toRenderedEntries(
  stored: StoredWaitlistQueueRow[],
  frozenEntryCount: number,
): Promise<RenderedWaitlistQueueEntry[]> {
  const rosterIdsByEntry = new Map(stored.map((row) => [row.id, parseRosterMemberIds(row.memberId, row.teamRosterPlacements)]));
  const memberIds = [...new Set(stored.flatMap((row) => rosterIdsByEntry.get(row.id) ?? [row.memberId]))];
  const statsByMember = await loadWaitlistQueueMemberStats(memberIds);
  const withKeys: RenderedWaitlistQueueEntry[] = stored.map((row) => {
    const rosterMemberIds = rosterIdsByEntry.get(row.id) ?? [row.memberId];
    const primaryStats = statsByMember.get(row.memberId) ?? emptyWaitlistQueueMemberStats();
    const aggregated = aggregateRosterStats(rosterMemberIds, statsByMember);
    return {
      ...row,
      rosterMemberIds,
      isLifetimeMember: primaryStats.isLifetimeMember,
      clubTenureYears: aggregated.clubTenureYears,
      tieBreakerYears: aggregated.tieBreakerYears,
      joinedAtMs: timestampToMillis(row.joinedAt) ?? 0,
    };
  });
  return sortWaitlistQueue(withKeys, frozenEntryCount);
}

export async function loadRenderedWaitlistOrder(
  waitlistId: number,
  db: WaitlistQueueDb = defaultDb(),
): Promise<{ frozenEntryCount: number; entries: RenderedWaitlistQueueEntry[] }> {
  const [frozenEntryCount, stored] = await Promise.all([
    loadFrozenEntryCount(waitlistId, db),
    loadStoredActiveWaitlistEntries(waitlistId, db),
  ]);
  const clamped = clampFrozenEntryCount(frozenEntryCount, stored.length);
  return {
    frozenEntryCount: clamped,
    entries: await toRenderedEntries(stored, clamped),
  };
}

export async function getActiveWaitlistEntryQueuePosition(
  waitlistId: number,
  entryId: number,
  db: WaitlistQueueDb = defaultDb(),
): Promise<{ position: number | null; total: number }> {
  const { entries } = await loadRenderedWaitlistOrder(waitlistId, db);
  const index = entries.findIndex((entry) => entry.id === entryId);
  return {
    position: index >= 0 ? index + 1 : null,
    total: entries.length,
  };
}

export async function rewriteWaitlistPositionSortKeys(
  orderedEntryIds: number[],
  db: WaitlistQueueDb = defaultDb(),
): Promise<void> {
  if (orderedEntryIds.length === 0) return;
  const { schema } = getDrizzleDb();
  for (let index = 0; index < orderedEntryIds.length; index += 1) {
    const entryId = orderedEntryIds[index]!;
    await db
      .update(schema.waitlistEntries)
      .set({
        position_sort_key: compactWaitlistPositionSortKey(index, entryId),
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.waitlistEntries.id, entryId));
  }
}

export async function releaseFrozenSlotIfNeeded(
  waitlistId: number,
  entryId: number,
  db: WaitlistQueueDb = defaultDb(),
): Promise<number> {
  const [frozenEntryCount, stored] = await Promise.all([
    loadFrozenEntryCount(waitlistId, db),
    loadStoredActiveWaitlistEntries(waitlistId, db),
  ]);
  const storedIndex = storedIndexById(stored, entryId);
  const nextCount = nextFrozenEntryCountAfterRemoval(frozenEntryCount, storedIndex);
  if (nextCount !== frozenEntryCount) {
    await persistFrozenEntryCount(waitlistId, nextCount, db);
  }
  return nextCount;
}

export async function moveWaitlistEntryToUnfrozenSet(
  waitlistId: number,
  entryId: number,
  db: WaitlistQueueDb = defaultDb(),
): Promise<{ frozenEntryCount: number; positionSortKey: string }> {
  const frozenEntryCount = await releaseFrozenSlotIfNeeded(waitlistId, entryId, db);
  const positionSortKey = trailingWaitlistPositionSortKey();
  const { schema } = getDrizzleDb();
  await db
    .update(schema.waitlistEntries)
    .set({ position_sort_key: positionSortKey, updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(schema.waitlistEntries.id, entryId));
  return { frozenEntryCount, positionSortKey };
}

export async function assignWaitlistJoinOrder(input: {
  waitlistId: number;
  entryId: number;
  isLifetimeMember: boolean;
  db?: WaitlistQueueDb;
}): Promise<{ frozenEntryCount: number }> {
  const db = input.db ?? defaultDb();
  if (!input.isLifetimeMember) {
    return { frozenEntryCount: await loadFrozenEntryCount(input.waitlistId, db) };
  }

  const [frozenEntryCount, stored] = await Promise.all([
    loadFrozenEntryCount(input.waitlistId, db),
    loadStoredActiveWaitlistEntries(input.waitlistId, db),
  ]);
  const newEntry = stored.find((row) => row.id === input.entryId);
  if (!newEntry) {
    return { frozenEntryCount };
  }

  const others = stored.filter((row) => row.id !== input.entryId).sort(compareStoredQueueRows);
  const frozen = others.slice(0, frozenEntryCount);
  const unfrozen = others.slice(frozenEntryCount);
  const statsByMember = await loadWaitlistQueueMemberStats(frozen.map((row) => row.memberId));
  const insertAt = lifetimeInsertIndex(
    frozen.map((row) => ({
      isLifetimeMember: (statsByMember.get(row.memberId) ?? emptyWaitlistQueueMemberStats()).isLifetimeMember,
    })),
  );
  const nextFrozen = [...frozen.slice(0, insertAt), newEntry, ...frozen.slice(insertAt)];
  await rewriteWaitlistPositionSortKeys(
    [...nextFrozen, ...unfrozen].map((row) => row.id),
    db,
  );
  const nextCount = frozenEntryCount + 1;
  await persistFrozenEntryCount(input.waitlistId, nextCount, db);
  return { frozenEntryCount: nextCount };
}

export async function freezeWaitlistOrder(
  waitlistId: number,
  db: WaitlistQueueDb = defaultDb(),
): Promise<{ frozenEntryCount: number; entryIds: number[] }> {
  const rendered = await loadRenderedWaitlistOrder(waitlistId, db);
  const entryIds = rendered.entries.map((entry) => entry.id);
  await rewriteWaitlistPositionSortKeys(entryIds, db);
  const frozenEntryCount = await persistFrozenEntryCount(waitlistId, entryIds.length, db);
  return { frozenEntryCount, entryIds };
}

export async function setWaitlistFrozenEntryCount(
  waitlistId: number,
  frozenEntryCount: number,
  db: WaitlistQueueDb = defaultDb(),
): Promise<{ frozenEntryCount: number; entryIds: number[] }> {
  const rendered = await loadRenderedWaitlistOrder(waitlistId, db);
  const entryIds = rendered.entries.map((entry) => entry.id);
  const nextCount = clampFrozenEntryCount(frozenEntryCount, entryIds.length);
  await rewriteWaitlistPositionSortKeys(entryIds, db);
  await persistFrozenEntryCount(waitlistId, nextCount, db);
  return { frozenEntryCount: nextCount, entryIds };
}

export async function persistStaffWaitlistOrder(input: {
  waitlistId: number;
  entryIds: number[];
  frozenEntryCount: number;
  db?: WaitlistQueueDb;
}): Promise<{ frozenEntryCount: number; entryIds: number[] }> {
  const db = input.db ?? defaultDb();
  const stored = await loadStoredActiveWaitlistEntries(input.waitlistId, db);
  const storedIds = new Set(stored.map((row) => row.id));
  if (input.entryIds.length !== stored.length || input.entryIds.some((id) => !storedIds.has(id))) {
    throw new WaitlistStaffValidationError({
      entryIds: 'One or more waitlist entries were not found for this waitlist.',
    });
  }
  const uniqueIds = new Set(input.entryIds);
  if (uniqueIds.size !== input.entryIds.length) {
    throw new WaitlistStaffValidationError({ entryIds: 'Waitlist entries cannot be listed more than once.' });
  }
  const nextCount = clampFrozenEntryCount(input.frozenEntryCount, input.entryIds.length);
  await rewriteWaitlistPositionSortKeys(input.entryIds, db);
  await persistFrozenEntryCount(input.waitlistId, nextCount, db);
  return { frozenEntryCount: nextCount, entryIds: input.entryIds };
}

export async function freezeAllWaitlistOrders(): Promise<{ waitlistIds: number[]; frozenWaitlistCount: number }> {
  const { db, schema } = getDrizzleDb();
  const waitlists = await db
    .select({ id: schema.leagueWaitlists.id })
    .from(schema.leagueWaitlists)
    .where(eq(schema.leagueWaitlists.status, 'active'));
  const waitlistIds: number[] = [];
  for (const waitlist of waitlists) {
    await freezeWaitlistOrder(waitlist.id, db);
    waitlistIds.push(waitlist.id);
  }
  return { waitlistIds, frozenWaitlistCount: waitlistIds.length };
}

export async function isLifetimeWaitlistMember(memberId: number): Promise<boolean> {
  const stats = await loadWaitlistQueueMemberStats([memberId]);
  return (stats.get(memberId) ?? emptyWaitlistQueueMemberStats()).isLifetimeMember;
}
