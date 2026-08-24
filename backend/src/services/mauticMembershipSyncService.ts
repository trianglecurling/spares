import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { normalizeEmail } from '../utils/auth.js';
import { logEvent } from './observability.js';
import {
  addContactToMauticSegment,
  createMauticSegment,
  findContactIdByEmail,
  findOrCreateContactByEmail,
  isMauticConfigured,
  listSegmentContacts,
  MauticRequestError,
  removeContactFromSegment,
  renameMauticSegment,
  updateMauticContact,
} from './mauticService.js';

const LOG_PREFIX = '[Mautic Membership Sync]';

export type DesiredEmailEntry = {
  email: string;
  firstname: string;
  lastname: string;
};

export type ActiveMembershipEmailRow = {
  memberId: number;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  status: string;
};

export type EmailChangeContactDecision =
  | { action: 'skip' }
  | { action: 'patch_existing'; oldContactId: number }
  | { action: 'find_or_create_new' };

export type SeasonSyncResult = {
  seasonId: number;
  seasonName: string;
  mauticSegmentId: number | null;
  added: number;
  removed: number;
  errors: string[];
};

export type FullSyncResult = {
  status: 'success' | 'partial' | 'error';
  seasons: SeasonSyncResult[];
};

export type MauticMembershipSyncStatusView = {
  configured: boolean;
  seasons: Array<{ id: number; name: string; mauticSegmentId: number | null }>;
  lastRun: {
    at: string | null;
    status: 'success' | 'partial' | 'error' | null;
    summary: FullSyncResult | null;
    triggeredByMemberId: number | null;
  } | null;
};

function splitName(fullName: string | null | undefined): { firstname: string; lastname: string } {
  const t = (fullName || '').replace(/\s+/g, ' ').trim();
  if (!t) return { firstname: '', lastname: '' };
  const parts = t.split(' ');
  if (parts.length === 1) return { firstname: parts[0], lastname: '' };
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') };
}

/** Mautic segment display name for a curling season's active-member list. */
export function seasonMembersSegmentName(seasonName: string): string {
  return `AUTO: ${seasonName} members`;
}

function memberNames(row: Pick<ActiveMembershipEmailRow, 'firstName' | 'lastName' | 'name'>): {
  firstname: string;
  lastname: string;
} {
  const first = (row.firstName || '').trim();
  const last = (row.lastName || '').trim();
  if (first || last) return { firstname: first, lastname: last };
  return splitName(row.name);
}

/** Pure: build distinct desired emails from active membership rows (skips blank emails). */
export function buildDesiredEmailsFromRows(rows: ActiveMembershipEmailRow[]): Map<string, DesiredEmailEntry> {
  const map = new Map<string, DesiredEmailEntry>();
  for (const row of rows) {
    if (row.status !== 'active') continue;
    const email = normalizeEmail(row.email || '');
    if (!email) continue;
    if (map.has(email)) continue;
    const names = memberNames(row);
    map.set(email, { email, firstname: names.firstname, lastname: names.lastname });
  }
  return map;
}

/** Pure: whether an email should leave the segment after a removal (no other active holders). */
export function shouldRemoveEmailFromSegment(otherActiveHoldersExist: boolean): boolean {
  return !otherActiveHoldersExist;
}

/**
 * Pure: decide how to update Mautic contacts when a member's email changes.
 * - Shared old email → never patch the shared contact; find-or-create new.
 * - Sole owner + existing new-email contact → reuse new, leave old untouched.
 * - Sole owner + no new-email contact → patch old contact in place.
 */
export function decideEmailChangeContactAction(input: {
  oldEmailNormalized: string;
  newEmailNormalized: string;
  oldEmailSharedWithOtherMembers: boolean;
  existingNewEmailContactId: number | null;
  existingOldEmailContactId: number | null;
}): EmailChangeContactDecision {
  const oldEmail = input.oldEmailNormalized;
  const newEmail = input.newEmailNormalized;
  if (!newEmail || oldEmail === newEmail) {
    return { action: 'skip' };
  }
  if (input.oldEmailSharedWithOtherMembers) {
    return { action: 'find_or_create_new' };
  }
  if (input.existingNewEmailContactId != null) {
    return { action: 'find_or_create_new' };
  }
  if (input.existingOldEmailContactId != null) {
    return { action: 'patch_existing', oldContactId: input.existingOldEmailContactId };
  }
  return { action: 'find_or_create_new' };
}

