import { and, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../../db/drizzle-db.js';
import { ROSTER_COMMIT_REGISTRATION_STATUS_LIST } from '../registrationRosterService.js';
import { loadWaitlistQueueMemberStats } from '../waitlistQueueMemberStats.js';
import { loadRenderedWaitlistOrder } from '../waitlistQueueService.js';
import { parseTeamRosterPlacements } from '../waitlistTeamRoster.js';
import { timestampToMillis } from '../waitlistOfferPreference.js';
import { effectiveLeagueRegistrationFeeMinor } from '../registrationConfigValidation.js';
import { applyLeagueCategoryOverrides, resolveLeagueCategoryFromName, type LeagueCategoryOverrideMap } from './rosterRebuildLeagues.js';
import {
  receivedDuringPriorityPeriod,
  resolvePriorityPeriodEnd,
} from './rosterRebuildPriorityPeriod.js';
import type {
  RosterRebuildLeague,
  RosterRebuildMember,
  RosterRebuildRegistration,
  RosterRebuildRosterRow,
  RosterRebuildSnapshot,
  RosterRebuildWaitlistEntry,
} from './rosterRebuildTypes.js';

function timestampToString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export async function findSessionByName(sessionName: string): Promise<{ id: number; name: string; seasonId: number }> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
      seasonId: schema.curlingSessions.season_id,
    })
    .from(schema.curlingSessions);
  const exact = rows.find((row) => row.name === sessionName);
  const insensitive = rows.find((row) => row.name.trim().toLowerCase() === sessionName.trim().toLowerCase());
  const match = exact ?? insensitive;
  if (!match) {
    const available = rows.map((row) => row.name).sort().join(', ') || '(none)';
    throw new Error(`Session "${sessionName}" was not found. Available sessions: ${available}`);
  }
  return match;
}

export async function loadSessionLeagues(
  sessionId: number,
  overrides: LeagueCategoryOverrideMap = {},
): Promise<RosterRebuildLeague[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      sessionId: schema.leagues.session_id,
      format: schema.leagues.format,
      capacityType: schema.leagues.capacity_type,
      capacityValue: schema.leagues.capacity_value,
      waitlistId: schema.leagues.waitlist_id,
      predecessorLeagueId: schema.leagues.predecessor_league_id,
      isPlayInBased: schema.leagues.is_play_in_based,
      isJuniorRecreational: schema.leagues.is_junior_recreational,
      registrationFeeOverrideMinor: schema.leagues.registration_fee_override_minor,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.session_id, sessionId));

  const [price] = await db
    .select({ defaultLeagueFeeMinor: schema.registrationPriceSettings.default_league_fee_minor })
    .from(schema.registrationPriceSettings)
    .limit(1);
  const defaultLeagueFeeMinor = Number(price?.defaultLeagueFeeMinor ?? 0);

  const predecessorIds = [...new Set(rows.map((row) => row.predecessorLeagueId).filter((id): id is number => id != null))];
  const predecessorNames = new Map<number, string>();
  if (predecessorIds.length > 0) {
    const predecessors = await db
      .select({ id: schema.leagues.id, name: schema.leagues.name })
      .from(schema.leagues)
      .where(inArray(schema.leagues.id, predecessorIds));
    for (const row of predecessors) predecessorNames.set(row.id, row.name);
  }

  const mapped: RosterRebuildLeague[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    sessionId: row.sessionId ?? sessionId,
    format: row.format,
    capacityType: row.capacityType,
    capacityValue: Number(row.capacityValue ?? 0),
    waitlistId: row.waitlistId ?? null,
    predecessorLeagueId: row.predecessorLeagueId ?? null,
    predecessorName: row.predecessorLeagueId != null ? (predecessorNames.get(row.predecessorLeagueId) ?? null) : null,
    isPlayInBased: Number(row.isPlayInBased) === 1,
    isJuniorRecreational: Number(row.isJuniorRecreational) === 1,
    registrationFeeMinor: effectiveLeagueRegistrationFeeMinor(row.registrationFeeOverrideMinor, defaultLeagueFeeMinor),
    category: resolveLeagueCategoryFromName({
      name: row.name,
      isPlayInBased: row.isPlayInBased,
      isJuniorRecreational: row.isJuniorRecreational,
      format: row.format,
    }),
  }));
  return applyLeagueCategoryOverrides(mapped, overrides).sort((a, b) => a.id - b.id);
}

