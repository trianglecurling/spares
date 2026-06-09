import { and, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { WaitlistEntryTypeSqlite } from '../db/drizzle-schema.js';
import type { ExistingWaitlistEntry } from './registrationContext.js';
import { loadLeagueContinuityMap, resolveLeagueInSession } from './waitlistLineage.js';
import { WaitlistStaffValidationError } from './waitlistErrors.js';
import { parseTeamRosterPlacements } from './waitlistTeamRoster.js';

type WaitlistEntryMembershipRow = {
  memberId: number;
  entryType: WaitlistEntryTypeSqlite;
  replacesLineageStartLeagueId: number | null;
  originalReplacesLeagueId: number | null;
  teamRosterPlacements: string | null;
};

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

export function memberParticipationOnWaitlistEntry(
  memberId: number,
  row: WaitlistEntryMembershipRow,
): { entryType: WaitlistEntryTypeSqlite; replacesLeagueId: number | null } {
  if (row.memberId === memberId) {
    return {
      entryType: row.entryType,
      replacesLeagueId: row.originalReplacesLeagueId,
    };
  }
  const placement = parseTeamRosterPlacements(row.teamRosterPlacements).find((item) => item.memberId === memberId);
  if (!placement) {
    return { entryType: row.entryType, replacesLeagueId: null };
  }
  return {
    entryType: placement.entryType,
    replacesLeagueId: placement.replacesLeagueId ?? null,
  };
}

function toExistingWaitlistEntry(
  memberId: number,
  row: WaitlistEntryMembershipRow & {
    waitlistId: number;
    leagueId: number;
    status: ExistingWaitlistEntry['status'];
  },
  sessionId: number,
  continuity: Awaited<ReturnType<typeof loadLeagueContinuityMap>>,
): ExistingWaitlistEntry {
  const participation = memberParticipationOnWaitlistEntry(memberId, row);
  let replacesLineageStartLeagueId: number | null = null;
  let replacesLeagueId: number | null = null;

  if (participation.entryType === 'replace') {
    if (row.memberId === memberId) {
      replacesLineageStartLeagueId = row.replacesLineageStartLeagueId;
      replacesLeagueId =
        row.replacesLineageStartLeagueId != null
          ? resolveLeagueInSession(row.replacesLineageStartLeagueId, sessionId, continuity)
          : row.originalReplacesLeagueId;
    } else {
      replacesLeagueId = participation.replacesLeagueId;
    }
  }

  return {
    waitlistId: row.waitlistId,
    leagueId: row.leagueId,
    entryType: participation.entryType,
    replacesLineageStartLeagueId,
    replacesLeagueId,
    status: row.status,
  };
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
      entryType: schema.waitlistEntries.entry_type,
      replacesLineageStartLeagueId: schema.waitlistEntries.replaces_lineage_start_league_id,
      originalReplacesLeagueId: schema.waitlistEntries.original_replaces_league_id,
      teamRosterPlacements: schema.waitlistEntries.team_roster_placements,
      status: schema.waitlistEntries.status,
      declineCount: schema.waitlistEntries.decline_count,
    })
    .from(schema.waitlistEntries)
    .innerJoin(schema.leagues, eq(schema.waitlistEntries.waitlist_id, schema.leagues.waitlist_id))
    .where(eq(schema.leagues.session_id, sessionId));

  const continuity = await loadLeagueContinuityMap();
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
        ...toExistingWaitlistEntry(memberId, row, sessionId, continuity),
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
