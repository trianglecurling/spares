import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isSubmittedCurlerRegistrationStatus } from './registrationDraftProgress.js';
import {
  asPriorityLeague,
  evaluateGuaranteeLabels,
  rosterStatusForLeague,
  type RosterRegistrationStatus,
} from './registrationPriorityLabels.js';
import type { LeaguePriorityInput } from './registrationContext.js';
import { getScheduleRegistrationWindow } from './registrationShellService.js';
import { parseTeamRosterPlacements } from './waitlistTeamRoster.js';

export type { RosterRegistrationStatus };

const ROSTERED_STATUSES = ['active', 'completed'] as const;

type DrizzleBundle = ReturnType<typeof getDrizzleDb>;

/**
 * Derived registration guarantee labels for roster members, keyed by member id.
 * Members without a submitted session registration that lists this league are omitted.
 */
export async function loadRosterRegistrationStatuses(
  leagueId: number,
  memberIds: number[],
): Promise<Map<number, RosterRegistrationStatus>> {
  const result = new Map<number, RosterRegistrationStatus>();
  if (memberIds.length === 0) return result;

  const { db, schema } = getDrizzleDb();
  const [league] = await db
    .select({
      id: schema.leagues.id,
      sessionId: schema.leagues.session_id,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);
  if (!league?.sessionId) return result;

  const [session] = await db
    .select({
      id: schema.curlingSessions.id,
      seasonId: schema.curlingSessions.season_id,
    })
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.id, league.sessionId))
    .limit(1);
  if (!session) return result;

  const window = await getScheduleRegistrationWindow(session.seasonId, session.id);
  const labelMode = window?.state === 'open' ? 'open' : 'priority';

  const leaguesUnsorted = await db
    .select({
      id: schema.leagues.id,
      predecessor_league_id: schema.leagues.predecessor_league_id,
      league_type: schema.leagues.league_type,
      format: schema.leagues.format,
      waitlist_id: schema.leagues.waitlist_id,
      is_play_in_based: schema.leagues.is_play_in_based,
      registration_fee_minor: schema.leagues.registration_fee_minor,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.session_id, session.id));

  const leaguesById = new Map(
    leaguesUnsorted.map((row) => [
      row.id,
      {
        id: row.id,
        predecessorLeagueId: row.predecessor_league_id,
        league: asPriorityLeague(row),
      },
    ]),
  );

  const registrationsByMemberId = await loadSubmittedRegistrationsByMemberId(db, schema, session.id, memberIds);
  const registrationIds = [...registrationsByMemberId.values()].map((row) => row.id);
  if (registrationIds.length === 0) return result;

  const prioritiesByRegistrationId = new Map<number, LeaguePriorityInput[]>();
  const priorityRows = await db
    .select({
      registrationId: schema.registrationLeaguePriorities.registration_id,
      leagueId: schema.registrationLeaguePriorities.league_id,
      priorityRank: schema.registrationLeaguePriorities.priority_rank,
      byotTeammateText: schema.registrationLeaguePriorities.byot_teammate_text,
      teamRosterPlacements: schema.registrationLeaguePriorities.team_roster_placements,
    })
    .from(schema.registrationLeaguePriorities)
    .where(inArray(schema.registrationLeaguePriorities.registration_id, registrationIds));
  for (const row of priorityRows) {
    const list = prioritiesByRegistrationId.get(row.registrationId) ?? [];
    list.push({
      leagueId: row.leagueId,
      priorityRank: row.priorityRank,
      byotTeammateText: row.byotTeammateText,
      teamRosterPlacements: parseTeamRosterPlacements(row.teamRosterPlacements),
    });
    prioritiesByRegistrationId.set(row.registrationId, list);
  }
  for (const list of prioritiesByRegistrationId.values()) {
    list.sort((a, b) => a.priorityRank - b.priorityRank);
  }

  const membersWithPriorities = [...registrationsByMemberId.entries()].filter(([, registration]) => {
    const priorities = prioritiesByRegistrationId.get(registration.id) ?? [];
    return priorities.some((priority) => priority.leagueId === leagueId);
  });
  const memberIdsToEvaluate = membersWithPriorities.map(([memberId]) => memberId);
  if (memberIdsToEvaluate.length === 0) return result;

  const participatedByMemberId = new Map<number, Set<number>>();
  const participationRows = await db
    .select({
      memberId: schema.leagueRoster.member_id,
      leagueId: schema.leagueRoster.league_id,
    })
    .from(schema.leagueRoster)
    .where(
      and(
        inArray(schema.leagueRoster.member_id, memberIdsToEvaluate),
        inArray(schema.leagueRoster.status, [...ROSTERED_STATUSES]),
      ),
    );
  for (const row of participationRows) {
    const set = participatedByMemberId.get(row.memberId) ?? new Set<number>();
    set.add(row.leagueId);
    participatedByMemberId.set(row.memberId, set);
  }

  const sabbaticalsByMemberId = new Map<
    number,
    Array<{ originalLeagueId: number | null; currentLeagueId: number | null; status: string }>
  >();
  const sabbaticalRows = await db
    .select({
      memberId: schema.curlingLeagueSabbaticals.member_id,
      originalLeagueId: schema.curlingLeagueSabbaticals.original_league_id,
      currentLeagueId: schema.curlingLeagueSabbaticals.current_league_id,
      status: schema.curlingLeagueSabbaticals.status,
    })
    .from(schema.curlingLeagueSabbaticals)
    .where(inArray(schema.curlingLeagueSabbaticals.member_id, memberIdsToEvaluate));
  for (const row of sabbaticalRows) {
    const list = sabbaticalsByMemberId.get(row.memberId) ?? [];
    list.push({
      originalLeagueId: row.originalLeagueId,
      currentLeagueId: row.currentLeagueId,
      status: row.status,
    });
    sabbaticalsByMemberId.set(row.memberId, list);
  }

  const predecessorIds = [
    ...new Set(leaguesUnsorted.map((row) => row.predecessor_league_id).filter((id): id is number => id != null)),
  ];
  const returnEligibleMemberIdsByLeagueId = new Map<number, Set<number>>();
  if (predecessorIds.length > 0) {
    const eligibleRows = await db
      .select({
        memberId: schema.leagueRoster.member_id,
        predecessorLeagueId: schema.leagueRoster.league_id,
      })
      .from(schema.leagueRoster)
      .where(
        and(
          inArray(schema.leagueRoster.league_id, predecessorIds),
          inArray(schema.leagueRoster.status, [...ROSTERED_STATUSES]),
        ),
      );
    const membersByPredecessorId = new Map<number, Set<number>>();
    for (const row of eligibleRows) {
      const set = membersByPredecessorId.get(row.predecessorLeagueId) ?? new Set<number>();
      set.add(row.memberId);
      membersByPredecessorId.set(row.predecessorLeagueId, set);
    }
    const teamMemberRows = await db
      .select({
        memberId: schema.teamMembers.member_id,
        predecessorLeagueId: schema.leagueTeams.league_id,
      })
      .from(schema.teamMembers)
      .innerJoin(schema.leagueTeams, eq(schema.teamMembers.team_id, schema.leagueTeams.id))
      .where(inArray(schema.leagueTeams.league_id, predecessorIds));
    for (const row of teamMemberRows) {
      const set = membersByPredecessorId.get(row.predecessorLeagueId) ?? new Set<number>();
      set.add(row.memberId);
      membersByPredecessorId.set(row.predecessorLeagueId, set);
    }
    for (const row of leaguesUnsorted) {
      if (row.predecessor_league_id == null) continue;
      returnEligibleMemberIdsByLeagueId.set(
        row.id,
        new Set(membersByPredecessorId.get(row.predecessor_league_id) ?? []),
      );
    }
  }

  for (const [memberId, registration] of membersWithPriorities) {
    const priorities = prioritiesByRegistrationId.get(registration.id) ?? [];
    const labels = evaluateGuaranteeLabels({
      priorities,
      desiredLeagueCount: registration.desiredLeagueCount,
      mode: labelMode,
      memberId,
      isReturningMember: registration.returningMemberAnswer === 1,
      participatedLeagueIds: participatedByMemberId.get(memberId) ?? new Set(),
      sabbaticals: sabbaticalsByMemberId.get(memberId) ?? [],
      leaguesById,
      returnEligibleMemberIdsByLeagueId,
    });
    const status = rosterStatusForLeague(leagueId, priorities, labels);
    if (status) result.set(memberId, status);
  }

  return result;
}