export async function loadRosterRebuildSnapshot(input: {
  sessionId: number;
  sessionName: string;
  overrides?: LeagueCategoryOverrideMap;
}): Promise<RosterRebuildSnapshot> {
  const { db, schema } = getDrizzleDb();
  const leagues = await loadSessionLeagues(input.sessionId, input.overrides ?? {});
  const leagueIds = leagues.map((league) => league.id);
  const predecessorIds = [...new Set(leagues.map((league) => league.predecessorLeagueId).filter((id): id is number => id != null))];

  const currentRosters = leagueIds.length > 0 ? await loadRosterRows(leagueIds) : [];
  const predecessorRosters = predecessorIds.length > 0 ? await loadRosterRows(predecessorIds) : [];

  const registrationRows =
    leagueIds.length === 0
      ? []
      : await db
          .select({
            id: schema.curlingRegistrations.id,
            memberId: schema.curlingRegistrations.curler_member_id,
            status: schema.curlingRegistrations.status,
            desiredLeagueCount: schema.curlingRegistrations.desired_league_count,
            membershipOption: schema.curlingRegistrations.membership_option,
            icePrivilegesChoice: schema.curlingRegistrations.ice_privileges_choice,
            submittedAt: schema.curlingRegistrations.submitted_at,
            createdAt: schema.curlingRegistrations.created_at,
          })
          .from(schema.curlingRegistrations)
          .where(
            and(
              eq(schema.curlingRegistrations.session_id, input.sessionId),
              // Excludes cancelled, drafts, and other non-commit statuses.
              inArray(schema.curlingRegistrations.status, [...ROSTER_COMMIT_REGISTRATION_STATUS_LIST]),
            ),
          );

  const grouped = new Map<number, typeof registrationRows>();
  const duplicateRegistrationMemberIds: number[] = [];
  for (const row of registrationRows) {
    if (row.memberId == null) continue;
    const list = grouped.get(row.memberId) ?? [];
    list.push(row);
    grouped.set(row.memberId, list);
  }
  const chosenRegistrations = [...grouped.entries()].map(([memberId, rows]) => {
    const sorted = [...rows].sort((a, b) => b.id - a.id);
    if (sorted.length > 1) duplicateRegistrationMemberIds.push(memberId);
    return sorted[0]!;
  });
  const registrationIds = chosenRegistrations.map((row) => row.id);

  const priorityRows =
    registrationIds.length === 0
      ? []
      : await db
          .select({
            registrationId: schema.registrationLeaguePriorities.registration_id,
            leagueId: schema.registrationLeaguePriorities.league_id,
            rank: schema.registrationLeaguePriorities.priority_rank,
            teammateText: schema.registrationLeaguePriorities.byot_teammate_text,
            teamRosterPlacements: schema.registrationLeaguePriorities.team_roster_placements,
          })
          .from(schema.registrationLeaguePriorities)
          .where(inArray(schema.registrationLeaguePriorities.registration_id, registrationIds));

  const selectionRows =
    registrationIds.length === 0
      ? []
      : await db
          .select({
            registrationId: schema.registrationSelections.registration_id,
            selectionType: schema.registrationSelections.selection_type,
            leagueId: schema.registrationSelections.league_id,
            status: schema.registrationSelections.status,
          })
          .from(schema.registrationSelections)
          .where(inArray(schema.registrationSelections.registration_id, registrationIds));

  const inactiveSelectionStatuses = new Set(['dropped', 'cancelled', 'declined', 'not_placed']);
  const juniorRecByRegistration = new Set(
    selectionRows.filter((row) => row.selectionType === 'junior_recreational').map((row) => row.registrationId),
  );
  const sabbaticalLeagueIdsByRegistration = new Map<number, number[]>();
  for (const row of selectionRows) {
    if (row.selectionType !== 'sabbatical' || row.leagueId == null) continue;
    if (inactiveSelectionStatuses.has(row.status)) continue;
    const list = sabbaticalLeagueIdsByRegistration.get(row.registrationId) ?? [];
    if (!list.includes(row.leagueId)) list.push(row.leagueId);
    sabbaticalLeagueIdsByRegistration.set(row.registrationId, list);
  }

  const prioritiesByRegistration = new Map<number, RosterRebuildRegistration['priorities']>();
  for (const row of priorityRows) {
    const list = prioritiesByRegistration.get(row.registrationId) ?? [];
    list.push({
      leagueId: row.leagueId,
      rank: row.rank,
      teammateMemberIds: parseTeamRosterPlacements(row.teamRosterPlacements).map((placement) => placement.memberId),
      teammateText: row.teammateText ?? null,
    });
    prioritiesByRegistration.set(row.registrationId, list);
  }

  const transitionRows = await db
    .select({
      id: schema.registrationStateTransitions.id,
      state: schema.registrationStateTransitions.state,
      effectiveAt: schema.registrationStateTransitions.effective_at,
    })
    .from(schema.registrationStateTransitions)
    .where(eq(schema.registrationStateTransitions.session_id, input.sessionId));
  const priorityPeriod = resolvePriorityPeriodEnd(
    transitionRows.map((row) => ({ id: row.id, state: row.state, effectiveAt: row.effectiveAt })),
  );

  const registrations: RosterRebuildRegistration[] = chosenRegistrations.map((row) => {
    const submittedAt = timestampToString(row.submittedAt);
    const receivedAt = timestampToMillis(row.submittedAt) ?? timestampToMillis(row.createdAt);
    return {
      id: row.id,
      memberId: row.memberId!,
      status: row.status,
      desiredLeagueCount: row.desiredLeagueCount,
      membershipOption: row.membershipOption,
      priorities: (prioritiesByRegistration.get(row.id) ?? []).sort((a, b) => a.rank - b.rank),
      juniorRecreationalSelection: juniorRecByRegistration.has(row.id),
      sabbaticalLeagueIds: sabbaticalLeagueIdsByRegistration.get(row.id) ?? [],
      submittedAt,
      receivedDuringPriorityPeriod: receivedDuringPriorityPeriod(receivedAt, priorityPeriod.endMs),
      icePrivilegesChoice: row.icePrivilegesChoice ?? 'none',
    };
  });

  const waitlistIds = [...new Set(leagues.map((league) => league.waitlistId).filter((id): id is number => id != null))];
  const waitlistEntriesByWaitlistId = new Map<number, RosterRebuildWaitlistEntry[]>();

  if (waitlistIds.length > 0) {
    const entryRows = await db
      .select({
        id: schema.waitlistEntries.id,
        waitlistId: schema.waitlistEntries.waitlist_id,
        memberId: schema.waitlistEntries.member_id,
        declineCount: schema.waitlistEntries.decline_count,
        priorityRankSnapshot: schema.waitlistEntries.priority_rank,
        desiredLeagueCountSnapshot: schema.waitlistEntries.desired_league_count,
        status: schema.waitlistEntries.status,
      })
      .from(schema.waitlistEntries)
      .where(and(inArray(schema.waitlistEntries.waitlist_id, waitlistIds), eq(schema.waitlistEntries.status, 'active')));

    const byWaitlist = new Map<number, typeof entryRows>();
    for (const row of entryRows) {
      const list = byWaitlist.get(row.waitlistId) ?? [];
      list.push(row);
      byWaitlist.set(row.waitlistId, list);
    }

    for (const waitlistId of waitlistIds) {
      const rendered = await loadRenderedWaitlistOrder(waitlistId);
      const details = new Map((byWaitlist.get(waitlistId) ?? []).map((row) => [row.id, row]));
      const ordered: RosterRebuildWaitlistEntry[] = [];
      rendered.entries.forEach((entry, index) => {
        const detail = details.get(entry.id);
        if (!detail) return;
        ordered.push({
          id: detail.id,
          waitlistId: detail.waitlistId,
          memberId: detail.memberId,
          position: index + 1,
          declineCount: Number(detail.declineCount ?? 0),
          priorityRankSnapshot: detail.priorityRankSnapshot ?? null,
          desiredLeagueCountSnapshot: detail.desiredLeagueCountSnapshot ?? null,
          status: detail.status,
        });
      });
      waitlistEntriesByWaitlistId.set(waitlistId, ordered);
    }
  }

  const memberIds = [
    ...new Set([
      ...registrations.map((row) => row.memberId),
      ...currentRosters.map((row) => row.memberId),
      ...predecessorRosters.map((row) => row.memberId),
      ...[...waitlistEntriesByWaitlistId.values()].flatMap((entries) => entries.map((entry) => entry.memberId)),
    ]),
  ];

  const memberRows =
    memberIds.length === 0
      ? []
      : await db
          .select({
            id: schema.members.id,
            name: schema.members.name,
            email: schema.members.email,
            firstName: schema.members.first_name,
            lastName: schema.members.last_name,
          })
          .from(schema.members)
          .where(inArray(schema.members.id, memberIds));
  const stats = await loadWaitlistQueueMemberStats(memberIds);
  const members = new Map<number, RosterRebuildMember>();
  for (const row of memberRows) {
    const nameParts = [row.firstName, row.lastName].map((part) => part?.trim()).filter(Boolean);
    const name = nameParts.length > 0 ? nameParts.join(' ') : row.name;
    const memberStats = stats.get(row.id);
    members.set(row.id, {
      memberId: row.id,
      name,
      email: row.email,
      isLifetimeMember: memberStats?.isLifetimeMember ?? false,
      clubTenureYears: memberStats?.clubTenureYears ?? 0,
      totalExperienceYears: memberStats?.totalExperienceYears ?? 0,
    });
  }

  const tuesdayEveningIds = leagues.filter((league) => league.category === 'tuesday_evening').map((league) => league.id);
  const tuesdayEveningRosterMemberIds = new Set(
    currentRosters.filter((row) => tuesdayEveningIds.includes(row.leagueId) && row.status === 'active').map((row) => row.memberId),
  );
  const unmanagedPlayInLeagueIds = leagues
    .filter((league) => league.category === 'tuesday_evening' || league.isPlayInBased)
    .map((league) => league.id);
  const unmanagedOccupiedKeys = await loadUnmanagedOccupiedKeys({
    leagueIds: unmanagedPlayInLeagueIds,
    memberIds,
  });

  const activeSabbaticals =
    leagueIds.length === 0
      ? []
      : (
          await db
            .select({
              id: schema.curlingLeagueSabbaticals.id,
              leagueId: schema.curlingLeagueSabbaticals.current_league_id,
              memberId: schema.curlingLeagueSabbaticals.member_id,
              status: schema.curlingLeagueSabbaticals.status,
            })
            .from(schema.curlingLeagueSabbaticals)
            .where(
              and(
                inArray(schema.curlingLeagueSabbaticals.current_league_id, leagueIds),
                eq(schema.curlingLeagueSabbaticals.status, 'active'),
              ),
            )
        ).flatMap((row) =>
          row.leagueId == null
            ? []
            : [{ id: row.id, leagueId: row.leagueId, memberId: row.memberId, status: row.status }],
        );

  const pendingOffers =
    leagueIds.length === 0
      ? []
      : await db
          .select({
            id: schema.waitlistOffers.id,
            leagueId: schema.waitlistOffers.league_id,
            memberId: schema.waitlistOffers.member_id,
            waitlistEntryId: schema.waitlistOffers.waitlist_entry_id,
          })
          .from(schema.waitlistOffers)
          .where(and(inArray(schema.waitlistOffers.league_id, leagueIds), eq(schema.waitlistOffers.status, 'pending')));

  const guaranteedReturnPlacementCount = currentRosters.filter(
    (row) => row.status === 'active' && row.placementType === 'guaranteed_return',
  ).length;
  const waitlistPlacementCount = currentRosters.filter(
    (row) => row.status === 'active' && row.placementType === 'waitlist',
  ).length;

  return {
    sessionId: input.sessionId,
    sessionName: input.sessionName,
    leagues,
    currentRosters,
    predecessorRosters,
    registrations,
    waitlistEntriesByWaitlistId,
    members,
    tuesdayEveningRosterMemberIds,
    unmanagedOccupiedKeys,
    activeSabbaticals,
    pendingOffers,
    duplicateRegistrationMemberIds,
    guaranteedReturnPlacementCount,
    waitlistPlacementCount,
    priorityPeriodEndAt: priorityPeriod.endIso,
    priorityPeriodEndSource: priorityPeriod.source,
  };
}

