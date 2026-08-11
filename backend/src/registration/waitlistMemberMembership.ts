import { and, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { ExistingWaitlistEntry } from './registrationContext.js';
import { WaitlistStaffValidationError } from './waitlistErrors.js';
import { parseTeamRosterPlacements } from './waitlistTeamRoster.js';

export function waitlistTeammateContactMessage(primaryMemberName: string): string {
  return `You are on this waitlist because you were listed as a team member by ${primaryMemberName}. If you need to leave this waitlist or change your entry, please contact ${primaryMemberName}.`;
}

export function isPrimaryWaitlistEntryMember(entry: { member_id?: number; memberId?: number }, memberId: number): boolean {
  return (entry.member_id ?? entry.memberId) === memberId;
}

export function waitlistEntryIncludesMember(
  memberId: number,
  entry: { member_id?: number; memberId?: number; team_roster_placements?: string | null; teamRosterPlacements?: string | null },
): boolean {
  const primaryMemberId = entry.member_id ?? entry.memberId;
  if (primaryMemberId === memberId) return true;
  const placementsJson = entry.team_roster_placements ?? entry.teamRosterPlacements ?? null;
  return parseTeamRosterPlacements(placementsJson).some((placement) => placement.memberId === memberId);
}

export async function loadExistingWaitlistEntriesForMember(
  memberId: number,
  sessionId: number,
): Promise<ExistingWaitlistEntry[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      waitlistEntryId: schema.waitlistEntries.id,
      waitlistId: schema.waitlistEntries.waitlist_id,
      leagueId: schema.leagues.id,
      memberId: schema.waitlistEntries.member_id,
      priorityRank: schema.waitlistEntries.priority_rank,
      desiredLeagueCount: schema.waitlistEntries.desired_league_count,
      teamRosterPlacements: schema.waitlistEntries.team_roster_placements,
      status: schema.waitlistEntries.status,
      declineCount: schema.waitlistEntries.decline_count,
    })
    .from(schema.waitlistEntries)
    .innerJoin(schema.leagues, eq(schema.waitlistEntries.waitlist_id, schema.leagues.waitlist_id))
    .where(eq(schema.leagues.session_id, sessionId));

  const { getActiveWaitlistEntryPosition } = await import('./waitlistEntityService.js');
  const byWaitlist = new Map<number, { entry: ExistingWaitlistEntry; waitlistEntryId: number }>();
  for (const row of rows) {
    if (
      !waitlistEntryIncludesMember(memberId, {
        memberId: row.memberId,
        teamRosterPlacements: row.teamRosterPlacements,
      })
    ) {
      continue;
    }
    if (byWaitlist.has(row.waitlistId)) continue;
    byWaitlist.set(row.waitlistId, {
      waitlistEntryId: row.waitlistEntryId,
      entry: {
        waitlistId: row.waitlistId,
        leagueId: row.leagueId,
        priorityRank: row.priorityRank ?? null,
        desiredLeagueCount: row.desiredLeagueCount ?? null,
        status: row.status,
        declineCount: Number(row.declineCount ?? 0),
      },
    });
  }

  return Promise.all(
    [...byWaitlist.values()].map(async ({ entry, waitlistEntryId }) => {
      if (entry.status !== 'active') {
        return { ...entry, position: null, queueTotal: null };
      }
      const { position, total } = await getActiveWaitlistEntryPosition(entry.waitlistId, waitlistEntryId);
      return { ...entry, position, queueTotal: total };
    }),
  );
}

export async function assertMembersAvailableForWaitlist(input: {
  waitlistId: number;
  memberIds: number[];
  excludeEntryId?: number | null;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const uniqueMemberIds = [...new Set(input.memberIds)];
  if (uniqueMemberIds.length === 0) return;

  const rows = await db
    .select({
      id: schema.waitlistEntries.id,
      memberId: schema.waitlistEntries.member_id,
      teamRosterPlacements: schema.waitlistEntries.team_roster_placements,
    })
    .from(schema.waitlistEntries)
    .where(and(eq(schema.waitlistEntries.waitlist_id, input.waitlistId), eq(schema.waitlistEntries.status, 'active')));

  for (const memberId of uniqueMemberIds) {
    const conflict = rows.find(
      (row) => row.id !== input.excludeEntryId && waitlistEntryIncludesMember(memberId, row),
    );
    if (conflict) {
      throw new WaitlistStaffValidationError({
        teamRosterPlacements: `A team member is already on this waitlist.`,
      });
    }
  }
}

export async function findActiveWaitlistEntryForMemberOnWaitlist(
  memberId: number,
  waitlistId: number,
): Promise<{ id: number; memberId: number } | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.waitlistEntries.id,
      memberId: schema.waitlistEntries.member_id,
      teamRosterPlacements: schema.waitlistEntries.team_roster_placements,
      status: schema.waitlistEntries.status,
    })
    .from(schema.waitlistEntries)
    .where(and(eq(schema.waitlistEntries.waitlist_id, waitlistId), eq(schema.waitlistEntries.status, 'active')));

  for (const row of rows) {
    if (waitlistEntryIncludesMember(memberId, row)) {
      return { id: row.id, memberId: row.memberId };
    }
  }
  return null;
}