type SubmittedRegistrationRow = {
  id: number;
  desiredLeagueCount: number | null;
  returningMemberAnswer: number | null;
};

async function loadSubmittedRegistrationsByMemberId(
  db: DrizzleBundle['db'],
  schema: DrizzleBundle['schema'],
  sessionId: number,
  memberIds: number[],
): Promise<Map<number, SubmittedRegistrationRow>> {
  const registrationsByMemberId = new Map<number, SubmittedRegistrationRow>();
  if (memberIds.length === 0) return registrationsByMemberId;

  const registrationRows = await db
    .select({
      id: schema.curlingRegistrations.id,
      curlerMemberId: schema.curlingRegistrations.curler_member_id,
      status: schema.curlingRegistrations.status,
      updatedAt: schema.curlingRegistrations.updated_at,
      desiredLeagueCount: schema.curlingRegistrations.desired_league_count,
      returningMemberAnswer: schema.curlingRegistrations.returning_member_answer,
    })
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.session_id, sessionId),
        inArray(schema.curlingRegistrations.curler_member_id, memberIds),
      ),
    )
    .orderBy(desc(schema.curlingRegistrations.updated_at));

  for (const row of registrationRows) {
    if (row.curlerMemberId == null) continue;
    if (!isSubmittedCurlerRegistrationStatus(row.status)) continue;
    if (registrationsByMemberId.has(row.curlerMemberId)) continue;
    registrationsByMemberId.set(row.curlerMemberId, {
      id: row.id,
      desiredLeagueCount: row.desiredLeagueCount,
      returningMemberAnswer: row.returningMemberAnswer,
    });
  }
  return registrationsByMemberId;
}
