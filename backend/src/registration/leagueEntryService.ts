import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { LeagueEntryTeamStatusSqlite } from '../db/drizzle-schema.js';
import type { LeagueConfig, LeaguePriorityInput, PlayInEntryContext, RegistrationContext } from './registrationContext.js';
import type { LeaguePriorityEvaluation } from './leaguePriorityEvaluation.js';
import { waitlistRosterEntries } from './waitlistTeamRoster.js';
import { releaseOverflowLeaguePlacements } from './leaguePlacementRelease.js';
import {
  aggregateMemberPoints,
  entryTeamToEvaluationInput,
  evaluatePlayInLeague,
  loadLeagueEntryPoints,
  loadLeagueEntryTeams,
  loadPlayInLeagueConfig,
  numberToPointsHalf,
  playInAutoEntryCount,
  playInTeamSize,
  pointsHalfToNumber,
  type LeagueEntryTeamRow,
  type PlayInEvaluatedTeam,
  type PlayInLeagueEvaluation,
  type PlayInTeamForEvaluation,
} from './playInEntryService.js';

export class LeagueEntryValidationError extends Error {
  details: Record<string, string>;

  constructor(details: Record<string, string>) {
    super(Object.values(details)[0] ?? 'League entry validation failed');
    this.details = details;
  }
}

function requirePlayInBasedLeague(league: { isPlayInBased: boolean }): void {
  if (!league.isPlayInBased) {
    throw new LeagueEntryValidationError({ league: 'League is not play-in based.' });
  }
}

type DbExecutor = Pick<ReturnType<typeof getDrizzleDb>['db'], 'select' | 'insert' | 'update' | 'delete'>;

const ACTIVE_ENTRY_TEAM_STATUSES: LeagueEntryTeamStatusSqlite[] = ['pending', 'guaranteed', 'playdown', 'entered'];
/** Declared teams still in the registration/playdown pipeline (safe to auto-delete when empty). */
const MUTABLE_ENTRY_TEAM_STATUSES: LeagueEntryTeamStatusSqlite[] = ['pending', 'guaranteed', 'playdown'];

function isActiveEntryTeamStatus(status: LeagueEntryTeamStatusSqlite): boolean {
  return ACTIVE_ENTRY_TEAM_STATUSES.includes(status);
}

function isMutableEntryTeamStatus(status: LeagueEntryTeamStatusSqlite): boolean {
  return MUTABLE_ENTRY_TEAM_STATUSES.includes(status);
}

/** Account-linked member ids on an entry team or draft (order-independent). */
export function entryTeamAccountMemberIdSet(
  members: Array<{ member_id?: number | null; memberId?: number | null }>,
): Set<number> {
  const ids = new Set<number>();
  for (const member of members) {
    const id = member.member_id ?? member.memberId ?? null;
    if (id != null) ids.add(id);
  }
  return ids;
}

export function sameEntryTeamMemberIdSet(left: Set<number>, right: Set<number>): boolean {
  if (left.size === 0 || left.size !== right.size) return false;
  for (const id of left) {
    if (!right.has(id)) return false;
  }
  return true;
}

function findActiveTeamWithSameMembers<T extends { members: Array<{ member_id?: number | null; memberId?: number | null }> }>(
  teams: T[],
  memberIds: Set<number>,
): T | undefined {
  return teams.find((team) => sameEntryTeamMemberIdSet(entryTeamAccountMemberIdSet(team.members), memberIds));
}

// --- Registration context integration ---------------------------------------

/**
 * Builds the per-league play-in entry context for a registration draft: whether the
 * registrant is already on a declared entry team, which members are committed to
 * other teams, and whether the registrant's (declared or drafted) team is
 * pessimistically guaranteed auto entry.
 */
export async function loadPlayInEntryContextsForRegistration(input: {
  memberId: number | null;
  priorities: LeaguePriorityInput[];
  leagues: Record<number, LeagueConfig>;
}): Promise<Record<number, PlayInEntryContext>> {
  const result: Record<number, PlayInEntryContext> = {};
  const playInPriorities = input.priorities.filter((priority) => input.leagues[priority.leagueId]?.isPlayInBased);
  for (const priority of playInPriorities) {
    const leagueId = priority.leagueId;
    const summary = await evaluateRegistrantPlayInEntry({
      leagueId,
      memberId: input.memberId,
      teamRosterPlacements: priority.teamRosterPlacements ?? null,
      pendingTeammateText: priority.byotTeammateText ?? null,
    });
    result[leagueId] = {
      onExistingTeam: summary.onExistingTeam,
      existingTeamId: summary.existingTeam?.id ?? null,
      committedOtherMemberIds: summary.committedOtherMemberIds,
      guaranteed: summary.guaranteed,
    };
  }
  return result;
}

export type RegistrantPlayInEntrySummary = {
  leagueId: number;
  autoEntryCount: number;
  playInSpotCount: number;
  teamSize: number;
  onExistingTeam: boolean;
  existingTeam: {
    id: number;
    name: string | null;
    createdByName: string | null;
    members: Array<{
      memberId: number | null;
      memberName: string | null;
      pendingName: string | null;
    }>;
  } | null;
  /** Members (other than the registrant) already committed to another active entry team. */
  committedOtherMemberIds: number[];
  /**
   * For each committed other member, the active entry team they belong to (full roster),
   * so the registration UI can explain conflicts without a second fetch.
   */
  committedOtherMemberTeams: Array<{
    memberId: number;
    team: {
      id: number;
      name: string | null;
      members: Array<{
        memberId: number | null;
        memberName: string | null;
        pendingName: string | null;
      }>;
    };
  }>;
  /** Total points for the registrant's declared/drafted team, when known. */
  teamTotalPoints: number | null;
  /** Whether the team meets the two-returning-members rule. */
  meetsReturningRule: boolean | null;
  guaranteed: boolean;
  /** Minimum team points that would currently guarantee auto entry, when computable. */
  guaranteeThresholdPoints: number | null;
};

/**
 * Evaluates the play-in entry status for a registrant's declared or drafted team.
 * When the registrant is already on a declared team, that team is evaluated;
 * otherwise a hypothetical team is built from the draft roster placements.
 */