/** Entry-team statuses that still occupy a play-in / Tuesday desired-count slot. */
const PLAY_IN_OCCUPYING_ENTRY_STATUSES = ['pending', 'guaranteed', 'playdown', 'entered'] as const;

async function loadUnmanagedOccupiedKeys(input: {
  leagueIds: number[];
  memberIds: number[];
}): Promise<Set<string>> {
  const keys = new Set<string>();
  if (input.leagueIds.length === 0 || input.memberIds.length === 0) return keys;
  const { db, schema } = getDrizzleDb();

  const entryRows = await db
    .select({
      leagueId: schema.leagueEntryTeams.league_id,
      memberId: schema.leagueEntryTeamMembers.member_id,
    })
    .from(schema.leagueEntryTeamMembers)
    .innerJoin(schema.leagueEntryTeams, eq(schema.leagueEntryTeamMembers.entry_team_id, schema.leagueEntryTeams.id))
    .where(
      and(
        inArray(schema.leagueEntryTeams.league_id, input.leagueIds),
        inArray(schema.leagueEntryTeams.status, [...PLAY_IN_OCCUPYING_ENTRY_STATUSES]),
        inArray(schema.leagueEntryTeamMembers.member_id, input.memberIds),
      ),
    );
  for (const row of entryRows) {
    if (row.memberId == null) continue;
    keys.add(`${row.leagueId}:${row.memberId}`);
  }

  const teamRows = await findTeamMemberAssignments(input.leagueIds);
  const memberIdSet = new Set(input.memberIds);
  for (const row of teamRows) {
    if (!memberIdSet.has(row.memberId)) continue;
    keys.add(`${row.leagueId}:${row.memberId}`);
  }
  return keys;
}