function timestampBindValue(date: Date): Date | string {
  if (getDatabaseConfig()?.type === 'postgres') {
    return date;
  }
  return date.toISOString();
}

function fireAndForget(label: string, work: () => Promise<void>): void {
  void (async () => {
    try {
      if (!isMauticConfigured()) {
        console.warn(`${LOG_PREFIX} skipped (${label}): Mautic is not configured`);
        return;
      }
      await work();
    } catch (err) {
      console.error(`${LOG_PREFIX} ${label} failed:`, err);
      void logEvent({
        eventType: 'mautic_membership_sync_error',
        meta: { label, error: err instanceof Error ? err.message : String(err) },
      });
    }
  })();
}

async function loadActiveMembershipEmailRows(seasonId: number): Promise<ActiveMembershipEmailRow[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      memberId: schema.members.id,
      email: schema.members.email,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      name: schema.members.name,
      status: schema.seasonMemberships.status,
    })
    .from(schema.seasonMemberships)
    .innerJoin(schema.members, eq(schema.members.id, schema.seasonMemberships.member_id))
    .where(
      and(
        eq(schema.seasonMemberships.season_id, seasonId),
        eq(schema.seasonMemberships.status, 'active'),
      ),
    );
  return rows.map((row) => ({
    memberId: row.memberId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    name: row.name,
    status: row.status,
  }));
}

export async function computeDesiredEmailsForSeason(seasonId: number): Promise<Map<string, DesiredEmailEntry>> {
  const rows = await loadActiveMembershipEmailRows(seasonId);
  return buildDesiredEmailsFromRows(rows);
}

export async function isEmailActiveInSeason(
  normalizedEmail: string,
  seasonId: number,
  excludeMemberId?: number,
): Promise<boolean> {
  if (!normalizedEmail) return false;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      memberId: schema.members.id,
      email: schema.members.email,
    })
    .from(schema.seasonMemberships)
    .innerJoin(schema.members, eq(schema.members.id, schema.seasonMemberships.member_id))
    .where(
      and(
        eq(schema.seasonMemberships.season_id, seasonId),
        eq(schema.seasonMemberships.status, 'active'),
        ...(excludeMemberId != null ? [ne(schema.members.id, excludeMemberId)] : []),
      ),
    );
  return rows.some((row) => normalizeEmail(row.email || '') === normalizedEmail);
}

async function isEmailSharedWithOtherMembers(normalizedEmail: string, excludeMemberId: number): Promise<boolean> {
  if (!normalizedEmail) return false;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.members.id, email: schema.members.email })
    .from(schema.members)
    .where(ne(schema.members.id, excludeMemberId));
  return rows.some((row) => normalizeEmail(row.email || '') === normalizedEmail);
}

async function ensureSeasonSegmentInternal(seasonId: number): Promise<number | null> {
  if (!isMauticConfigured()) return null;
  const { db, schema } = getDrizzleDb();
  const [season] = await db
    .select({
      id: schema.curlingSeasons.id,
      name: schema.curlingSeasons.name,
      mauticSegmentId: schema.curlingSeasons.mautic_segment_id,
    })
    .from(schema.curlingSeasons)
    .where(eq(schema.curlingSeasons.id, seasonId))
    .limit(1);
  if (!season) {
    console.warn(`${LOG_PREFIX} season ${seasonId} not found`);
    return null;
  }
  if (season.mauticSegmentId != null && season.mauticSegmentId > 0) {
    return season.mauticSegmentId;
  }

  const segmentId = await createMauticSegment(seasonMembersSegmentName(season.name));
  await db
    .update(schema.curlingSeasons)
    .set({
      mautic_segment_id: segmentId,
      updated_at: sql`CURRENT_TIMESTAMP`,
    } as any)
    .where(eq(schema.curlingSeasons.id, seasonId));
  return segmentId;
}

async function renameSeasonSegmentInternal(seasonId: number): Promise<void> {
  const segmentId = await ensureSeasonSegmentInternal(seasonId);
  if (segmentId == null) return;
  const { db, schema } = getDrizzleDb();
  const [season] = await db
    .select({ name: schema.curlingSeasons.name })
    .from(schema.curlingSeasons)
    .where(eq(schema.curlingSeasons.id, seasonId))
    .limit(1);
  if (!season) return;
  await renameMauticSegment(segmentId, seasonMembersSegmentName(season.name));
}

