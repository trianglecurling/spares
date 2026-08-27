import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { expectedByotRosterSize, priorityHasLinkedMemberRoster } from './leaguePriorityRules.js';
import type {
  ByotDeclaredTeamContext,
  LeagueConfig,
  LeaguePriorityInput,
  PlayInCommittedOtherMemberTeam,
} from './registrationContext.js';
import { ROSTER_COMMIT_REGISTRATION_STATUS_LIST } from './registrationRosterService.js';
import { waitlistMemberDisplayName } from './waitlistAudit.js';
import {
  parseTeamRosterPlacements,
  waitlistEntryRosterMemberIds,
  waitlistRosterEntries,
} from './waitlistTeamRoster.js';

/**
 * Registrations whose saved BYOT roster is visible to a listed teammate.
 * Includes `shell_complete` so a partner who saved priorities but has not
 * submitted yet still appears as an existing declared team.
 */
const DECLARED_BYOT_TEAM_REGISTRATION_STATUS_LIST = [
  ...ROSTER_COMMIT_REGISTRATION_STATUS_LIST,
  'shell_complete',
] as const;

const ACTIVE_WAITLIST_STATUSES = ['active', 'offered'] as const;

export type ByotDeclaredTeamMember = {
  memberId: number | null;
  memberName: string | null;
  pendingName: string | null;
};

export type ByotDeclaredTeam = {
  id: number;
  createdByMemberId: number;
  createdByName: string | null;
  members: ByotDeclaredTeamMember[];
};

export type ByotDeclaredTeamSummary = {
  leagueId: number;
  teamSize: number;
  onExistingTeam: boolean;
  existingTeam: {
    id: number;
    name: string | null;
    createdByName: string | null;
    members: ByotDeclaredTeamMember[];
  } | null;
  committedOtherMemberIds: number[];
  committedOtherMemberTeams: PlayInCommittedOtherMemberTeam[];
};

/** Copies an existing BYOT team's members onto an empty priority roster. */
export function applyExistingByotTeamRosterIfEmpty(
  priorities: LeaguePriorityInput[],
  summaries: Record<number, ByotDeclaredTeamSummary>,
  registeringMemberId?: number | null,
): LeaguePriorityInput[] {
  return priorities.map((priority) => {
    const summary = summaries[priority.leagueId];
    if (!summary?.onExistingTeam || !summary.existingTeam) return priority;
    if (priorityHasLinkedMemberRoster(priority)) return priority;
    return {
      ...priority,
      ...rosterFromDeclaredTeamMembers(summary.existingTeam.members, registeringMemberId),
    };
  });
}

export function rosterFromDeclaredTeamMembers(
  members: Array<{ memberId?: number | null; pendingName?: string | null }>,
  registeringMemberId?: number | null,
): {
  teamRosterPlacements: Array<{ memberId: number }>;
  byotTeammateText: string | null;
} {
  const teamRosterPlacements: Array<{ memberId: number }> = [];
  const pendingNames: string[] = [];
  for (const member of members) {
    if (member.memberId != null && member.memberId !== registeringMemberId) {
      teamRosterPlacements.push({ memberId: member.memberId });
      continue;
    }
    const pendingName = member.pendingName?.trim();
    if (pendingName) pendingNames.push(pendingName);
  }
  return {
    teamRosterPlacements,
    byotTeammateText: pendingNames.length > 0 ? pendingNames.join('\n') : null,
  };
}

/** True when this member was listed on someone else's BYOT roster, not as the person who declared it. */
export function registrantWasAddedToByotTeam(
  memberId: number,
  team: { createdByMemberId: number; memberIds: number[] },
): boolean {
  return memberId !== team.createdByMemberId && team.memberIds.includes(memberId);
}

