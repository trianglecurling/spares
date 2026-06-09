import { eq, inArray } from 'drizzle-orm';
import { config } from '../config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { sendRegistrationEmailForDashboard } from './registrationEmailService.js';
import { getActiveWaitlistEntryPosition } from './waitlistEntityService.js';
import { memberParticipationOnWaitlistEntry } from './waitlistMemberMembership.js';
import { parseTeamRosterPlacements } from './waitlistTeamRoster.js';
import { waitlistMemberDisplayName } from './waitlistAudit.js';

export type WaitlistJoinedNotificationSource = 'member_self' | 'staff_action' | 'registration_submission';

function frontendBaseUrl(): string {
  return config.frontendUrl.replace(/\/+$/, '');
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
  const { db, schema } = getDrizzleDb();
  const [entry] = await db
    .select()
    .from(schema.waitlistEntries)
    .where(eq(schema.waitlistEntries.id, input.entryId))
    .limit(1);
  if (!entry) return;

  const placements = parseTeamRosterPlacements(entry.team_roster_placements);
  const memberIds =
    placements.length > 0 ? [...new Set(placements.map((placement) => placement.memberId))] : [entry.member_id];

  const [addedBy] = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.id, input.addedByMemberId))
    .limit(1);
  const addedByName = addedBy ? waitlistMemberDisplayName(addedBy) : 'A club member';

  const members =
    memberIds.length > 0
      ? await db.select().from(schema.members).where(inArray(schema.members.id, memberIds))
      : [];
  const { position, total } = await getActiveWaitlistEntryPosition(input.waitlistId, input.entryId);
  const waitlistPageUrl = input.waitlistPageUrl ?? `${frontendBaseUrl()}/waitlists/${input.waitlistId}`;

  for (const member of members) {
    if (!member.email?.trim()) continue;

    const participation = memberParticipationOnWaitlistEntry(member.id, {
      memberId: entry.member_id,
      entryType: entry.entry_type,
      replacesLineageStartLeagueId: entry.replaces_lineage_start_league_id,
      originalReplacesLeagueId: entry.original_replaces_league_id,
      teamRosterPlacements: entry.team_roster_placements,
    });

    let replacementLeagueName: string | null = null;
    if (participation.entryType === 'replace' && participation.replacesLeagueId != null) {
      const [replacementLeague] = await db
        .select({ name: schema.leagues.name })
        .from(schema.leagues)
        .where(eq(schema.leagues.id, participation.replacesLeagueId))
        .limit(1);
      replacementLeagueName = replacementLeague?.name ?? null;
    }

    const recipientRegistrationId = input.registrationId ?? entry.source_registration_id ?? null;
    const isPrimarySelfJoin =
      member.id === input.addedByMemberId &&
      (input.addedBySource === 'member_self' ||
        (input.addedBySource === 'registration_submission' && member.id === entry.member_id));

    try {
      await sendRegistrationEmailForDashboard({
        messageType: 'waitlist_joined',
        recipientEmail: member.email,
        recipientName: waitlistMemberDisplayName(member),
        recipientMemberId: member.id,
        registrationId: recipientRegistrationId,
        waitlistEntryId: input.entryId,
        payload: {
          leagueName: input.leagueName,
          waitlistType: participation.entryType === 'replace' ? 'REPLACE' : 'ADD',
          replacementLeagueName,
          position,
          waitlistSize: total,
          addedByName: isPrimarySelfJoin ? null : addedByName,
          dashboardUrl: waitlistPageUrl ?? undefined,
        },
      });
    } catch (error) {
      console.error('[Registration Email] Failed to send waitlist joined email:', error);
    }
  }
}