export async function evaluateRegistrantPlayInEntry(input: {
  leagueId: number;
  memberId: number | null;
  teamRosterPlacements?: Array<{ memberId: number }> | null;
  pendingTeammateText?: string | null;
}): Promise<RegistrantPlayInEntrySummary> {
  if (input.memberId != null) {
    await releaseStaleEntryTeamLinksForMember({ memberId: input.memberId });
  }
  const league = await loadPlayInLeagueConfig(input.leagueId);
  if (!league) {
    throw new LeagueEntryValidationError({ league: 'League was not found.' });
  }
  requirePlayInBasedLeague(league);
  const config = {
    autoEntryCount: playInAutoEntryCount({
      capacity_type: league.capacityType,
      capacity_value: league.capacityValue,
      play_in_spot_count: league.playInSpotCount,
    }),
    teamSize: playInTeamSize(league.format),
    playInSpotCount: league.playInSpotCount,
  };

  const [pointsRows, teams] = await Promise.all([
    loadLeagueEntryPoints(input.leagueId),
    loadLeagueEntryTeams(input.leagueId),
  ]);
  const memberPoints = aggregateMemberPoints(pointsRows);
  const activeTeams = teams.filter((team) => isActiveEntryTeamStatus(team.status));

  const draftedMemberIds = new Set<number>();
  if (input.memberId != null) draftedMemberIds.add(input.memberId);
  for (const placement of input.teamRosterPlacements ?? []) {
    draftedMemberIds.add(placement.memberId);
  }

  let existingTeam =
    input.memberId != null
      ? activeTeams.find((team) => team.members.some((member) => member.memberId === input.memberId)) ?? null
      : null;
  // Same account-linked roster declared by another teammate (order may differ).
  if (!existingTeam && draftedMemberIds.size > 0) {
    const match = findActiveTeamWithSameMembers(
      activeTeams.map((team) => ({
        team,
        members: team.members.map((member) => ({ memberId: member.memberId })),
      })),
      draftedMemberIds,
    );
    existingTeam = match?.team ?? null;
  }

  const otherActiveTeams = activeTeams.filter((team) => team.id !== existingTeam?.id);
  const committedOtherMemberTeams: RegistrantPlayInEntrySummary['committedOtherMemberTeams'] = [];
  const committedOtherMemberIdSet = new Set<number>();
  for (const team of otherActiveTeams) {
    const roster = team.members.map((member) => ({
      memberId: member.memberId,
      memberName: member.memberName,
      pendingName: member.pendingName,
    }));
    for (const member of team.members) {
      if (member.memberId == null || member.memberId === input.memberId) continue;
      if (committedOtherMemberIdSet.has(member.memberId)) continue;
      committedOtherMemberIdSet.add(member.memberId);
      committedOtherMemberTeams.push({
        memberId: member.memberId,
        team: {
          id: team.id,
          name: team.name,
          members: roster,
        },
      });
    }
  }
  const committedOtherMemberIds = [...committedOtherMemberIdSet];

  const evaluationTeams: PlayInTeamForEvaluation[] = teams.map(entryTeamToEvaluationInput);
  let evaluatedTeam: PlayInEvaluatedTeam | undefined;
  let evaluation: PlayInLeagueEvaluation;
  if (existingTeam) {
    evaluation = evaluatePlayInLeague(config, memberPoints, evaluationTeams);
    evaluatedTeam = evaluation.teams.find((team) => team.entryTeamId === existingTeam.id);
  } else {
    const pendingNames = waitlistRosterEntries(input.pendingTeammateText);
    const hasDraftRoster = draftedMemberIds.size > 0;
    const hypothetical: PlayInTeamForEvaluation | null = hasDraftRoster
      ? {
          entryTeamId: null,
          memberIds: [...draftedMemberIds],
          pendingNameCount: pendingNames.length,
          status: 'pending',
        }
      : null;
    evaluation = evaluatePlayInLeague(
      config,
      memberPoints,
      hypothetical ? [...evaluationTeams, hypothetical] : evaluationTeams
    );
    evaluatedTeam = hypothetical ? evaluation.teams.find((team) => team.entryTeamId === null) : undefined;
  }

  return {
    leagueId: input.leagueId,
    autoEntryCount: config.autoEntryCount,
    playInSpotCount: config.playInSpotCount,
    teamSize: config.teamSize,
    onExistingTeam: Boolean(existingTeam),
    existingTeam: existingTeam
      ? {
          id: existingTeam.id,
          name: existingTeam.name,
          createdByName: await entryTeamCreatorName(existingTeam),
          members: existingTeam.members.map((member) => ({
            memberId: member.memberId,
            memberName: member.memberName,
            pendingName: member.pendingName,
          })),
        }
      : null,
    committedOtherMemberIds,
    committedOtherMemberTeams,
    teamTotalPoints: evaluatedTeam ? pointsHalfToNumber(evaluatedTeam.totalPointsHalf) : null,
    meetsReturningRule: evaluatedTeam ? evaluatedTeam.meetsReturningRule : null,
    guaranteed: evaluatedTeam?.guaranteed ?? false,
    // Prefer the bar this team must beat (excludes the team itself). Fall back to the
    // league-wide threshold when no evaluated team is available yet.
    guaranteeThresholdPoints:
      evaluatedTeam?.guaranteeThresholdHalf != null
        ? pointsHalfToNumber(evaluatedTeam.guaranteeThresholdHalf)
        : evaluation.guaranteeThresholdHalf != null
          ? pointsHalfToNumber(evaluation.guaranteeThresholdHalf)
          : null,
  };
}

async function entryTeamCreatorName(team: LeagueEntryTeamRow): Promise<string | null> {
  if (!team.createdFromRegistrationId) return null;
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({
      name: schema.members.name,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
    })
    .from(schema.curlingRegistrations)
    .innerJoin(schema.members, eq(schema.curlingRegistrations.curler_member_id, schema.members.id))
    .where(eq(schema.curlingRegistrations.id, team.createdFromRegistrationId))
    .limit(1);
  if (!row) return null;
  const fromParts = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
  return fromParts || row.name || null;
}

// --- Submit-time persistence -------------------------------------------------

/**
 * Creates or attaches declared entry teams from a registration's play-in
 * priority entries. The first teammate to register creates the team; later
 * teammates attach to it. Declarations with the same account-linked roster (any
 * order) reuse one entry team instead of creating duplicates.
 */