export async function loadByotDeclaredTeamContextsForRegistration(input: {
  memberId: number | null;
  registrationId?: number | null;
  leagues: Record<number, LeagueConfig>;
}): Promise<Record<number, ByotDeclaredTeamContext>> {
  const summaries = await buildByotDeclaredTeamSummaries(input);
  const result: Record<number, ByotDeclaredTeamContext> = {};
  for (const [key, summary] of Object.entries(summaries)) {
    const existingTeamMemberIds = (summary.existingTeam?.members ?? [])
      .map((member) => member.memberId)
      .filter((id): id is number => id != null);
    result[Number(key)] = {
      onExistingTeam: summary.onExistingTeam,
      existingTeamId: summary.existingTeam?.id ?? null,
      existingTeamMemberIds,
      committedOtherMemberIds: summary.committedOtherMemberIds,
      committedOtherMemberTeams: summary.committedOtherMemberTeams,
      teamSize: summary.teamSize,
    };
  }
  return result;
}

/**
 * Declared non-play-in BYOT teams for every such league in the catalog: whether
 * the registrant was already listed by a teammate, and which members are
 * committed to other teams.
 */
export async function buildByotDeclaredTeamSummaries(input: {
  memberId: number | null;
  registrationId?: number | null;
  leagues: Record<number, LeagueConfig>;
}): Promise<Record<number, ByotDeclaredTeamSummary>> {
  const byotLeagues = Object.values(input.leagues).filter(
    (league) => league.leagueType === 'bring_your_own_team' && league.isPlayInBased !== true,
  );
  const summaries: Record<number, ByotDeclaredTeamSummary> = {};
  for (const league of byotLeagues) {
    const teamSize = expectedByotRosterSize(league) ?? 0;
    const teams = await loadDeclaredByotTeamsForLeague({
      leagueId: league.id,
      waitlistId: league.waitlistId,
      excludeRegistrationId: input.registrationId ?? null,
    });
    const memberId = input.memberId;
    const existing =
      memberId != null
        ? teams.find((team) =>
            registrantWasAddedToByotTeam(memberId, {
              createdByMemberId: team.createdByMemberId,
              memberIds: team.members
                .map((member) => member.memberId)
                .filter((id): id is number => id != null),
            }),
          ) ?? null
        : null;
    const otherTeams = teams.filter((team) => team.id !== existing?.id);
    const committedOtherMemberTeams: PlayInCommittedOtherMemberTeam[] = [];
    const committedOtherMemberIdSet = new Set<number>();
    for (const team of otherTeams) {
      const roster = team.members.map((member) => ({
        memberId: member.memberId,
        memberName: member.memberName,
        pendingName: member.pendingName,
      }));
      for (const member of team.members) {
        if (member.memberId == null || member.memberId === memberId) continue;
        if (committedOtherMemberIdSet.has(member.memberId)) continue;
        committedOtherMemberIdSet.add(member.memberId);
        committedOtherMemberTeams.push({
          memberId: member.memberId,
          team: { id: team.id, name: null, members: roster },
        });
      }
    }
    summaries[league.id] = {
      leagueId: league.id,
      teamSize,
      onExistingTeam: Boolean(existing),
      existingTeam: existing
        ? {
            id: existing.id,
            name: null,
            createdByName: existing.createdByName,
            members: existing.members,
          }
        : null,
      committedOtherMemberIds: [...committedOtherMemberIdSet],
      committedOtherMemberTeams,
    };
  }
  return summaries;
}

export async function loadDeclaredByotTeamsForLeague(input: {
  leagueId: number;
  waitlistId?: number | null;
  excludeRegistrationId?: number | null;
}): Promise<ByotDeclaredTeam[]> {
  const excludeRegistrationId = input.excludeRegistrationId ?? null;
  const fromRegistrations = await loadTeamsFromSubmittedPriorities({
    leagueId: input.leagueId,
    excludeRegistrationId,
  });
  const fromWaitlists = await loadTeamsFromWaitlistEntries({
    waitlistId: input.waitlistId,
    excludeRegistrationId,
  });
  return dedupeByotTeams([...fromRegistrations, ...fromWaitlists]);
}

export type LeagueDeclaredByotTeamMember = ByotDeclaredTeamMember & {
  onLeagueRoster: boolean;
};

export type LeagueDeclaredByotTeam = {
  id: number;
  createdByMemberId: number;
  createdByName: string | null;
  members: LeagueDeclaredByotTeamMember[];
};

/**
 * Declared BYOT teams for the league roster page. Returns null when the league
 * does not exist, and an empty list for standard or play-in leagues.
 * Teams with nobody on the league roster are omitted so waitlisted-only pairs
 * stay off the roster view.
 */
