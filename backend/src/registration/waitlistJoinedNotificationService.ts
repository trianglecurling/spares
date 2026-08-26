import { eq, inArray } from 'drizzle-orm';
import { config } from '../config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { sendRegistrationEmailForDashboard } from './registrationEmailService.js';
import { getActiveWaitlistEntryPosition } from './waitlistEntityService.js';
import { waitlistEntryRosterMemberIds } from './waitlistTeamRoster.js';
import { waitlistMemberDisplayName } from './waitlistAudit.js';
import type { Member } from '../types.js';

export type WaitlistJoinedNotificationSource = 'member_self' | 'staff_action' | 'registration_submission';

function frontendBaseUrl(): string {
  return config.frontendUrl.replace(/\/+$/, '');
}

export type WaitlistJoinedNotificationItem = {
  waitlistId: number;
  entryId: number;
  leagueName: string;
  registrationId?: number | null;
  waitlistPageUrl?: string | null;
};

export type WaitlistJoinedNotificationBatch = {
  addedByMemberId: number;
  addedBySource: WaitlistJoinedNotificationSource;
  items: WaitlistJoinedNotificationItem[];
};

export function groupWaitlistJoinedRecipients(
  items: Array<{ entryId: number; rosterMemberIds: number[] }>,
): Map<number, number[]> {
  const byMember = new Map<number, number[]>();
  for (const item of items) {
    for (const memberId of item.rosterMemberIds) {
      const entryIds = byMember.get(memberId) ?? [];
      if (!entryIds.includes(item.entryId)) entryIds.push(item.entryId);
      byMember.set(memberId, entryIds);
    }
  }
  return byMember;
}

export async function sendWaitlistEntryJoinedNotifications(input: {
  waitlistId: number;
  entryId: number;
  leagueName: string;
  addedByMemberId: number;
  addedBySource: WaitlistJoinedNotificationSource;
  registrationId?: number | null;
  waitlistPageUrl?: string | null;
}): Promise<void> {
  await sendWaitlistEntriesJoinedNotifications({
    addedByMemberId: input.addedByMemberId,
    addedBySource: input.addedBySource,
    items: [
      {
        waitlistId: input.waitlistId,
        entryId: input.entryId,
        leagueName: input.leagueName,
        registrationId: input.registrationId,
        waitlistPageUrl: input.waitlistPageUrl,
      },
    ],
  });
}

export async function sendWaitlistEntriesJoinedNotifications(input: WaitlistJoinedNotificationBatch): Promise<void> {
  if (input.items.length === 0) return;

  const { db, schema } = getDrizzleDb();
  const entryIds = [...new Set(input.items.map((item) => item.entryId))];
  const entryRows =
    entryIds.length > 0
      ? await db.select().from(schema.waitlistEntries).where(inArray(schema.waitlistEntries.id, entryIds))
      : [];
  const entryById = new Map(entryRows.map((row) => [row.id, row]));

  const details: Array<{
    waitlistId: number;
    entryId: number;
    leagueName: string;
    registrationId: number | null;
    waitlistPageUrl: string;
    priorityRank: number | null;
    position: number | null;
    waitlistSize: number | null;
    memberId: number;
    rosterMemberIds: number[];
  }> = [];
  for (const item of input.items) {
    const entry = entryById.get(item.entryId);
    if (!entry) continue;
    const { position, total } = await getActiveWaitlistEntryPosition(item.waitlistId, item.entryId);
    details.push({
      waitlistId: item.waitlistId,
      entryId: item.entryId,
      leagueName: item.leagueName,
      registrationId: item.registrationId ?? entry.source_registration_id ?? null,
      waitlistPageUrl: item.waitlistPageUrl ?? `${frontendBaseUrl()}/waitlists/${item.waitlistId}`,
      priorityRank: entry.priority_rank,
      position,
      waitlistSize: total,
      memberId: entry.member_id,
      rosterMemberIds: waitlistEntryRosterMemberIds(entry),
    });
  }
  if (details.length === 0) return;

  const [addedBy] = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.id, input.addedByMemberId))
    .limit(1);
  const addedByName = addedBy ? waitlistMemberDisplayName(addedBy) : 'A club member';

  const recipientsByMemberId = groupWaitlistJoinedRecipients(details);
  const recipientIds = [...recipientsByMemberId.keys()];
  const members =
    recipientIds.length > 0
      ? await db.select().from(schema.members).where(inArray(schema.members.id, recipientIds))
      : [];
  const detailByEntryId = new Map(details.map((detail) => [detail.entryId, detail]));
  const myWaitlistsUrl = `${frontendBaseUrl()}/waitlists`;

  for (const member of members) {
    if (!member.email?.trim()) continue;
    const recipientEntryIds = recipientsByMemberId.get(member.id) ?? [];
    const recipientDetails = recipientEntryIds
      .map((entryId) => detailByEntryId.get(entryId))
      .filter((detail): detail is (typeof details)[number] => detail != null);
    if (recipientDetails.length === 0) continue;

    const isPrimarySelfJoin = recipientDetails.every(
      (detail) =>
        member.id === input.addedByMemberId &&
        (input.addedBySource === 'member_self' ||
          (input.addedBySource === 'registration_submission' && member.id === detail.memberId)),
    );
    const joinedWaitlists = recipientDetails.map((detail) => ({
      leagueName: detail.leagueName,
      priorityRank: detail.priorityRank,
      position: detail.position,
      waitlistSize: detail.waitlistSize,
      dashboardUrl: detail.waitlistPageUrl,
    }));
    const first = recipientDetails[0]!;

    try {
      await sendRegistrationEmailForDashboard({
        messageType: 'waitlist_joined',
        recipientEmail: member.email,
        recipientName: waitlistMemberDisplayName(member),
        recipientMemberId: member.id,
        registrationId: first.registrationId,
        waitlistEntryId: recipientDetails.length === 1 ? first.entryId : null,
        payload:
          recipientDetails.length === 1
            ? {
                leagueName: first.leagueName,
                priorityRank: first.priorityRank,
                position: first.position,
                waitlistSize: first.waitlistSize,
                addedByName: isPrimarySelfJoin ? null : addedByName,
                dashboardUrl: first.waitlistPageUrl,
              }
            : {
                joinedWaitlists,
                addedByName: isPrimarySelfJoin ? null : addedByName,
                dashboardUrl: myWaitlistsUrl,
              },
      });
    } catch (error) {
      console.error('[Registration Email] Failed to send waitlist joined email:', error);
    }
  }
}

export async function sendWaitlistEntryRemovedNotifications(input: {
  leagueName: string | null | undefined;
  registrationId: number | null;
  actor: Member;
  rosterMembers: Array<{ id: number; email: string | null; name: string | null; first_name: string | null; last_name: string | null }>;
}): Promise<void> {
  const removedByName = waitlistMemberDisplayName(input.actor);
  for (const member of input.rosterMembers) {
    if (!member.email?.trim()) continue;
    try {
      await sendRegistrationEmailForDashboard({
        messageType: 'waitlist_removed_by_member',
        recipientEmail: member.email,
        recipientName: waitlistMemberDisplayName(member),
        recipientMemberId: member.id,
        registrationId: input.registrationId,
        waitlistEntryId: null,
        payload: {
          leagueName: input.leagueName,
          removedByName: member.id === input.actor.id ? null : removedByName,
        },
      });
    } catch (error) {
      console.error('[Registration Email] Failed to send waitlist removed email:', error);
    }
  }
}
