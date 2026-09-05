import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { SUBMITTED_CURLER_REGISTRATION_STATUSES } from './registrationDraftProgress.js';
import { listActiveWaitlistEntriesForMember, sortMemberWaitlistPriorityEntries } from './memberWaitlistPriority.js';
import { waitlistMemberDisplayName } from './waitlistAudit.js';
import { WaitlistStaffValidationError } from './waitlistErrors.js';
import { waitlistEntryRosterMemberIds } from './waitlistTeamRoster.js';

export type WaitlistStaffPriorityWaitlist = {
  waitlistId: number;
  waitlistName: string;
  priorityRank: number;
};

export type WaitlistStaffPriorityLeague = {
  leagueId: number;
  leagueName: string;
  priorityRank: number;
};

export type WaitlistStaffMemberPriorityDetails = {
  memberId: number;
  memberName: string;
  waitlists: WaitlistStaffPriorityWaitlist[];
  registration: {
    id: number;
    desiredLeagueCount: number | null;
    leaguePriorities: WaitlistStaffPriorityLeague[];
  } | null;
};

export type WaitlistStaffPriorityDetails = {
  entryId: number;
  waitlistId: number;
  members: WaitlistStaffMemberPriorityDetails[];
};

export function waitlistsInDisplayOrder(
  entries: Array<{
    waitlistId: number;
    waitlistName: string;
    priorityRank: number | null;
    joinedAt: Date | string | number;
    id: number;
  }>,
): WaitlistStaffPriorityWaitlist[] {
  return sortMemberWaitlistPriorityEntries(entries).map((entry, index) => ({
    waitlistId: entry.waitlistId,
    waitlistName: entry.waitlistName,
    priorityRank: index + 1,
  }));
}

export async function getWaitlistEntryPriorityDetails(entryId: number): Promise<WaitlistStaffPriorityDetails> {
  const { db, schema } = getDrizzleDb();
  const [entry] = await db
    .select({
      id: schema.waitlistEntries.id,
      waitlistId: schema.waitlistEntries.waitlist_id,
      memberId: schema.waitlistEntries.member_id,
      teamRosterPlacements: schema.waitlistEntries.team_roster_placements,
      status: schema.waitlistEntries.status,
    })
    .from(schema.waitlistEntries)
    .where(eq(schema.waitlistEntries.id, entryId))
    .limit(1);
  if (!entry) {
    throw new WaitlistStaffValidationError({ entryId: 'Waitlist entry was not found.' });
  }

  const memberIds = waitlistEntryRosterMemberIds({
    memberId: entry.memberId,
    teamRosterPlacements: entry.teamRosterPlacements,
  });
  if (memberIds.length === 0) {
    return { entryId: entry.id, waitlistId: entry.waitlistId, members: [] };
  }

  const memberRows = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      email: schema.members.email,
    })
    .from(schema.members)
    .where(inArray(schema.members.id, memberIds));
  const memberById = new Map(memberRows.map((row) => [row.id, row]));

  const waitlistEntriesByMember = new Map<
    number,
    Awaited<ReturnType<typeof listActiveWaitlistEntriesForMember>>
  >();
  for (const memberId of memberIds) {
    waitlistEntriesByMember.set(memberId, await listActiveWaitlistEntriesForMember(memberId));
  }

  const waitlistIds = [
    ...new Set(
      [...waitlistEntriesByMember.values()].flatMap((entries) => entries.map((row) => row.waitlistId)),
    ),
  ];
  const waitlistRows =
    waitlistIds.length > 0
      ? await db
          .select({ id: schema.leagueWaitlists.id, name: schema.leagueWaitlists.name })
          .from(schema.leagueWaitlists)
          .where(inArray(schema.leagueWaitlists.id, waitlistIds))
      : [];
  const waitlistNameById = new Map(waitlistRows.map((row) => [row.id, row.name]));

  const registrationRows = await db
    .select({
      id: schema.curlingRegistrations.id,
      memberId: schema.curlingRegistrations.curler_member_id,
      desiredLeagueCount: schema.curlingRegistrations.desired_league_count,
    })
    .from(schema.curlingRegistrations)
    .where(
      and(
        inArray(schema.curlingRegistrations.curler_member_id, memberIds),
        sql`${schema.curlingRegistrations.submitted_at} IS NOT NULL`,
        inArray(schema.curlingRegistrations.status, [...SUBMITTED_CURLER_REGISTRATION_STATUSES]),
      ),
    )
    .orderBy(desc(schema.curlingRegistrations.updated_at), desc(schema.curlingRegistrations.id));
  const latestRegistrationByMember = new Map<
    number,
    { id: number; desiredLeagueCount: number | null }
  >();
  for (const row of registrationRows) {
    if (row.memberId == null || latestRegistrationByMember.has(row.memberId)) continue;
    latestRegistrationByMember.set(row.memberId, {
      id: row.id,
      desiredLeagueCount: row.desiredLeagueCount ?? null,
    });
  }

  const registrationIds = [...latestRegistrationByMember.values()].map((row) => row.id);
  const priorityRows =
    registrationIds.length > 0
      ? await db
          .select({
            registrationId: schema.registrationLeaguePriorities.registration_id,
            leagueId: schema.registrationLeaguePriorities.league_id,
            leagueName: schema.leagues.name,
            priorityRank: schema.registrationLeaguePriorities.priority_rank,
          })
          .from(schema.registrationLeaguePriorities)
          .innerJoin(schema.leagues, eq(schema.registrationLeaguePriorities.league_id, schema.leagues.id))
          .where(inArray(schema.registrationLeaguePriorities.registration_id, registrationIds))
          .orderBy(
            schema.registrationLeaguePriorities.registration_id,
            schema.registrationLeaguePriorities.priority_rank,
          )
      : [];
  const prioritiesByRegistrationId = new Map<number, WaitlistStaffPriorityLeague[]>();
  for (const row of priorityRows) {
    const list = prioritiesByRegistrationId.get(row.registrationId) ?? [];
    list.push({
      leagueId: row.leagueId,
      leagueName: row.leagueName,
      priorityRank: row.priorityRank,
    });
    prioritiesByRegistrationId.set(row.registrationId, list);
  }

  const members = memberIds.map((memberId) => {
    const member = memberById.get(memberId);
    const registration = latestRegistrationByMember.get(memberId) ?? null;
    return {
      memberId,
      memberName: waitlistMemberDisplayName(
        member
          ? {
              name: member.name,
              first_name: member.firstName,
              last_name: member.lastName,
              email: member.email,
            }
          : null,
      ),
      waitlists: waitlistsInDisplayOrder(
        (waitlistEntriesByMember.get(memberId) ?? []).map((row) => ({
          id: row.id,
          waitlistId: row.waitlistId,
          waitlistName: waitlistNameById.get(row.waitlistId) ?? `Waitlist #${row.waitlistId}`,
          priorityRank: row.priorityRank,
          joinedAt: row.joinedAt,
        })),
      ),
      registration: registration
        ? {
            id: registration.id,
            desiredLeagueCount: registration.desiredLeagueCount,
            leaguePriorities: prioritiesByRegistrationId.get(registration.id) ?? [],
          }
        : null,
    };
  });

  return { entryId: entry.id, waitlistId: entry.waitlistId, members };
}