export async function listDeclaredByotTeamsForLeagueRoster(
  leagueId: number,
): Promise<LeagueDeclaredByotTeam[] | null> {
  const { db, schema } = getDrizzleDb();
  const [league] = await db
    .select({
      id: schema.leagues.id,
      leagueType: schema.leagues.league_type,
      isPlayInBased: schema.leagues.is_play_in_based,
      waitlistId: schema.leagues.waitlist_id,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);
  if (!league) return null;
  if (league.leagueType !== 'bring_your_own_team' || Number(league.isPlayInBased) === 1) {
    return [];
  }

  const teams = await loadDeclaredByotTeamsForLeague({
    leagueId: league.id,
    waitlistId: league.waitlistId,
  });
  const rosterRows = await db
    .select({ memberId: schema.leagueRoster.member_id })
    .from(schema.leagueRoster)
    .where(eq(schema.leagueRoster.league_id, leagueId));
  const rosterIds = new Set(rosterRows.map((row) => row.memberId));

  return teams
    .map((team) => ({
      id: team.id,
      createdByMemberId: team.createdByMemberId,
      createdByName: team.createdByName,
      members: team.members.map((member) => ({
        ...member,
        onLeagueRoster: member.memberId != null && rosterIds.has(member.memberId),
      })),
    }))
    .filter(
      (team) =>
        team.members.length > 1 && team.members.some((member) => member.onLeagueRoster),
    );
}

export function dedupeByotTeams(teams: ByotDeclaredTeam[]): ByotDeclaredTeam[] {
  const seen = new Set<string>();
  const result: ByotDeclaredTeam[] = [];
  for (const team of teams) {
    const key = team.members
      .map((member) => String(member.memberId ?? `pending:${member.pendingName ?? ''}`))
      .sort()
      .join(',');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(team);
  }
  return result;
}

async function loadTeamsFromSubmittedPriorities(input: {
  leagueId: number;
  excludeRegistrationId: number | null;
}): Promise<ByotDeclaredTeam[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      priorityId: schema.registrationLeaguePriorities.id,
      registrationId: schema.registrationLeaguePriorities.registration_id,
      curlerMemberId: schema.curlingRegistrations.curler_member_id,
      teamRosterPlacements: schema.registrationLeaguePriorities.team_roster_placements,
      byotTeammateText: schema.registrationLeaguePriorities.byot_teammate_text,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      name: schema.members.name,
      email: schema.members.email,
    })
    .from(schema.registrationLeaguePriorities)
    .innerJoin(
      schema.curlingRegistrations,
      eq(schema.registrationLeaguePriorities.registration_id, schema.curlingRegistrations.id),
    )
    .innerJoin(schema.members, eq(schema.curlingRegistrations.curler_member_id, schema.members.id))
    .where(
      and(
        eq(schema.registrationLeaguePriorities.league_id, input.leagueId),
        inArray(schema.curlingRegistrations.status, [...DECLARED_BYOT_TEAM_REGISTRATION_STATUS_LIST]),
        ...(input.excludeRegistrationId != null
          ? [ne(schema.curlingRegistrations.id, input.excludeRegistrationId)]
          : []),
      ),
    );

  const memberIds = new Set<number>();
  const parsed = rows.flatMap((row) => {
    if (row.curlerMemberId == null) return [];
    const placements = parseTeamRosterPlacements(row.teamRosterPlacements);
    for (const placement of placements) memberIds.add(placement.memberId);
    memberIds.add(row.curlerMemberId);
    return [
      {
        id: row.priorityId,
        createdByMemberId: row.curlerMemberId,
        createdByName: waitlistMemberDisplayName({
          first_name: row.firstName,
          last_name: row.lastName,
          name: row.name,
          email: row.email,
        }),
        placementIds: placements.map((placement) => placement.memberId),
        pendingNames: waitlistRosterEntries(row.byotTeammateText),
      },
    ];
  });
  const names = await loadMemberDisplayNames([...memberIds]);
  return parsed.map((row) => ({
    id: row.id,
    createdByMemberId: row.createdByMemberId,
    createdByName: row.createdByName,
    members: membersFromCreatorPlacementsAndPending({
      createdByMemberId: row.createdByMemberId,
      createdByName: row.createdByName,
      placementIds: row.placementIds,
      pendingNames: row.pendingNames,
      names,
    }),
  }));
}