async function ensureMemberEmailInSegment(input: {
  segmentId: number;
  email: string;
  firstname: string;
  lastname: string;
}): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!email) return;
  const contactId = await findOrCreateContactByEmail(email, input.firstname, input.lastname);
  await addContactToMauticSegment(input.segmentId, contactId);
}

async function removeMemberEmailFromSegmentIfUnused(input: {
  segmentId: number;
  seasonId: number;
  email: string;
  excludeMemberId?: number;
}): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!email) return;
  const stillActive = await isEmailActiveInSeason(email, input.seasonId, input.excludeMemberId);
  if (!shouldRemoveEmailFromSegment(stillActive)) return;
  const contactId = await findContactIdByEmail(email);
  if (contactId == null) return;
  try {
    await removeContactFromSegment(input.segmentId, contactId);
  } catch (e) {
    if (e instanceof MauticRequestError && e.statusCode === 404) return;
    throw e;
  }
}

async function syncMembershipGrantInternal(memberId: number, seasonId: number): Promise<void> {
  const segmentId = await ensureSeasonSegmentInternal(seasonId);
  if (segmentId == null) return;
  const { db, schema } = getDrizzleDb();
  const [member] = await db
    .select({
      email: schema.members.email,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      name: schema.members.name,
      accountKind: schema.members.account_kind,
    })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  if (!member) return;
  if (member.accountKind === 'service') return;
  const names = memberNames({
    firstName: member.firstName,
    lastName: member.lastName,
    name: member.name,
  });
  await ensureMemberEmailInSegment({
    segmentId,
    email: member.email || '',
    firstname: names.firstname,
    lastname: names.lastname,
  });
}

async function syncMembershipRemovalInternal(
  memberId: number,
  seasonId: number,
  memberEmailAtRemoval: string,
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [season] = await db
    .select({ mauticSegmentId: schema.curlingSeasons.mautic_segment_id })
    .from(schema.curlingSeasons)
    .where(eq(schema.curlingSeasons.id, seasonId))
    .limit(1);
  const segmentId = season?.mauticSegmentId;
  if (segmentId == null || segmentId <= 0) {
    console.warn(`${LOG_PREFIX} skip removal for season ${seasonId}: no segment id`);
    return;
  }
  await removeMemberEmailFromSegmentIfUnused({
    segmentId,
    seasonId,
    email: memberEmailAtRemoval,
    excludeMemberId: memberId,
  });
}

async function syncMemberContactInfoInternal(input: {
  memberId: number;
  oldEmail: string;
  newEmail: string;
  firstName: string;
  lastName: string;
}): Promise<void> {
  const oldEmail = normalizeEmail(input.oldEmail);
  const newEmail = normalizeEmail(input.newEmail);
  const firstname = input.firstName.trim();
  const lastname = input.lastName.trim();

  const { db, schema } = getDrizzleDb();
  const activeSeasons = await db
    .select({
      seasonId: schema.seasonMemberships.season_id,
      mauticSegmentId: schema.curlingSeasons.mautic_segment_id,
    })
    .from(schema.seasonMemberships)
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSeasons.id, schema.seasonMemberships.season_id))
    .where(
      and(
        eq(schema.seasonMemberships.member_id, input.memberId),
        eq(schema.seasonMemberships.status, 'active'),
      ),
    );

  const emailChanged = Boolean(oldEmail && newEmail && oldEmail !== newEmail);
  const nameOnly = !emailChanged && Boolean(newEmail);

  if (!emailChanged && !nameOnly) return;

  const oldEmailShared = emailChanged
    ? await isEmailSharedWithOtherMembers(oldEmail, input.memberId)
    : false;
  const existingNewEmailContactId = emailChanged && newEmail ? await findContactIdByEmail(newEmail) : null;
  const existingOldEmailContactId = emailChanged && oldEmail ? await findContactIdByEmail(oldEmail) : null;

  const decision = emailChanged
    ? decideEmailChangeContactAction({
        oldEmailNormalized: oldEmail,
        newEmailNormalized: newEmail,
        oldEmailSharedWithOtherMembers: oldEmailShared,
        existingNewEmailContactId,
        existingOldEmailContactId,
      })
    : ({ action: 'skip' } as EmailChangeContactDecision);

  let contactIdForNewEmail: number | null = null;

  if (decision.action === 'patch_existing') {
    await updateMauticContact(decision.oldContactId, {
      email: newEmail,
      firstname,
      lastname,
    });
    contactIdForNewEmail = decision.oldContactId;
  } else if (emailChanged && newEmail) {
    contactIdForNewEmail = await findOrCreateContactByEmail(newEmail, firstname, lastname);
  } else if (nameOnly && newEmail && !oldEmailShared) {
    const contactId = await findContactIdByEmail(newEmail);
    if (contactId != null) {
      await updateMauticContact(contactId, { firstname, lastname });
      contactIdForNewEmail = contactId;
    }
  }

  for (const season of activeSeasons) {
    let segmentId = season.mauticSegmentId;
    if (segmentId == null || segmentId <= 0) {
      segmentId = await ensureSeasonSegmentInternal(season.seasonId);
    }
    if (segmentId == null || segmentId <= 0) continue;

    if (newEmail) {
      const contactId =
        contactIdForNewEmail ?? (await findOrCreateContactByEmail(newEmail, firstname, lastname));
      contactIdForNewEmail = contactId;
      await addContactToMauticSegment(segmentId, contactId);
    }

    if (emailChanged && oldEmail) {
      await removeMemberEmailFromSegmentIfUnused({
        segmentId,
        seasonId: season.seasonId,
        email: oldEmail,
        excludeMemberId: input.memberId,
      });
    }
  }
}