export async function syncRegistrationEntryTeams(input: {
  tx?: DbExecutor;
  registrationId: number;
  curlerMemberId: number;
  context: RegistrationContext;
  evaluation: LeaguePriorityEvaluation;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;

  const playInPriorities = input.context.priorities.filter(
    (priority) => input.context.leagues[priority.leagueId]?.isPlayInBased,
  );
  const keepLeagueIds = new Set(playInPriorities.map((priority) => priority.leagueId));

  await removeEntryTeamLinksForRegistration({
    tx: executor,
    registrationId: input.registrationId,
    curlerMemberId: input.curlerMemberId,
    keepLeagueIds: [...keepLeagueIds],
  });

  for (const priority of playInPriorities) {
    const leagueId = priority.leagueId;
    const teams = await loadEntryTeamsForLeague(executor, leagueId);
    const activeTeams = teams.filter((team) => isActiveEntryTeamStatus(team.status));

    const placements = (priority.teamRosterPlacements ?? []).filter(
      (placement) => placement.memberId !== input.curlerMemberId
    );
    const pendingNames = waitlistRosterEntries(priority.byotTeammateText);
    const draftMemberIds = entryTeamAccountMemberIdSet([
      { member_id: input.curlerMemberId },
      ...placements.map((placement) => ({ member_id: placement.memberId })),
    ]);

    const existingByMembership = activeTeams.find((team) =>
      team.members.some((member) => member.member_id === input.curlerMemberId)
    );
    const existingBySameRoster = findActiveTeamWithSameMembers(activeTeams, draftMemberIds);
    const existing = existingByMembership ?? existingBySameRoster;

    if (existing) {
      await attachCurlerToEntryTeam({
        executor,
        teamId: existing.id,
        members: existing.members,
        curlerMemberId: input.curlerMemberId,
        registrationId: input.registrationId,
      });
      const leagueConfig = input.context.leagues[leagueId];
      await extendEntryTeamRoster({
        executor,
        teamId: existing.id,
        existingMembers: existing.members,
        teamSize: playInTeamSize(leagueConfig?.format ?? 'teams'),
        placements,
        pendingNames,
      });
      continue;
    }

    const committed = new Set(
      activeTeams.flatMap((team) =>
        team.members.map((member) => member.member_id).filter((id): id is number => id != null)
      )
    );
    const conflicting = placements.filter((placement) => committed.has(placement.memberId));
    if (conflicting.length > 0) {
      // Teammates already declared the same roster under another curler — join that team.
      const overlappingTeams = activeTeams.filter((team) =>
        team.members.some(
          (member) => member.member_id != null && draftMemberIds.has(member.member_id),
        ),
      );
      const sameRosterTeam = findActiveTeamWithSameMembers(overlappingTeams, draftMemberIds);
      if (sameRosterTeam) {
        await attachCurlerToEntryTeam({
          executor,
          teamId: sameRosterTeam.id,
          members: sameRosterTeam.members,
          curlerMemberId: input.curlerMemberId,
          registrationId: input.registrationId,
        });
        const leagueConfig = input.context.leagues[leagueId];
        await extendEntryTeamRoster({
          executor,
          teamId: sameRosterTeam.id,
          existingMembers: sameRosterTeam.members,
          teamSize: playInTeamSize(leagueConfig?.format ?? 'teams'),
          placements,
          pendingNames,
        });
        continue;
      }
      // Incomplete team that is a subset of this draft: join and add the new members.
      const extendableTeam = findIncompleteEntryTeamCoveredByDraft({
        teams: overlappingTeams,
        draftMemberIds,
        teamSize: playInTeamSize(input.context.leagues[leagueId]?.format ?? 'teams'),
      });
      if (extendableTeam) {
        await attachCurlerToEntryTeam({
          executor,
          teamId: extendableTeam.id,
          members: extendableTeam.members,
          curlerMemberId: input.curlerMemberId,
          registrationId: input.registrationId,
        });
        await extendEntryTeamRoster({
          executor,
          teamId: extendableTeam.id,
          existingMembers: extendableTeam.members,
          teamSize: playInTeamSize(input.context.leagues[leagueId]?.format ?? 'teams'),
          placements,
          pendingNames,
        });
        continue;
      }
      throw new LeagueEntryValidationError({
        teamRosterPlacements:
          'One or more selected teammates are already on a declared team for this league. Contact membership@trianglecurling.com to sort out team assignments.',
      });
    }

    const [team] = await executor
      .insert(schema.leagueEntryTeams)
      .values({
        league_id: leagueId,
        status: 'pending',
        created_from_registration_id: input.registrationId,
      })
      .returning();

    await executor.insert(schema.leagueEntryTeamMembers).values([
      {
        entry_team_id: team.id,
        member_id: input.curlerMemberId,
        source_registration_id: input.registrationId,
      },
      ...placements.map((placement) => ({
        entry_team_id: team.id,
        member_id: placement.memberId,
      })),
      ...pendingNames.map((pendingName) => ({
        entry_team_id: team.id,
        pending_name: pendingName,
      })),
    ]);

    // Parallel submits can both insert; keep the oldest team with this roster.
    await mergeDuplicateEntryTeamIfNeeded({
      executor,
      leagueId,
      newTeamId: team.id,
      memberIds: draftMemberIds,
      curlerMemberId: input.curlerMemberId,
      registrationId: input.registrationId,
    });
  }
}

function findIncompleteEntryTeamCoveredByDraft(input: {
  teams: Array<{
    id: number;
    members: Array<{ id: number; member_id: number | null; pending_name?: string | null; source_registration_id: number | null }>;
  }>;
  draftMemberIds: Set<number>;
  teamSize: number;
}): (typeof input.teams)[number] | null {
  const candidates = input.teams.filter((team) => {
    if (team.members.length >= input.teamSize) return false;
    const accountIds = team.members
      .map((member) => member.member_id)
      .filter((id): id is number => id != null);
    if (accountIds.length === 0) return false;
    return accountIds.every((memberId) => input.draftMemberIds.has(memberId));
  });
  if (candidates.length === 0) return null;
  // Prefer the largest incomplete overlap so we extend the most complete declaration.
  return [...candidates].sort((left, right) => right.members.length - left.members.length)[0] ?? null;
}

/**
 * Adds newly declared account members and pending names onto an incomplete entry team.
 * Existing members are never removed here — later registrants can only grow the roster.
 */
async function extendEntryTeamRoster(input: {
  executor: DbExecutor;
  teamId: number;
  existingMembers: Array<{ member_id?: number | null; memberId?: number | null; pending_name?: string | null; pendingName?: string | null }>;
  teamSize: number;
  placements: Array<{ memberId: number }>;
  pendingNames: string[];
}): Promise<void> {
  const { schema } = getDrizzleDb();
  const existingMemberIds = new Set(
    input.existingMembers
      .map((member) => member.member_id ?? member.memberId)
      .filter((id): id is number => id != null),
  );
  const existingPending = new Set(
    input.existingMembers
      .map((member) => (member.pending_name ?? member.pendingName ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  let openSlots = Math.max(0, input.teamSize - input.existingMembers.length);
  if (openSlots === 0) return;

  const membersToAdd = input.placements.filter((placement) => !existingMemberIds.has(placement.memberId));
  for (const placement of membersToAdd) {
    if (openSlots <= 0) break;
    await input.executor.insert(schema.leagueEntryTeamMembers).values({
      entry_team_id: input.teamId,
      member_id: placement.memberId,
    });
    openSlots -= 1;
  }

  for (const pendingName of input.pendingNames) {
    if (openSlots <= 0) break;
    const normalized = pendingName.trim().toLowerCase();
    if (!normalized || existingPending.has(normalized)) continue;
    await input.executor.insert(schema.leagueEntryTeamMembers).values({
      entry_team_id: input.teamId,
      pending_name: pendingName.trim(),
    });
    existingPending.add(normalized);
    openSlots -= 1;
  }
}

async function attachCurlerToEntryTeam(input: {
  executor: DbExecutor;
  teamId: number;
  members: Array<{ id: number; member_id: number | null; source_registration_id: number | null }>;
  curlerMemberId: number;
  registrationId: number;
}): Promise<void> {
  const { schema } = getDrizzleDb();
  const memberRow = input.members.find((member) => member.member_id === input.curlerMemberId);
  if (memberRow) {
    await input.executor
      .update(schema.leagueEntryTeamMembers)
      .set({
        source_registration_id: input.registrationId,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.leagueEntryTeamMembers.id, memberRow.id));
    return;
  }
  await input.executor.insert(schema.leagueEntryTeamMembers).values({
    entry_team_id: input.teamId,
    member_id: input.curlerMemberId,
    source_registration_id: input.registrationId,
  });
}

async function mergeDuplicateEntryTeamIfNeeded(input: {
  executor: DbExecutor;
  leagueId: number;
  newTeamId: number;
  memberIds: Set<number>;
  curlerMemberId: number;
  registrationId: number;
}): Promise<void> {
  const { schema } = getDrizzleDb();
  const teams = await loadEntryTeamsForLeague(input.executor, input.leagueId);
  const activeTeams = teams.filter(
    (team) => team.id !== input.newTeamId && isActiveEntryTeamStatus(team.status),
  );
  const older = findActiveTeamWithSameMembers(activeTeams, input.memberIds);
  if (!older) return;

  await attachCurlerToEntryTeam({
    executor: input.executor,
    teamId: older.id,
    members: older.members,
    curlerMemberId: input.curlerMemberId,
    registrationId: input.registrationId,
  });
  await input.executor.delete(schema.leagueEntryTeams).where(eq(schema.leagueEntryTeams.id, input.newTeamId));
}

/**
 * Removes a member from a declared entry team. If the team is still in the
 * declaration pipeline and no other teammate has a live (non-canceled) source
 * registration, the whole declaration is deleted so canceled registrations do
 * not leave phantom teams behind.
 */
async function releaseEntryTeamMembership(input: {
  executor: DbExecutor;
  memberRowId: number;
  teamId: number;
  teamStatus: LeagueEntryTeamStatusSqlite;
}): Promise<void> {
  const { schema } = getDrizzleDb();
  const { executor } = input;

  await executor.delete(schema.leagueEntryTeamMembers).where(eq(schema.leagueEntryTeamMembers.id, input.memberRowId));

  if (!isMutableEntryTeamStatus(input.teamStatus)) {
    return;
  }

  const remaining = await executor
    .select({
      id: schema.leagueEntryTeamMembers.id,
      sourceRegistrationId: schema.leagueEntryTeamMembers.source_registration_id,
      registrationStatus: schema.curlingRegistrations.status,
    })
    .from(schema.leagueEntryTeamMembers)
    .leftJoin(
      schema.curlingRegistrations,
      eq(schema.leagueEntryTeamMembers.source_registration_id, schema.curlingRegistrations.id),
    )
    .where(eq(schema.leagueEntryTeamMembers.entry_team_id, input.teamId));

  const otherLiveRegistered = remaining.some(
    (teammate) =>
      teammate.sourceRegistrationId != null &&
      teammate.registrationStatus != null &&
      teammate.registrationStatus !== 'cancelled',
  );

  if (!otherLiveRegistered) {
    await executor.delete(schema.leagueEntryTeams).where(eq(schema.leagueEntryTeams.id, input.teamId));
  }
}

async function deleteOrphanEntryTeamsCreatedByRegistration(input: {
  executor: DbExecutor;
  registrationId: number;
}): Promise<void> {
  const { schema } = getDrizzleDb();
  const orphanTeams = await input.executor
    .select({
      teamId: schema.leagueEntryTeams.id,
      teamStatus: schema.leagueEntryTeams.status,
    })
    .from(schema.leagueEntryTeams)
    .where(eq(schema.leagueEntryTeams.created_from_registration_id, input.registrationId));

  for (const team of orphanTeams) {
    if (!isMutableEntryTeamStatus(team.teamStatus)) continue;
    const members = await input.executor
      .select({
        sourceRegistrationId: schema.leagueEntryTeamMembers.source_registration_id,
        registrationStatus: schema.curlingRegistrations.status,
      })
      .from(schema.leagueEntryTeamMembers)
      .leftJoin(
        schema.curlingRegistrations,
        eq(schema.leagueEntryTeamMembers.source_registration_id, schema.curlingRegistrations.id),
      )
      .where(eq(schema.leagueEntryTeamMembers.entry_team_id, team.teamId));
    const hasLiveRegistrant = members.some(
      (member) =>
        member.sourceRegistrationId != null &&
        member.registrationStatus != null &&
        member.registrationStatus !== 'cancelled',
    );
    if (!hasLiveRegistrant) {
      await input.executor.delete(schema.leagueEntryTeams).where(eq(schema.leagueEntryTeams.id, team.teamId));
    }
  }
}

/**
 * Clears the registration's links to declared entry teams for leagues no longer
 * selected. Teams with no remaining live registered teammates are deleted.
 */
export async function removeEntryTeamLinksForRegistration(input: {
  tx?: DbExecutor;
  registrationId: number;
  curlerMemberId: number;
  keepLeagueIds?: number[];
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const keep = new Set(input.keepLeagueIds ?? []);

  const linkedRows = await executor
    .select({
      memberRowId: schema.leagueEntryTeamMembers.id,
      teamId: schema.leagueEntryTeams.id,
      leagueId: schema.leagueEntryTeams.league_id,
      teamStatus: schema.leagueEntryTeams.status,
    })
    .from(schema.leagueEntryTeamMembers)
    .innerJoin(schema.leagueEntryTeams, eq(schema.leagueEntryTeamMembers.entry_team_id, schema.leagueEntryTeams.id))
    .where(
      and(
        eq(schema.leagueEntryTeamMembers.member_id, input.curlerMemberId),
        eq(schema.leagueEntryTeamMembers.source_registration_id, input.registrationId),
      ),
    );

  for (const row of linkedRows) {
    if (keep.has(row.leagueId)) continue;
    await releaseEntryTeamMembership({
      executor,
      memberRowId: row.memberRowId,
      teamId: row.teamId,
      teamStatus: row.teamStatus,
    });
  }
}

/**
 * On registration cancel: detach the curler from any play-in entry teams tied to
 * this registration (and delete teams that nobody else has registered onto).
 */
export async function releaseEntryTeamsForCancelledRegistration(input: {
  tx?: DbExecutor;
  registrationId: number;
  curlerMemberId: number;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;

  const linkedRows = await executor
    .select({
      memberRowId: schema.leagueEntryTeamMembers.id,
      teamId: schema.leagueEntryTeams.id,
      teamStatus: schema.leagueEntryTeams.status,
    })
    .from(schema.leagueEntryTeamMembers)
    .innerJoin(schema.leagueEntryTeams, eq(schema.leagueEntryTeamMembers.entry_team_id, schema.leagueEntryTeams.id))
    .where(
      and(
        eq(schema.leagueEntryTeamMembers.member_id, input.curlerMemberId),
        eq(schema.leagueEntryTeamMembers.source_registration_id, input.registrationId),
      ),
    );

  for (const row of linkedRows) {
    await releaseEntryTeamMembership({
      executor,
      memberRowId: row.memberRowId,
      teamId: row.teamId,
      teamStatus: row.teamStatus,
    });
  }

  await deleteOrphanEntryTeamsCreatedByRegistration({
    executor,
    registrationId: input.registrationId,
  });
}

/**
 * Self-heal: drop entry-team memberships whose source registration was canceled
 * so re-registration does not show a phantom "already on a team" notice.
 */
export async function releaseStaleEntryTeamLinksForMember(input: {
  tx?: DbExecutor;
  memberId: number;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;

  const staleRows = await executor
    .select({
      memberRowId: schema.leagueEntryTeamMembers.id,
      teamId: schema.leagueEntryTeams.id,
      teamStatus: schema.leagueEntryTeams.status,
      registrationId: schema.leagueEntryTeamMembers.source_registration_id,
    })
    .from(schema.leagueEntryTeamMembers)
    .innerJoin(schema.leagueEntryTeams, eq(schema.leagueEntryTeamMembers.entry_team_id, schema.leagueEntryTeams.id))
    .innerJoin(
      schema.curlingRegistrations,
      eq(schema.leagueEntryTeamMembers.source_registration_id, schema.curlingRegistrations.id),
    )
    .where(
      and(
        eq(schema.leagueEntryTeamMembers.member_id, input.memberId),
        eq(schema.curlingRegistrations.status, 'cancelled'),
        inArray(schema.leagueEntryTeams.status, MUTABLE_ENTRY_TEAM_STATUSES),
      ),
    );

  const touchedRegistrationIds = new Set<number>();
  for (const row of staleRows) {
    await releaseEntryTeamMembership({
      executor,
      memberRowId: row.memberRowId,
      teamId: row.teamId,
      teamStatus: row.teamStatus,
    });
    if (row.registrationId != null) touchedRegistrationIds.add(row.registrationId);
  }
  for (const registrationId of touchedRegistrationIds) {
    await deleteOrphanEntryTeamsCreatedByRegistration({ executor, registrationId });
  }
}

async function loadEntryTeamsForLeague(
  executor: DbExecutor,
  leagueId: number
): Promise<
  Array<{
    id: number;
    status: LeagueEntryTeamStatusSqlite;
    created_from_registration_id: number | null;
    members: Array<{
      id: number;
      member_id: number | null;
      pending_name: string | null;
      source_registration_id: number | null;
    }>;
  }>
> {
  const { schema } = getDrizzleDb();
  const teams = await executor
    .select()
    .from(schema.leagueEntryTeams)
    .where(eq(schema.leagueEntryTeams.league_id, leagueId));
  if (teams.length === 0) return [];
  const members = await executor
    .select()
    .from(schema.leagueEntryTeamMembers)
    .where(inArray(schema.leagueEntryTeamMembers.entry_team_id, teams.map((team: { id: number }) => team.id)));
  return teams.map((team: (typeof teams)[number]) => ({
    id: team.id,
    status: team.status,
    created_from_registration_id: team.created_from_registration_id,
    members: members
      .filter((member: (typeof members)[number]) => member.entry_team_id === team.id)
      .map((member: (typeof members)[number]) => ({
        id: member.id,
        member_id: member.member_id,
        pending_name: member.pending_name,
        source_registration_id: member.source_registration_id,
      })),
  }));
}

// --- Staff report -------------------------------------------------------------

function jsonSafeNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function jsonSafeNumberOrNull(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function positiveIntIds(values: Array<number | null | undefined>): number[] {
  const ids = new Set<number>();
  for (const value of values) {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/**
 * Priority ranks for declared entry-team members who registered through the
 * league-priority model. Isolated so a missing table or query failure cannot
 * 500 the play-in entry tab — the overhaul stores ranks in
 * `registration_league_priorities`, which is created by bootstrap rather than a
 * numbered drizzle migration.
 */
async function loadPlayInPriorityRanksByRegistrationId(
  leagueId: number,
  sourceRegistrationIds: Array<number | null | undefined>,
): Promise<Map<number, number>> {
  const ranks = new Map<number, number>();
  const registrationIds = positiveIntIds(sourceRegistrationIds);
  if (registrationIds.length === 0) return ranks;
  try {
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select({
        registrationId: schema.registrationLeaguePriorities.registration_id,
        priorityRank: schema.registrationLeaguePriorities.priority_rank,
      })
      .from(schema.registrationLeaguePriorities)
      .where(
        and(
          inArray(schema.registrationLeaguePriorities.registration_id, registrationIds),
          eq(schema.registrationLeaguePriorities.league_id, leagueId),
        ),
      );
    const list = Array.isArray(rows) ? rows : [];
    for (const row of list) {
      const registrationId = Number(row.registrationId);
      const priorityRank = Number(row.priorityRank);
      if (Number.isInteger(registrationId) && Number.isInteger(priorityRank)) {
        ranks.set(registrationId, priorityRank);
      }
    }
  } catch (error) {
    console.error('Failed to load play-in entry priority ranks', error);
  }
  return ranks;
}

export type LeagueEntryReport = {
  league: {
    id: number;
    name: string;
    isPlayInBased: boolean;
    capacityValue: number;
    capacityType: string;
    playInSpotCount: number;
    autoEntryCount: number;
    teamSize: number;
  };
  summary: {
    guaranteeThresholdPoints: number | null;
    returningRuleWaiverActive: boolean;
    activeTeamCount: number;
    guaranteedTeamCount: number;
    projectedInTeamCount: number;
    projectedPlaydownTeamCount: number;
    ineligibleTeamCount: number;
    enteredTeamCount: number;
  };
  points: Array<{
    id: number;
    memberId: number;
    memberName: string;
    points: number;
    countsAsReturning: boolean;
    source: 'manual' | 'standings' | 'playdown';
    notes: string | null;
  }>;
  teams: Array<{
    id: number;
    name: string | null;
    status: LeagueEntryTeamStatusSqlite;
    projectedStatus: PlayInEvaluatedTeam['projectedStatus'];
    totalPoints: number;
    returningMemberCount: number;
    meetsReturningRule: boolean;
    guaranteed: boolean;
    notes: string | null;
    members: Array<{
      id: number;
      memberId: number | null;
      memberName: string | null;
      pendingName: string | null;
      /** Where this league sits on the member's priority list, when they registered for it. */
      priorityRank: number | null;
      points: number;
      countsAsReturning: boolean;
      registered: boolean;
    }>;
  }>;
};

export async function getLeagueEntryReport(leagueId: number): Promise<LeagueEntryReport> {
  const league = await loadPlayInLeagueConfig(leagueId);
  if (!league) {
    throw new LeagueEntryValidationError({ league: 'League was not found.' });
  }
  const [pointsRows, teams] = await Promise.all([loadLeagueEntryPoints(leagueId), loadLeagueEntryTeams(leagueId)]);
  const memberPoints = aggregateMemberPoints(pointsRows);
  const memberPointsById = new Map(memberPoints.map((entry) => [entry.memberId, entry]));
  const config = {
    autoEntryCount: playInAutoEntryCount({
      capacity_type: league.capacityType,
      capacity_value: league.capacityValue,
      play_in_spot_count: league.playInSpotCount,
    }),
    teamSize: playInTeamSize(league.format),
    playInSpotCount: league.playInSpotCount,
  };
  const evaluation = evaluatePlayInLeague(config, memberPoints, teams.map(entryTeamToEvaluationInput));
  const evaluatedById = new Map(
    evaluation.teams
      .filter((team) => team.entryTeamId != null)
      .map((team) => [team.entryTeamId as number, team])
  );

  const priorityRankByRegistrationId = await loadPlayInPriorityRanksByRegistrationId(
    leagueId,
    teams.flatMap((team) => team.members.map((member) => member.sourceRegistrationId)),
  );

  const reportTeams = teams.map((team) => {
    const evaluated = evaluatedById.get(team.id);
    return {
      id: team.id,
      name: team.name,
      status: team.status,
      projectedStatus: evaluated?.projectedStatus ?? 'projected_playdown',
      totalPoints: evaluated ? jsonSafeNumber(pointsHalfToNumber(evaluated.totalPointsHalf)) : 0,
      returningMemberCount: evaluated?.returningMemberCount ?? 0,
      meetsReturningRule: evaluated?.meetsReturningRule ?? false,
      guaranteed: evaluated?.guaranteed ?? false,
      notes: team.notes,
      members: team.members.map((member) => {
        const points = member.memberId != null ? memberPointsById.get(member.memberId) : undefined;
        return {
          id: member.id,
          memberId: member.memberId,
          memberName: member.memberName,
          pendingName: member.pendingName,
          priorityRank:
            member.sourceRegistrationId != null
              ? priorityRankByRegistrationId.get(member.sourceRegistrationId) ?? null
              : null,
          points: points ? jsonSafeNumber(pointsHalfToNumber(points.pointsHalf)) : 0,
          countsAsReturning: points?.countsAsReturning ?? false,
          registered: member.sourceRegistrationId != null,
        };
      }),
    };
  });

  const activeReportTeams = reportTeams.filter((team) => isActiveEntryTeamStatus(team.status));

  return {
    league: {
      id: league.id,
      name: league.name,
      isPlayInBased: league.isPlayInBased,
      capacityValue: league.capacityValue,
      capacityType: league.capacityType,
      playInSpotCount: jsonSafeNumber(league.playInSpotCount),
      autoEntryCount: jsonSafeNumber(config.autoEntryCount),
      teamSize: config.teamSize,
    },
    summary: {
      guaranteeThresholdPoints: jsonSafeNumberOrNull(
        evaluation.guaranteeThresholdHalf != null ? pointsHalfToNumber(evaluation.guaranteeThresholdHalf) : null,
      ),
      returningRuleWaiverActive: evaluation.returningRuleWaiverActive,
      activeTeamCount: activeReportTeams.length,
      guaranteedTeamCount: activeReportTeams.filter((team) => team.projectedStatus === 'guaranteed').length,
      projectedInTeamCount: activeReportTeams.filter((team) => team.projectedStatus === 'projected_in').length,
      projectedPlaydownTeamCount: activeReportTeams.filter((team) => team.projectedStatus === 'projected_playdown')
        .length,
      ineligibleTeamCount: activeReportTeams.filter((team) => team.projectedStatus === 'ineligible_single_returner')
        .length,
      enteredTeamCount: reportTeams.filter((team) => team.status === 'entered').length,
    },
    points: pointsRows
      .map((row) => ({
        id: row.id,
        memberId: row.memberId,
        memberName: row.memberName,
        points: jsonSafeNumber(pointsHalfToNumber(row.pointsHalf)),
        countsAsReturning: row.countsAsReturning,
        source: row.source,
        notes: row.notes,
      }))
      .sort(
        (left, right) =>
          right.points - left.points || String(left.memberName ?? '').localeCompare(String(right.memberName ?? '')),
      ),
    teams: reportTeams.sort((left, right) => right.totalPoints - left.totalPoints),
  };
}

// --- Points management ---------------------------------------------------------

function validatePointsValue(points: number): number {
  if (!Number.isFinite(points) || points < 0 || points > 1000) {
    throw new LeagueEntryValidationError({ points: 'Points must be a number between 0 and 1000.' });
  }
  const half = numberToPointsHalf(points);
  if (Math.abs(half - points * 2) > 1e-9) {
    throw new LeagueEntryValidationError({ points: 'Points must be a whole or half number (e.g. 19 or 19.5).' });
  }
  return half;
}

/** Creates or updates the manual TLINE points ledger row for a member. */
export async function saveManualLeagueEntryPoints(input: {
  leagueId: number;
  memberId: number;
  points: number;
  countsAsReturning: boolean;
  notes?: string | null;
  actorMemberId: number;
}): Promise<{ id: number }> {
  const { db, schema } = getDrizzleDb();
  const league = await loadPlayInLeagueConfig(input.leagueId);
  if (!league) {
    throw new LeagueEntryValidationError({ league: 'League was not found.' });
  }
  const [member] = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.id, input.memberId))
    .limit(1);
  if (!member) {
    throw new LeagueEntryValidationError({ member: 'Member was not found.' });
  }
  const pointsHalf = validatePointsValue(input.points);

  const [existing] = await db
    .select({ id: schema.leagueEntryPoints.id })
    .from(schema.leagueEntryPoints)
    .where(
      and(
        eq(schema.leagueEntryPoints.league_id, input.leagueId),
        eq(schema.leagueEntryPoints.member_id, input.memberId),
        eq(schema.leagueEntryPoints.source, 'manual')
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.leagueEntryPoints)
      .set({
        points_half: pointsHalf,
        counts_as_returning: input.countsAsReturning ? 1 : 0,
        notes: input.notes ?? null,
        created_by_member_id: input.actorMemberId,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.leagueEntryPoints.id, existing.id));
    return { id: existing.id };
  }

  const [inserted] = await db
    .insert(schema.leagueEntryPoints)
    .values({
      league_id: input.leagueId,
      member_id: input.memberId,
      points_half: pointsHalf,
      counts_as_returning: input.countsAsReturning ? 1 : 0,
      source: 'manual',
      notes: input.notes ?? null,
      created_by_member_id: input.actorMemberId,
    })
    .returning({ id: schema.leagueEntryPoints.id });
  return { id: inserted.id };
}

export async function deleteLeagueEntryPointsRow(input: { leagueId: number; pointsId: number }): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [existing] = await db
    .select({ id: schema.leagueEntryPoints.id })
    .from(schema.leagueEntryPoints)
    .where(
      and(eq(schema.leagueEntryPoints.id, input.pointsId), eq(schema.leagueEntryPoints.league_id, input.leagueId))
    )
    .limit(1);
  if (!existing) {
    throw new LeagueEntryValidationError({ points: 'Points entry was not found.' });
  }
  await db.delete(schema.leagueEntryPoints).where(eq(schema.leagueEntryPoints.id, input.pointsId));
}

// --- Staff team management ------------------------------------------------------

export type EntryTeamMemberInput = {
  memberId?: number | null;
  pendingName?: string | null;
};

function normalizeEntryTeamMemberInputs(members: EntryTeamMemberInput[], teamSize: number) {
  const normalized = members.map((member) => {
    const memberId = member.memberId ?? null;
    const pendingName = member.pendingName?.trim() || null;
    if ((memberId == null) === (pendingName == null)) {
      throw new LeagueEntryValidationError({
        members: 'Each teammate must be either a member or a pending name (not both).',
      });
    }
    return { memberId, pendingName };
  });
  if (normalized.length === 0 || normalized.length > teamSize) {
    throw new LeagueEntryValidationError({ members: `Teams must have between 1 and ${teamSize} players.` });
  }
  const memberIds = normalized.map((member) => member.memberId).filter((id): id is number => id != null);
  if (new Set(memberIds).size !== memberIds.length) {
    throw new LeagueEntryValidationError({ members: 'Each member may appear only once on the team.' });
  }
  return normalized;
}

async function assertMembersNotCommittedElsewhere(input: {
  leagueId: number;
  memberIds: number[];
  excludeTeamId?: number;
}): Promise<void> {
  if (input.memberIds.length === 0) return;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      memberId: schema.leagueEntryTeamMembers.member_id,
      teamId: schema.leagueEntryTeams.id,
      status: schema.leagueEntryTeams.status,
    })
    .from(schema.leagueEntryTeamMembers)
    .innerJoin(schema.leagueEntryTeams, eq(schema.leagueEntryTeamMembers.entry_team_id, schema.leagueEntryTeams.id))
    .where(
      and(
        eq(schema.leagueEntryTeams.league_id, input.leagueId),
        inArray(schema.leagueEntryTeamMembers.member_id, input.memberIds)
      )
    );
  const conflict = rows.find(
    (row) =>
      row.teamId !== input.excludeTeamId && isActiveEntryTeamStatus(row.status) && row.memberId != null
  );
  if (conflict) {
    throw new LeagueEntryValidationError({
      members: 'One or more members are already on another declared team for this league.',
    });
  }
}

export async function createLeagueEntryTeamStaff(input: {
  leagueId: number;
  name?: string | null;
  notes?: string | null;
  members: EntryTeamMemberInput[];
  actorMemberId: number;
}): Promise<{ id: number }> {
  const { db, schema } = getDrizzleDb();
  const league = await loadPlayInLeagueConfig(input.leagueId);
  if (!league) {
    throw new LeagueEntryValidationError({ league: 'League was not found.' });
  }
  const teamSize = playInTeamSize(league.format);
  const normalized = normalizeEntryTeamMemberInputs(input.members, teamSize);
  await assertMembersNotCommittedElsewhere({
    leagueId: input.leagueId,
    memberIds: normalized.map((member) => member.memberId).filter((id): id is number => id != null),
  });

  const [team] = await db
    .insert(schema.leagueEntryTeams)
    .values({
      league_id: input.leagueId,
      name: input.name?.trim() || null,
      notes: input.notes?.trim() || null,
      status: 'pending',
    })
    .returning({ id: schema.leagueEntryTeams.id });

  await db.insert(schema.leagueEntryTeamMembers).values(
    normalized.map((member) => ({
      entry_team_id: team.id,
      member_id: member.memberId,
      pending_name: member.pendingName,
    }))
  );
  return { id: team.id };
}

async function loadEntryTeamOrThrow(teamId: number, expectedLeagueId?: number) {
  const { db, schema } = getDrizzleDb();
  const [team] = await db
    .select()
    .from(schema.leagueEntryTeams)
    .where(eq(schema.leagueEntryTeams.id, teamId))
    .limit(1);
  if (!team || (expectedLeagueId != null && team.league_id !== expectedLeagueId)) {
    throw new LeagueEntryValidationError({ team: 'Entry team was not found.' });
  }
  return team;
}

export async function updateLeagueEntryTeamStaff(input: {
  teamId: number;
  leagueId?: number;
  name?: string | null;
  notes?: string | null;
  status?: LeagueEntryTeamStatusSqlite;
  members?: EntryTeamMemberInput[];
  actorMemberId: number;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const team = await loadEntryTeamOrThrow(input.teamId, input.leagueId);
  const league = await loadPlayInLeagueConfig(team.league_id);
  if (!league) {
    throw new LeagueEntryValidationError({ league: 'League was not found.' });
  }

  if (input.status && !['pending', 'withdrawn'].includes(input.status)) {
    throw new LeagueEntryValidationError({
      status: 'Team status can only be set to pending or withdrawn here; use Grant entry for placement.',
    });
  }
  if (input.status === 'pending' && team.status !== 'withdrawn' && team.status !== 'not_entered' && team.status !== 'pending') {
    throw new LeagueEntryValidationError({
      status: 'Only withdrawn teams can be reinstated to pending.',
    });
  }

  const previousStatus = team.status;
  const updates: Record<string, unknown> = { updated_at: sql`CURRENT_TIMESTAMP` };
  if (input.name !== undefined) updates.name = input.name?.trim() || null;
  if (input.notes !== undefined) updates.notes = input.notes?.trim() || null;
  if (input.status !== undefined) updates.status = input.status;
  await db.update(schema.leagueEntryTeams).set(updates).where(eq(schema.leagueEntryTeams.id, input.teamId));

  if (input.members) {
    const teamSize = playInTeamSize(league.format);
    const normalized = normalizeEntryTeamMemberInputs(input.members, teamSize);
    await assertMembersNotCommittedElsewhere({
      leagueId: team.league_id,
      memberIds: normalized.map((member) => member.memberId).filter((id): id is number => id != null),
      excludeTeamId: input.teamId,
    });
    // Preserve registration links for members who remain on the team.
    const existingMembers = await db
      .select()
      .from(schema.leagueEntryTeamMembers)
      .where(eq(schema.leagueEntryTeamMembers.entry_team_id, input.teamId));
    const registrationByMemberId = new Map(
      existingMembers
        .filter((member) => member.member_id != null && member.source_registration_id != null)
        .map((member) => [member.member_id as number, member.source_registration_id as number])
    );
    await db
      .delete(schema.leagueEntryTeamMembers)
      .where(eq(schema.leagueEntryTeamMembers.entry_team_id, input.teamId));
    await db.insert(schema.leagueEntryTeamMembers).values(
      normalized.map((member) => ({
        entry_team_id: input.teamId,
        member_id: member.memberId,
        pending_name: member.pendingName,
        source_registration_id: member.memberId != null ? registrationByMemberId.get(member.memberId) ?? null : null,
      }))
    );
  }

  // Withdraw covers both "pulled out" and "did not get a spot": release billing for the play-in league.
  if (input.status === 'withdrawn' && previousStatus !== 'withdrawn') {
    if (previousStatus === 'entered') {
      await reverseGrantedEntryPlacements({
        entryTeamId: input.teamId,
        leagueId: team.league_id,
      });
    }
    await settlePaymentsForEntryTeam({
      teamId: input.teamId,
      actorMemberId: input.actorMemberId,
      triggerDeferredPayments: true,
    });
  }
}

/**
 * Undoes Grant entry side effects: removes play_in roster rows and deletes a
 * matching Teams-tab league team when the entry declaration is withdrawn.
 */
async function reverseGrantedEntryPlacements(input: {
  entryTeamId: number;
  leagueId: number;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const members = await db
    .select({ memberId: schema.leagueEntryTeamMembers.member_id })
    .from(schema.leagueEntryTeamMembers)
    .where(eq(schema.leagueEntryTeamMembers.entry_team_id, input.entryTeamId));
  const memberIds = members
    .map((member) => member.memberId)
    .filter((memberId): memberId is number => memberId != null);
  if (memberIds.length === 0) return;

  await db
    .update(schema.leagueRoster)
    .set({ status: 'removed', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(schema.leagueRoster.league_id, input.leagueId),
        inArray(schema.leagueRoster.member_id, memberIds),
        eq(schema.leagueRoster.placement_type, 'play_in'),
        eq(schema.leagueRoster.status, 'active'),
      ),
    );

  const leagueTeams = await db
    .select({ id: schema.leagueTeams.id })
    .from(schema.leagueTeams)
    .where(eq(schema.leagueTeams.league_id, input.leagueId));
  if (leagueTeams.length === 0) return;

  const teamMemberRows = await db
    .select({
      teamId: schema.teamMembers.team_id,
      memberId: schema.teamMembers.member_id,
    })
    .from(schema.teamMembers)
    .where(inArray(schema.teamMembers.team_id, leagueTeams.map((row) => row.id)));

  const membersByTeam = new Map<number, Set<number>>();
  for (const row of teamMemberRows) {
    const set = membersByTeam.get(row.teamId) ?? new Set<number>();
    set.add(row.memberId);
    membersByTeam.set(row.teamId, set);
  }

  const entryMemberSet = new Set(memberIds);
  for (const [teamId, teamMembers] of membersByTeam) {
    if (!sameEntryTeamMemberIdSet(teamMembers, entryMemberSet)) continue;
    await db.delete(schema.leagueTeams).where(eq(schema.leagueTeams.id, teamId));
  }
}

/**
 * A play-in outcome settles what the team's members owe. The priority list is
 * unchanged by the outcome, so only deferred payment needs to move.
 */
async function settlePaymentsForEntryTeam(input: {
  teamId: number;
  actorMemberId: number;
  triggerDeferredPayments: boolean;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const members = await db
    .select({ sourceRegistrationId: schema.leagueEntryTeamMembers.source_registration_id })
    .from(schema.leagueEntryTeamMembers)
    .where(eq(schema.leagueEntryTeamMembers.entry_team_id, input.teamId));
  const registrationIds = [
    ...new Set(
      members
        .map((member) => member.sourceRegistrationId)
        .filter((registrationId): registrationId is number => registrationId != null),
    ),
  ];
  if (registrationIds.length === 0) return;

  if (!input.triggerDeferredPayments) return;

  const registrations = await db
    .select({ id: schema.curlingRegistrations.id, status: schema.curlingRegistrations.status })
    .from(schema.curlingRegistrations)
    .where(inArray(schema.curlingRegistrations.id, registrationIds));
  const awaiting = registrations.filter((registration) => registration.status === 'awaiting_placement');
  if (awaiting.length === 0) return;

  const { triggerDeferredRegistrationPayment } = await import('./registrationMembershipPaymentService.js');
  for (const registration of awaiting) {
    try {
      await triggerDeferredRegistrationPayment({
        registrationId: registration.id,
        actorMemberId: input.actorMemberId,
      });
    } catch {
      // Staff can follow up on payment from the registration; withdraw still succeeded.
    }
  }
}

export async function linkEntryTeamPendingMember(input: {
  teamId: number;
  leagueId?: number;
  teamMemberId: number;
  memberId: number;
  actorMemberId: number;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const team = await loadEntryTeamOrThrow(input.teamId, input.leagueId);
  const [row] = await db
    .select()
    .from(schema.leagueEntryTeamMembers)
    .where(
      and(
        eq(schema.leagueEntryTeamMembers.id, input.teamMemberId),
        eq(schema.leagueEntryTeamMembers.entry_team_id, input.teamId)
      )
    )
    .limit(1);
  if (!row) {
    throw new LeagueEntryValidationError({ member: 'Team member row was not found.' });
  }
  if (row.member_id != null) {
    throw new LeagueEntryValidationError({ member: 'This teammate is already linked to a member account.' });
  }
  const [member] = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.id, input.memberId))
    .limit(1);
  if (!member) {
    throw new LeagueEntryValidationError({ member: 'Member was not found.' });
  }
  await assertMembersNotCommittedElsewhere({
    leagueId: team.league_id,
    memberIds: [input.memberId],
    excludeTeamId: input.teamId,
  });
  const duplicate = await db
    .select({ id: schema.leagueEntryTeamMembers.id })
    .from(schema.leagueEntryTeamMembers)
    .where(
      and(
        eq(schema.leagueEntryTeamMembers.entry_team_id, input.teamId),
        eq(schema.leagueEntryTeamMembers.member_id, input.memberId)
      )
    )
    .limit(1);
  if (duplicate.length > 0) {
    throw new LeagueEntryValidationError({ member: 'That member is already on this team.' });
  }
  await db
    .update(schema.leagueEntryTeamMembers)
    .set({
      member_id: input.memberId,
      pending_name: null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.leagueEntryTeamMembers.id, input.teamMemberId));
}

// --- Outcome recording (grant entry / not entered) -------------------------------

export type EntryTeamOutcomeResult = {
  teamId: number;
  status: LeagueEntryTeamStatusSqlite;
  rosterPlacements: number;
  /** League Teams-tab team created when granting entry, if any eligible members. */
  leagueTeamId: number | null;
  paymentResults: Array<{
    registrationId: number;
    outcome: string;
    checkoutUrl?: string;
    error?: string;
  }>;
};

const TEAMS_FORMAT_ROLES = ['lead', 'second', 'third', 'fourth'] as const;

function lastNameFromFullName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] || trimmed;
}

function provisionalLeagueTeamAssignments(
  format: string,
  memberIds: number[],
): Array<{
  memberId: number;
  role: 'lead' | 'second' | 'third' | 'fourth' | 'player1' | 'player2';
  isSkip: number;
  isVice: number;
}> {
  if (format === 'doubles') {
    return memberIds.slice(0, 2).map((memberId, index) => ({
      memberId,
      role: index === 0 ? 'player1' : 'player2',
      isSkip: 0,
      isVice: 0,
    }));
  }
  return memberIds.slice(0, 4).map((memberId, index, list) => ({
    memberId,
    role: TEAMS_FORMAT_ROLES[index] ?? 'fourth',
    isSkip: index === list.length - 1 ? 1 : 0,
    isVice: list.length > 1 && index === list.length - 2 ? 1 : 0,
  }));
}

/**
 * Creates a Teams-tab league team for a granted entry declaration.
 * Account-linked members who are not already on another team in this league are
 * assigned with provisional roles (staff can edit skip/vice later).
 */
async function createLeagueTeamForGrantedEntry(input: {
  tx: DbExecutor;
  leagueId: number;
  format: string;
  entryTeamName: string | null;
  memberIds: number[];
}): Promise<number | null> {
  const { schema } = getDrizzleDb();
  if (input.memberIds.length === 0) return null;

  const alreadyOnTeam = await input.tx
    .select({ memberId: schema.teamMembers.member_id })
    .from(schema.teamMembers)
    .innerJoin(schema.leagueTeams, eq(schema.teamMembers.team_id, schema.leagueTeams.id))
    .where(
      and(eq(schema.leagueTeams.league_id, input.leagueId), inArray(schema.teamMembers.member_id, input.memberIds)),
    );
  const taken = new Set(alreadyOnTeam.map((row) => row.memberId));
  const availableIds = input.memberIds.filter((memberId) => !taken.has(memberId));
  if (availableIds.length === 0) return null;

  const [defaultDivision] = await input.tx
    .select({ id: schema.leagueDivisions.id })
    .from(schema.leagueDivisions)
    .where(and(eq(schema.leagueDivisions.league_id, input.leagueId), eq(schema.leagueDivisions.is_default, 1)))
    .limit(1);
  if (!defaultDivision) {
    throw new LeagueEntryValidationError({
      division: 'Default division was not found for this league; create one before granting entry.',
    });
  }

  const memberRows = await input.tx
    .select({ id: schema.members.id, name: schema.members.name })
    .from(schema.members)
    .where(inArray(schema.members.id, availableIds));
  const nameById = new Map(memberRows.map((row) => [row.id, row.name ?? '']));

  const assignments = provisionalLeagueTeamAssignments(input.format, availableIds);
  let teamName = input.entryTeamName?.trim() || null;
  if (!teamName) {
    const skip = assignments.find((assignment) => assignment.isSkip === 1) ?? assignments[0];
    const lastName = skip ? lastNameFromFullName(nameById.get(skip.memberId) ?? '') : '';
    teamName = lastName ? `Team ${lastName}` : null;
  }

  const [leagueTeam] = await input.tx
    .insert(schema.leagueTeams)
    .values({
      league_id: input.leagueId,
      division_id: defaultDivision.id,
      name: teamName,
    })
    .returning();

  await input.tx.insert(schema.teamMembers).values(
    assignments.map((assignment) => ({
      team_id: leagueTeam.id,
      member_id: assignment.memberId,
      role: assignment.role,
      is_skip: assignment.isSkip,
      is_vice: assignment.isVice,
    })),
  );

  return leagueTeam.id;
}

/**
 * Records the play-in outcome for a declared team.
 *
 * Granting entry places all account-linked members on the league roster with the
 * play_in placement type (REPLACE members are also released from the replaced
 * league), creates a Teams-tab league team for those members, marks their play-in
 * registration selections placed, and triggers the deferred-registration payment
 * path for affected registrations awaiting placement.
 */
export async function recordLeagueEntryTeamOutcome(input: {
  teamId: number;
  leagueId?: number;
  outcome: 'entered';
  actorMemberId: number;
}): Promise<EntryTeamOutcomeResult> {
  const { db, schema } = getDrizzleDb();
  const team = await loadEntryTeamOrThrow(input.teamId, input.leagueId);
  if (team.status === 'withdrawn' || team.status === 'not_entered') {
    throw new LeagueEntryValidationError({ team: 'Withdrawn teams cannot receive entry. Reinstate them first.' });
  }
  if (team.status === 'entered') {
    throw new LeagueEntryValidationError({ team: 'This team has already been granted entry.' });
  }
  const league = await loadPlayInLeagueConfig(team.league_id);
  if (!league) {
    throw new LeagueEntryValidationError({ league: 'League was not found.' });
  }
  const members = await db
    .select()
    .from(schema.leagueEntryTeamMembers)
    .where(eq(schema.leagueEntryTeamMembers.entry_team_id, input.teamId));

  let rosterPlacements = 0;
  let leagueTeamId: number | null = null;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.leagueEntryTeams)
      .set({ status: 'entered', updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.leagueEntryTeams.id, input.teamId));

    const rosteredMemberIds: number[] = [];

    for (const member of members) {
      if (member.member_id == null) continue;

      const [existingRoster] = await tx
        .select()
        .from(schema.leagueRoster)
        .where(
          and(
            eq(schema.leagueRoster.league_id, team.league_id),
            eq(schema.leagueRoster.member_id, member.member_id)
          )
        )
        .limit(1);
      const rosterValues = {
        source_registration_id: member.source_registration_id,
        status: 'active' as const,
        placement_type: 'play_in' as const,
        is_temporary_sabbatical_fill: 0,
        related_sabbatical_id: null,
        updated_at: sql`CURRENT_TIMESTAMP`,
      };
      if (existingRoster) {
        await tx.update(schema.leagueRoster).set(rosterValues).where(eq(schema.leagueRoster.id, existingRoster.id));
      } else {
        await tx.insert(schema.leagueRoster).values({
          league_id: team.league_id,
          member_id: member.member_id,
          ...rosterValues,
        });
      }
      rosterPlacements += 1;
      rosteredMemberIds.push(member.member_id);

      if (league.sessionId != null) {
        await releaseOverflowLeaguePlacements({
          tx,
          memberId: member.member_id,
          sessionId: league.sessionId,
          keepLeagueId: team.league_id,
        });
      }
    }

    leagueTeamId = await createLeagueTeamForGrantedEntry({
      tx,
      leagueId: team.league_id,
      format: league.format,
      entryTeamName: team.name,
      memberIds: rosteredMemberIds,
    });
  });

  // Trigger deferred payments outside the transaction: each one talks to Stripe.
  const paymentResults: EntryTeamOutcomeResult['paymentResults'] = [];
  const registrationIds = [
    ...new Set(
      members
        .map((member) => member.source_registration_id)
        .filter((registrationId): registrationId is number => registrationId != null)
    ),
  ];
  if (registrationIds.length > 0) {
    const registrations = await db
      .select({ id: schema.curlingRegistrations.id, status: schema.curlingRegistrations.status })
      .from(schema.curlingRegistrations)
      .where(inArray(schema.curlingRegistrations.id, registrationIds));
    const awaiting = registrations.filter((registration) => registration.status === 'awaiting_placement');
    if (awaiting.length > 0) {
      const { triggerDeferredRegistrationPayment } = await import('./registrationMembershipPaymentService.js');
      for (const registration of awaiting) {
        try {
          const result = await triggerDeferredRegistrationPayment({
            registrationId: registration.id,
            actorMemberId: input.actorMemberId,
          });
          paymentResults.push({
            registrationId: registration.id,
            outcome: result.outcome,
            checkoutUrl: 'checkoutUrl' in result ? (result as { checkoutUrl?: string }).checkoutUrl : undefined,
          });
        } catch (error) {
          paymentResults.push({
            registrationId: registration.id,
            outcome: 'error',
            error: error instanceof Error ? error.message : 'Payment trigger failed',
          });
        }
      }
    }
  }

  return {
    teamId: input.teamId,
    status: input.outcome,
    rosterPlacements,
    leagueTeamId,
    paymentResults,
  };
}