async function loadTeamsFromWaitlistEntries(input: {
  waitlistId?: number | null;
  excludeRegistrationId: number | null;
}): Promise<ByotDeclaredTeam[]> {
  if (input.waitlistId == null) return [];
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.waitlistEntries.id,
      memberId: schema.waitlistEntries.member_id,
      teamRosterPlacements: schema.waitlistEntries.team_roster_placements,
      teamRosterText: schema.waitlistEntries.team_roster_text,
      sourceRegistrationId: schema.waitlistEntries.source_registration_id,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      name: schema.members.name,
      email: schema.members.email,
    })
    .from(schema.waitlistEntries)
    .innerJoin(schema.members, eq(schema.waitlistEntries.member_id, schema.members.id))
    .where(
      and(
        eq(schema.waitlistEntries.waitlist_id, input.waitlistId),
        inArray(schema.waitlistEntries.status, [...ACTIVE_WAITLIST_STATUSES]),
        ...(input.excludeRegistrationId != null
          ? [
              or(
                isNull(schema.waitlistEntries.source_registration_id),
                ne(schema.waitlistEntries.source_registration_id, input.excludeRegistrationId),
              ),
            ]
          : []),
      ),
    );

  const memberIds = new Set<number>();
  const parsed = rows.map((row) => {
    const rosterIds = waitlistEntryRosterMemberIds(row);
    for (const id of rosterIds) memberIds.add(id);
    memberIds.add(row.memberId);
    return {
      id: -row.id,
      createdByMemberId: row.memberId,
      createdByName: waitlistMemberDisplayName({
        first_name: row.firstName,
        last_name: row.lastName,
        name: row.name,
        email: row.email,
      }),
      placementIds: rosterIds,
      teamRosterText: row.teamRosterText,
    };
  });
  const names = await loadMemberDisplayNames([...memberIds]);
  return parsed.map((row) => ({
    id: row.id,
    createdByMemberId: row.createdByMemberId,
    createdByName: row.createdByName,
    members: membersFromCreatorPlacementsAndPending({
      createdByMemberId: row.createdByMemberId,
      createdByName: row.createdByName,
      placementIds: row.placementIds,
      pendingNames: pendingNamesNotMatchingMembers(row.teamRosterText, names),
      names,
    }),
  }));
}

function pendingNamesNotMatchingMembers(
  teamRosterText: string | null | undefined,
  names: Map<number, string>,
): string[] {
  const known = new Set([...names.values()].map((name) => name.trim().toLowerCase()));
  return waitlistRosterEntries(teamRosterText).filter((name) => !known.has(name.trim().toLowerCase()));
}

function membersFromCreatorPlacementsAndPending(input: {
  createdByMemberId: number;
  createdByName: string | null;
  placementIds: number[];
  pendingNames: string[];
  names: Map<number, string>;
}): ByotDeclaredTeamMember[] {
  const seen = new Set<number>();
  const members: ByotDeclaredTeamMember[] = [];
  const addMember = (memberId: number, memberName: string | null) => {
    if (seen.has(memberId)) return;
    seen.add(memberId);
    members.push({ memberId, memberName, pendingName: null });
  };
  addMember(input.createdByMemberId, input.createdByName);
  for (const memberId of input.placementIds) {
    addMember(memberId, input.names.get(memberId) ?? null);
  }
  for (const pendingName of input.pendingNames) {
    members.push({ memberId: null, memberName: pendingName, pendingName });
  }
  return members;
}

async function loadMemberDisplayNames(memberIds: number[]): Promise<Map<number, string>> {
  if (memberIds.length === 0) return new Map();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.members.id,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      name: schema.members.name,
      email: schema.members.email,
    })
    .from(schema.members)
    .where(inArray(schema.members.id, memberIds));
  return new Map(
    rows.map((row) => [
      row.id,
      waitlistMemberDisplayName({
        first_name: row.firstName,
        last_name: row.lastName,
        name: row.name,
        email: row.email,
      }),
    ]),
  );
}
