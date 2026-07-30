import { eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { LeagueEntryTeamStatusSqlite, WaitlistEntryTypeSqlite } from '../db/drizzle-schema.js';

/**
 * Play-in ("TLINE") entry evaluation for play-in based leagues.
 *
 * Entry model: the top N teams by combined member TLINE points enter the league
 * automatically (N = capacity - playInSpotCount); everyone else plays down for the
 * remaining spots. Teams need at least MIN_RETURNING_MEMBERS members who played the
 * league in the prior season to be eligible for auto entry; that rule is waived when
 * fewer than N teams meet it.
 *
 * All point values are integer half-point units (e.g. 39 = 19.5 points).
 */

export const MIN_RETURNING_MEMBERS = 2;

export type PlayInMemberPoints = {
  memberId: number;
  pointsHalf: number;
  countsAsReturning: boolean;
};

export type PlayInTeamStatus = LeagueEntryTeamStatusSqlite;

export type PlayInTeamForEvaluation = {
  /** league_entry_teams.id, or null for a hypothetical team being drafted during registration. */
  entryTeamId: number | null;
  memberIds: number[];
  /** Teammates without member accounts yet; they always contribute 0 points. */
  pendingNameCount: number;
  status: PlayInTeamStatus;
};

export type PlayInEvaluationConfig = {
  /** Number of teams that enter automatically on points (capacity - play-in spots). */
  autoEntryCount: number;
  /** Players per team (4 for teams format). */
  teamSize: number;
};

export type PlayInProjectedStatus =
  | 'guaranteed'
  | 'projected_in'
  | 'projected_playdown'
  | 'ineligible_single_returner'
  | 'entered'
  | 'not_entered'
  | 'withdrawn';

export type PlayInEvaluatedTeam = {
  entryTeamId: number | null;
  totalPointsHalf: number;
  returningMemberCount: number;
  /** Meets the returning-members rule without relying on the waiver. */
  meetsReturningRule: boolean;
  /** Team total strictly exceeds the stacked opposing-team bar and meets the returning rule. */
  guaranteed: boolean;
  /**
   * Bar this team must strictly exceed for guarantee (other active teams + stacked
   * uncommitted pool). Null when unavailable (e.g. auto-entry spots filled by entered teams).
   */
  guaranteeThresholdHalf: number | null;
  projectedStatus: PlayInProjectedStatus;
};

export type PlayInLeagueEvaluation = {
  autoEntryCount: number;
  teamSize: number;
  playInSpotCount: number;
  /** Fewer than autoEntryCount active teams meet the returning-members rule. */
  returningRuleWaiverActive: boolean;
  /** Guaranteed-entry bar (half points): beat this total to be guaranteed. Null if unavailable. */
  guaranteeThresholdHalf: number | null;
  teams: PlayInEvaluatedTeam[];
};

export function pointsHalfToNumber(pointsHalf: number): number {
  return pointsHalf / 2;
}

export function numberToPointsHalf(points: number): number {
  return Math.round(points * 2);
}

function isActiveTeamStatus(status: PlayInTeamStatus): boolean {
  return status !== 'withdrawn' && status !== 'not_entered';
}

export function teamTotalPointsHalf(memberIds: number[], pointsByMemberId: Map<number, PlayInMemberPoints>): number {
  return memberIds.reduce((sum, memberId) => sum + (pointsByMemberId.get(memberId)?.pointsHalf ?? 0), 0);
}

export function teamReturningMemberCount(
  memberIds: number[],
  pointsByMemberId: Map<number, PlayInMemberPoints>
): number {
  return memberIds.filter((memberId) => pointsByMemberId.get(memberId)?.countsAsReturning).length;
}

/**
 * Strongest possible future teams from the uncommitted points pool: sort is
 * assumed descending; take the next `teamSize` players for each team (padding the
 * last team with zero-point newcomers when fewer than `teamSize` remain).
 */
export function strongestHypotheticalTeamTotals(
  uncommittedPointsHalfDesc: number[],
  teamSize: number
): number[] {
  if (teamSize <= 0 || uncommittedPointsHalfDesc.length === 0) return [];
  const totals: number[] = [];
  for (let i = 0; i < uncommittedPointsHalfDesc.length; i += teamSize) {
    let sum = 0;
    for (let j = 0; j < teamSize; j += 1) {
      sum += uncommittedPointsHalfDesc[i + j] ?? 0;
    }
    totals.push(sum);
  }
  return totals;
}

/**
 * Opposing team totals for guarantee math: declared active teams (entered teams
 * permanently occupy a top slot) plus strongest stacked teams from the uncommitted
 * pool, sorted high → low.
 */
export function opposingTeamTotalsHalf(
  declaredTeams: Array<{ totalPointsHalf: number; status: PlayInTeamStatus }>,
  uncommittedPointsHalfDesc: number[],
  teamSize: number
): number[] {
  const totals: number[] = declaredTeams.map((team) =>
    team.status === 'entered' ? Number.POSITIVE_INFINITY : team.totalPointsHalf
  );
  totals.push(...strongestHypotheticalTeamTotals(uncommittedPointsHalfDesc, teamSize));
  totals.sort((left, right) => right - left);
  return totals;
}

function guaranteeBarHalf(
  declaredTeams: Array<{ totalPointsHalf: number; status: PlayInTeamStatus }>,
  uncommittedPointsHalfDesc: number[],
  config: PlayInEvaluationConfig
): number | null {
  if (config.autoEntryCount <= 0) return null;
  const opposing = opposingTeamTotalsHalf(declaredTeams, uncommittedPointsHalfDesc, config.teamSize);
  while (opposing.length < config.autoEntryCount) {
    opposing.push(0);
  }
  const bar = opposing[config.autoEntryCount - 1];
  if (bar === undefined || !Number.isFinite(bar)) return null;
  return bar;
}

/**
 * Guaranteed-entry threshold: the autoEntryCount-th strongest opposing team total
 * (declared + stacked from the uncommitted pool). A team is guaranteed when its
 * total strictly exceeds this bar. Null when auto-entry spots are already filled
 * by entered teams (or autoEntryCount is zero).
 */
export function guaranteeThresholdHalf(
  activeTeams: Array<{ totalPointsHalf: number; status: PlayInTeamStatus }>,
  uncommittedPointsHalfDesc: number[],
  config: PlayInEvaluationConfig
): number | null {
  return guaranteeBarHalf(activeTeams, uncommittedPointsHalfDesc, config);
}

export function evaluatePlayInLeague(
  config: PlayInEvaluationConfig & { playInSpotCount: number },
  points: PlayInMemberPoints[],
  teams: PlayInTeamForEvaluation[]
): PlayInLeagueEvaluation {
  const pointsByMemberId = new Map(points.map((entry) => [entry.memberId, entry]));

  const enriched = teams.map((team) => ({
    team,
    totalPointsHalf: teamTotalPointsHalf(team.memberIds, pointsByMemberId),
    returningMemberCount: teamReturningMemberCount(team.memberIds, pointsByMemberId),
  }));

  const activeEnriched = enriched.filter((entry) => isActiveTeamStatus(entry.team.status));
  const committedMemberIds = new Set(activeEnriched.flatMap((entry) => entry.team.memberIds));
  const uncommittedPointsHalfDesc = points
    .filter((entry) => !committedMemberIds.has(entry.memberId) && entry.pointsHalf > 0)
    .map((entry) => entry.pointsHalf)
    .sort((left, right) => right - left);

  const eligibleActiveCount = activeEnriched.filter(
    (entry) => entry.returningMemberCount >= MIN_RETURNING_MEMBERS
  ).length;
  const returningRuleWaiverActive = eligibleActiveCount < config.autoEntryCount;

  // Projection: rank active teams by points; without the waiver only teams meeting
  // the returning rule compete for auto entry spots.
  const rankingPool = activeEnriched
    .filter((entry) => returningRuleWaiverActive || entry.returningMemberCount >= MIN_RETURNING_MEMBERS)
    .sort((left, right) => right.totalPointsHalf - left.totalPointsHalf);
  const projectedInKeys = new Set(
    rankingPool.slice(0, config.autoEntryCount).map((entry) => entry.team)
  );

  const evaluatedTeams: PlayInEvaluatedTeam[] = enriched.map((entry) => {
    const { team, totalPointsHalf, returningMemberCount } = entry;
    const meetsReturningRule = returningMemberCount >= MIN_RETURNING_MEMBERS;

    if (team.status === 'withdrawn' || team.status === 'not_entered' || team.status === 'entered') {
      return {
        entryTeamId: team.entryTeamId,
        totalPointsHalf,
        returningMemberCount,
        meetsReturningRule,
        guaranteed: team.status === 'entered',
        guaranteeThresholdHalf: null,
        projectedStatus: team.status,
      };
    }

    const otherActiveTeams = activeEnriched
      .filter((other) => other !== entry)
      .map((other) => ({ totalPointsHalf: other.totalPointsHalf, status: other.team.status }));
    // The evaluated team's own members are committed to it, so they stay excluded
    // from the uncommitted pool used for hypothetical future opponents.
    const teamGuaranteeThresholdHalf = guaranteeBarHalf(
      otherActiveTeams,
      uncommittedPointsHalfDesc,
      config,
    );
    const guaranteed =
      meetsReturningRule &&
      teamGuaranteeThresholdHalf != null &&
      totalPointsHalf > teamGuaranteeThresholdHalf;

    let projectedStatus: PlayInProjectedStatus;
    if (guaranteed) {
      projectedStatus = 'guaranteed';
    } else if (!meetsReturningRule && !returningRuleWaiverActive) {
      projectedStatus = 'ineligible_single_returner';
    } else if (projectedInKeys.has(team)) {
      projectedStatus = 'projected_in';
    } else {
      projectedStatus = 'projected_playdown';
    }

    return {
      entryTeamId: team.entryTeamId,
      totalPointsHalf,
      returningMemberCount,
      meetsReturningRule,
      guaranteed,
      guaranteeThresholdHalf: teamGuaranteeThresholdHalf,
      projectedStatus,
    };
  });

  const activeForThreshold = activeEnriched.map((entry) => ({
    totalPointsHalf: entry.totalPointsHalf,
    status: entry.team.status,
  }));

  return {
    autoEntryCount: config.autoEntryCount,
    teamSize: config.teamSize,
    playInSpotCount: config.playInSpotCount,
    returningRuleWaiverActive,
    guaranteeThresholdHalf: guaranteeThresholdHalf(activeForThreshold, uncommittedPointsHalfDesc, config),
    teams: evaluatedTeams,
  };
}

export function playInAutoEntryCount(league: {
  capacity_type: string;
  capacity_value: number;
  play_in_spot_count: number;
}): number {
  const capacityTeams = league.capacity_type === 'team' ? league.capacity_value : 0;
  return Math.max(0, capacityTeams - league.play_in_spot_count);
}

export function playInTeamSize(format: string): number {
  return format === 'doubles' ? 2 : 4;
}

// --- Database loading -------------------------------------------------------

export type LeagueEntryPointsRow = {
  id: number;
  leagueId: number;
  memberId: number;
  memberName: string;
  pointsHalf: number;
  countsAsReturning: boolean;
  source: 'manual' | 'standings' | 'playdown';
  notes: string | null;
};

export type LeagueEntryTeamMemberRow = {
  id: number;
  memberId: number | null;
  memberName: string | null;
  pendingName: string | null;
  entryType: WaitlistEntryTypeSqlite;
  replacesLeagueId: number | null;
  sourceRegistrationId: number | null;
};

export type LeagueEntryTeamRow = {
  id: number;
  leagueId: number;
  name: string | null;
  status: PlayInTeamStatus;
  createdFromRegistrationId: number | null;
  notes: string | null;
  members: LeagueEntryTeamMemberRow[];
};

function memberDisplayName(row: {
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}): string {
  const fromParts = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return (fromParts || row.name || row.email || 'Unknown member').trim();
}

export async function loadLeagueEntryPoints(leagueId: number): Promise<LeagueEntryPointsRow[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.leagueEntryPoints.id,
      leagueId: schema.leagueEntryPoints.league_id,
      memberId: schema.leagueEntryPoints.member_id,
      pointsHalf: schema.leagueEntryPoints.points_half,
      countsAsReturning: schema.leagueEntryPoints.counts_as_returning,
      source: schema.leagueEntryPoints.source,
      notes: schema.leagueEntryPoints.notes,
      memberName: schema.members.name,
      memberFirstName: schema.members.first_name,
      memberLastName: schema.members.last_name,
      memberEmail: schema.members.email,
    })
    .from(schema.leagueEntryPoints)
    .innerJoin(schema.members, eq(schema.leagueEntryPoints.member_id, schema.members.id))
    .where(eq(schema.leagueEntryPoints.league_id, leagueId));
  return rows.map((row) => ({
    id: row.id,
    leagueId: row.leagueId,
    memberId: row.memberId,
    memberName: memberDisplayName({
      name: row.memberName,
      first_name: row.memberFirstName,
      last_name: row.memberLastName,
      email: row.memberEmail,
    }),
    pointsHalf: row.pointsHalf,
    countsAsReturning: Boolean(row.countsAsReturning),
    source: row.source,
    notes: row.notes ?? null,
  }));
}