export async function loadRosterRows(leagueIds: number[]): Promise<RosterRebuildRosterRow[]> {
  if (leagueIds.length === 0) return [];
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.leagueRoster.league_id,
      memberId: schema.leagueRoster.member_id,
      status: schema.leagueRoster.status,
      placementType: schema.leagueRoster.placement_type,
      isTemporarySabbaticalFill: schema.leagueRoster.is_temporary_sabbatical_fill,
      relatedSabbaticalId: schema.leagueRoster.related_sabbatical_id,
      sourceRegistrationId: schema.leagueRoster.source_registration_id,
      createdAt: schema.leagueRoster.created_at,
    })
    .from(schema.leagueRoster)
    .where(inArray(schema.leagueRoster.league_id, leagueIds));
  return rows.map((row) => ({
    leagueId: row.leagueId,
    memberId: row.memberId,
    status: row.status,
    placementType: row.placementType ?? null,
    isTemporarySabbaticalFill: Number(row.isTemporarySabbaticalFill) === 1,
    relatedSabbaticalId: row.relatedSabbaticalId ?? null,
    sourceRegistrationId: row.sourceRegistrationId ?? null,
    createdAt: timestampToString(row.createdAt),
  }));
}

export async function loadRosterExportRows(leagueIds: number[]): Promise<
  Array<
    RosterRebuildRosterRow & {
      leagueName: string;
      memberName: string;
      memberEmail: string;
    }
  >