async function syncOneSeason(seasonId: number, seasonName: string): Promise<SeasonSyncResult> {
  const result: SeasonSyncResult = {
    seasonId,
    seasonName,
    mauticSegmentId: null,
    added: 0,
    removed: 0,
    errors: [],
  };

  try {
    const segmentId = await ensureSeasonSegmentInternal(seasonId);
    result.mauticSegmentId = segmentId;
    if (segmentId == null) {
      result.errors.push('Could not ensure Mautic segment');
      return result;
    }

    const desired = await computeDesiredEmailsForSeason(seasonId);
    const current = await listSegmentContacts(segmentId);
    const currentByEmail = new Map(current.map((c) => [normalizeEmail(c.email), c]));

    for (const [email, entry] of desired) {
      if (currentByEmail.has(email)) continue;
      try {
        await ensureMemberEmailInSegment({
          segmentId,
          email: entry.email,
          firstname: entry.firstname,
          lastname: entry.lastname,
        });
        result.added += 1;
      } catch (err) {
        result.errors.push(`add ${email}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    for (const contact of current) {
      const email = normalizeEmail(contact.email);
      if (!email || desired.has(email)) continue;
      try {
        await removeContactFromSegment(segmentId, contact.id);
        result.removed += 1;
      } catch (err) {
        if (err instanceof MauticRequestError && err.statusCode === 404) continue;
        result.errors.push(`remove ${email}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}

async function persistSyncStatus(
  result: FullSyncResult,
  triggeredByMemberId?: number | null,
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const now = new Date();
  const summaryJson = JSON.stringify(result);
  const values = {
    id: 1,
    last_run_at: timestampBindValue(now),
    last_run_status: result.status,
    last_run_summary: summaryJson,
    last_run_triggered_by_member_id: triggeredByMemberId ?? null,
    updated_at: timestampBindValue(now),
  };

  const [existing] = await db
    .select({ id: schema.mauticMembershipSyncStatus.id })
    .from(schema.mauticMembershipSyncStatus)
    .where(eq(schema.mauticMembershipSyncStatus.id, 1))
    .limit(1);

  if (existing) {
    await db
      .update(schema.mauticMembershipSyncStatus)
      .set({
        last_run_at: values.last_run_at,
        last_run_status: values.last_run_status,
        last_run_summary: values.last_run_summary,
        last_run_triggered_by_member_id: values.last_run_triggered_by_member_id,
        updated_at: values.updated_at,
      } as any)
      .where(eq(schema.mauticMembershipSyncStatus.id, 1));
  } else {
    await db.insert(schema.mauticMembershipSyncStatus).values({
      ...values,
      created_at: timestampBindValue(now),
    } as any);
  }
}

export async function runFullSync(triggeredByMemberId?: number | null): Promise<FullSyncResult> {
  if (!isMauticConfigured()) {
    const result: FullSyncResult = { status: 'error', seasons: [] };
    await persistSyncStatus(result, triggeredByMemberId);
    return result;
  }

  const { db, schema } = getDrizzleDb();
  const seasons = await db
    .select({
      id: schema.curlingSeasons.id,
      name: schema.curlingSeasons.name,
    })
    .from(schema.curlingSeasons)
    .orderBy(asc(schema.curlingSeasons.start_date), asc(schema.curlingSeasons.id));

  const seasonResults: SeasonSyncResult[] = [];
  for (const season of seasons) {
    seasonResults.push(await syncOneSeason(season.id, season.name));
  }

  const anyErrors = seasonResults.some((s) => s.errors.length > 0);
  const allFailed =
    seasonResults.length > 0 && seasonResults.every((s) => s.mauticSegmentId == null || s.errors.length > 0);
  const status: FullSyncResult['status'] = allFailed ? 'error' : anyErrors ? 'partial' : 'success';
  const result: FullSyncResult = { status, seasons: seasonResults };

  await persistSyncStatus(result, triggeredByMemberId);
  void logEvent({
    eventType: 'mautic_membership_sync_completed',
    memberId: triggeredByMemberId ?? null,
    meta: result,
  });

  return result;
}

export async function getSyncStatus(): Promise<MauticMembershipSyncStatusView> {
  const { db, schema } = getDrizzleDb();
  const seasons = await db
    .select({
      id: schema.curlingSeasons.id,
      name: schema.curlingSeasons.name,
      mauticSegmentId: schema.curlingSeasons.mautic_segment_id,
    })
    .from(schema.curlingSeasons)
    .orderBy(asc(schema.curlingSeasons.start_date), asc(schema.curlingSeasons.id));

  const [statusRow] = await db
    .select()
    .from(schema.mauticMembershipSyncStatus)
    .where(eq(schema.mauticMembershipSyncStatus.id, 1))
    .limit(1);

  let lastRun: MauticMembershipSyncStatusView['lastRun'] = null;
  if (statusRow) {
    let summary: FullSyncResult | null = null;
    if (statusRow.last_run_summary) {
      try {
        summary = JSON.parse(statusRow.last_run_summary) as FullSyncResult;
      } catch {
        summary = null;
      }
    }
    const at =
      statusRow.last_run_at instanceof Date
        ? statusRow.last_run_at.toISOString()
        : statusRow.last_run_at
          ? String(statusRow.last_run_at)
          : null;
    lastRun = {
      at,
      status: (statusRow.last_run_status as FullSyncResult['status'] | null) ?? null,
      summary,
      triggeredByMemberId: statusRow.last_run_triggered_by_member_id ?? null,
    };
  }

  return {
    configured: isMauticConfigured(),
    seasons: seasons.map((s) => ({
      id: s.id,
      name: s.name,
      mauticSegmentId: s.mauticSegmentId ?? null,
    })),
    lastRun,
  };
}

export function queueEnsureSeasonSegment(seasonId: number): void {
  fireAndForget(`ensureSeasonSegment(${seasonId})`, async () => {
    await ensureSeasonSegmentInternal(seasonId);
  });
}

export function queueRenameSeasonSegment(seasonId: number): void {
  fireAndForget(`renameSeasonSegment(${seasonId})`, async () => {
    await renameSeasonSegmentInternal(seasonId);
  });
}

export function queueMembershipGrantSync(memberId: number, seasonId: number): void {
  fireAndForget(`membershipGrant(member=${memberId}, season=${seasonId})`, async () => {
    await syncMembershipGrantInternal(memberId, seasonId);
  });
}

export function queueMembershipRemovalSync(
  memberId: number,
  seasonId: number,
  memberEmailAtRemoval: string,
): void {
  fireAndForget(`membershipRemoval(member=${memberId}, season=${seasonId})`, async () => {
    await syncMembershipRemovalInternal(memberId, seasonId, memberEmailAtRemoval);
  });
}

export function queueMemberContactInfoSync(
  memberId: number,
  oldEmail: string,
  newEmail: string,
  firstName: string,
  lastName: string,
): void {
  fireAndForget(`memberContactInfo(member=${memberId})`, async () => {
    await syncMemberContactInfoInternal({ memberId, oldEmail, newEmail, firstName, lastName });
  });
}