/** Effective member points for evaluation: ledger rows summed per member. */
export function aggregateMemberPoints(rows: LeagueEntryPointsRow[]): PlayInMemberPoints[] {
  const byMember = new Map<number, PlayInMemberPoints>();
  for (const row of rows) {
    const existing = byMember.get(row.memberId);
    if (existing) {
      existing.pointsHalf += row.pointsHalf;
      existing.countsAsReturning = existing.countsAsReturning || row.countsAsReturning;
    } else {
      byMember.set(row.memberId, {
        memberId: row.memberId,
        pointsHalf: row.pointsHalf,
        countsAsReturning: row.countsAsReturning,
      });
    }
  }
  return [...byMember.values()];
}

export async function loadLeagueEntryTeams(leagueId: number): Promise<LeagueEntryTeamRow[]> {
  const { db, schema } = getDrizzleDb();
  const teams = await db
    .select({
      id: schema.leagueEntryTeams.id,
      leagueId: schema.leagueEntryTeams.league_id,
      name: schema.leagueEntryTeams.name,
      status: schema.leagueEntryTeams.status,
      createdFromRegistrationId: schema.leagueEntryTeams.created_from_registration_id,
      notes: schema.leagueEntryTeams.notes,
    })
    .from(schema.leagueEntryTeams)
    .where(eq(schema.leagueEntryTeams.league_id, leagueId));
  if (teams.length === 0) return [];

  const memberRows = await db
    .select({
      id: schema.leagueEntryTeamMembers.id,
      entryTeamId: schema.leagueEntryTeamMembers.entry_team_id,
      memberId: schema.leagueEntryTeamMembers.member_id,
      pendingName: schema.leagueEntryTeamMembers.pending_name,
      entryType: schema.leagueEntryTeamMembers.entry_type,
      replacesLeagueId: schema.leagueEntryTeamMembers.replaces_league_id,
      sourceRegistrationId: schema.leagueEntryTeamMembers.source_registration_id,
    })
    .from(schema.leagueEntryTeamMembers)
    .where(inArray(schema.leagueEntryTeamMembers.entry_team_id, teams.map((team) => team.id)));

  const memberIds = [...new Set(memberRows.map((row) => row.memberId).filter((id): id is number => id != null))];
  const names = new Map<number, string>();
  if (memberIds.length > 0) {
    const members = await db
      .select({
        id: schema.members.id,
        name: schema.members.name,
        first_name: schema.members.first_name,
        last_name: schema.members.last_name,
        email: schema.members.email,
      })
      .from(schema.members)
      .where(inArray(schema.members.id, memberIds));
    for (const member of members) {
      names.set(member.id, memberDisplayName(member));
    }
  }

  return teams.map((team) => ({
    id: team.id,
    leagueId: team.leagueId,
    name: team.name ?? null,
    status: team.status,
    createdFromRegistrationId: team.createdFromRegistrationId ?? null,
    notes: team.notes ?? null,
    members: memberRows
      .filter((row) => row.entryTeamId === team.id)
      .map((row) => ({
        id: row.id,
        memberId: row.memberId ?? null,
        memberName: row.memberId != null ? names.get(row.memberId) ?? `Member #${row.memberId}` : null,
        pendingName: row.pendingName ?? null,
        entryType: row.entryType,
        replacesLeagueId: row.replacesLeagueId ?? null,
        sourceRegistrationId: row.sourceRegistrationId ?? null,
      })),
  }));
}