> {
  if (leagueIds.length === 0) return [];
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.leagueRoster.league_id,
      leagueName: schema.leagues.name,
      memberId: schema.leagueRoster.member_id,
      memberName: schema.members.name,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      memberEmail: schema.members.email,
      status: schema.leagueRoster.status,
      placementType: schema.leagueRoster.placement_type,
      isTemporarySabbaticalFill: schema.leagueRoster.is_temporary_sabbatical_fill,
      relatedSabbaticalId: schema.leagueRoster.related_sabbatical_id,
      sourceRegistrationId: schema.leagueRoster.source_registration_id,
      createdAt: schema.leagueRoster.created_at,
    })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .innerJoin(schema.members, eq(schema.leagueRoster.member_id, schema.members.id))
    .where(inArray(schema.leagueRoster.league_id, leagueIds));
  return rows.map((row) => {
    const nameParts = [row.firstName, row.lastName].map((part) => part?.trim()).filter(Boolean);
    return {
      leagueId: row.leagueId,
      leagueName: row.leagueName,
      memberId: row.memberId,
      memberName: nameParts.length > 0 ? nameParts.join(' ') : row.memberName,
      memberEmail: row.memberEmail,
      status: row.status,
      placementType: row.placementType ?? null,
      isTemporarySabbaticalFill: Number(row.isTemporarySabbaticalFill) === 1,
      relatedSabbaticalId: row.relatedSabbaticalId ?? null,
      sourceRegistrationId: row.sourceRegistrationId ?? null,
      createdAt: timestampToString(row.createdAt),
    };
  });
}

export async function findTeamMemberAssignments(leagueIds: number[]): Promise<Array<{ leagueId: number; memberId: number; teamId: number }>> {
  if (leagueIds.length === 0) return [];
  const { db, schema } = getDrizzleDb();
  return db
    .select({
      leagueId: schema.leagueTeams.league_id,
      memberId: schema.teamMembers.member_id,
      teamId: schema.teamMembers.team_id,
    })
    .from(schema.teamMembers)
    .innerJoin(schema.leagueTeams, eq(schema.teamMembers.team_id, schema.leagueTeams.id))
    .where(inArray(schema.leagueTeams.league_id, leagueIds));
}