export function entryTeamToEvaluationInput(team: LeagueEntryTeamRow): PlayInTeamForEvaluation {
  return {
    entryTeamId: team.id,
    memberIds: team.members
      .map((member) => member.memberId)
      .filter((memberId): memberId is number => memberId != null),
    pendingNameCount: team.members.filter((member) => member.memberId == null).length,
    status: team.status,
  };
}

export type PlayInLeagueConfigRow = {
  id: number;
  name: string;
  format: string;
  capacityType: string;
  capacityValue: number;
  playInSpotCount: number;
  isPlayInBased: boolean;
};

export async function loadPlayInLeagueConfig(leagueId: number): Promise<PlayInLeagueConfigRow | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      format: schema.leagues.format,
      capacityType: schema.leagues.capacity_type,
      capacityValue: schema.leagues.capacity_value,
      playInSpotCount: schema.leagues.play_in_spot_count,
      isPlayInBased: schema.leagues.is_play_in_based,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    capacityType: row.capacityType,
    capacityValue: row.capacityValue,
    playInSpotCount: row.playInSpotCount,
    isPlayInBased: Boolean(row.isPlayInBased),
  };
}

/** Full evaluation for a play-in league, loading points and teams from the database. */
export async function evaluatePlayInLeagueFromDb(leagueId: number): Promise<{
  league: PlayInLeagueConfigRow;
  points: LeagueEntryPointsRow[];
  teams: LeagueEntryTeamRow[];
  evaluation: PlayInLeagueEvaluation;
} | null> {
  const league = await loadPlayInLeagueConfig(leagueId);
  if (!league) return null;
  const [points, teams] = await Promise.all([loadLeagueEntryPoints(leagueId), loadLeagueEntryTeams(leagueId)]);
  const evaluation = evaluatePlayInLeague(
    {
      autoEntryCount: playInAutoEntryCount({
        capacity_type: league.capacityType,
        capacity_value: league.capacityValue,
        play_in_spot_count: league.playInSpotCount,
      }),
      teamSize: playInTeamSize(league.format),
      playInSpotCount: league.playInSpotCount,
    },
    aggregateMemberPoints(points),
    teams.map(entryTeamToEvaluationInput)
  );
  return { league, points, teams, evaluation };
}
