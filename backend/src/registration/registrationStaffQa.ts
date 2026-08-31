import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { resolveAdjacentSessionsForLeagues } from '../services/curlingSessionService.js';
import type { Member } from '../types.js';
import { compareLeaguesByDayThenFirstDraw, sortLeaguesByDayOfWeekThenFirstDrawTime } from '../utils/leagueOrdering.js';
import { memberCanManageRegistrations } from '../utils/registrationStaffAccess.js';
import {
  DRAFT_REGISTRATION_STATUSES,
  SUBMITTED_CURLER_REGISTRATION_STATUSES,
} from './registrationDraftProgress.js';
import {
  labelPriorityEntries,
  priorityRosterAllReturning,
  priorityRosterIsComplete,
  type LeaguePriorityGuaranteeLabel,
  type PriorityLabelCandidate,
  type PriorityLeagueShape,
} from './leaguePriorityRules.js';
import type { LeaguePriorityInput } from './registrationContext.js';
import { RegistrationStaffValidationError } from './registrationStaffService.js';
import { getScheduleRegistrationWindow } from './registrationShellService.js';
import { parseTeamRosterPlacements } from './waitlistTeamRoster.js';

export const RETURNING_PLAYER_QA_STATUSES = [
  'not_yet_registered',
  'guaranteed_return',
  'guaranteed_fallback',
  'dropped',
  'third_or_higher',
  'sabbatical',
] as const;

export type ReturningPlayerQaStatus = (typeof RETURNING_PLAYER_QA_STATUSES)[number];

const ROSTERED_STATUSES = ['active', 'completed'] as const;
const ACTIVE_SABBATICAL_STATUSES = ['active', 'staff_overridden', 'returning'] as const;

type DrizzleBundle = ReturnType<typeof getDrizzleDb>;

type RegistrationPickRow = {
  id: number;
  status: string;
  submittedAt: string | null;
  updatedAt: string;
  desiredLeagueCount: number | null;
  returningMemberAnswer: number | null;
};

type PickedRegistrationRow = RegistrationPickRow & { curlerMemberId: number };

export type ReturningMemberQaLeague = {
  id: number;
  name: string;
  dayOfWeek: number;
};

export type ReturningMemberQaRow = {
  memberId: number;
  memberName: string;
  memberEmail: string | null;
  previousLeagues: ReturningMemberQaLeague[];
  registrationId: number | null;
  registrationStatus: string | null;
};

export type ReturningPlayerQaClassification = {
  status: ReturningPlayerQaStatus;
  priorityRank: number | null;
  guaranteeLabel: LeaguePriorityGuaranteeLabel | null;
};

function assertStaffAccess(actor: Member): void {
  if (!memberCanManageRegistrations(actor)) {
    throw new RegistrationStaffValidationError({ registration: 'You do not have permission to manage registrations.' });
  }
}

function memberName(row: {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null | undefined): string {
  if (!row) return 'Unknown curler';
  const parts = [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : row.name?.trim() || row.email?.trim() || 'Unknown curler';
}

function isSubmittedStatus(status: string): boolean {
  return (SUBMITTED_CURLER_REGISTRATION_STATUSES as readonly string[]).includes(status);
}

function isDraftStatus(status: string): boolean {
  return (DRAFT_REGISTRATION_STATUSES as readonly string[]).includes(status);
}

function timestampToString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function timestampToStringOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return timestampToString(value);
}

function newerRegistration(left: RegistrationPickRow, right: RegistrationPickRow): RegistrationPickRow {
  return left.updatedAt >= right.updatedAt ? left : right;
}

/** Prefer a submitted registration; otherwise the latest in-progress draft. Canceled rows are ignored. */
export function pickStaffRegistrationForQa<T extends RegistrationPickRow>(rows: readonly T[]): T | null {
  let submitted: T | null = null;
  let draft: T | null = null;
  for (const row of rows) {
    if (isSubmittedStatus(row.status)) {
      submitted = submitted ? (newerRegistration(submitted, row) as T) : row;
      continue;
    }
    if (isDraftStatus(row.status)) {
      draft = draft ? (newerRegistration(draft, row) as T) : row;
    }
  }
  return submitted ?? draft;
}

/** True when the member has no submitted registration for the QA session (drafts still count as not yet registered). */
export function isNotYetRegisteredForQa(registration: { status: string } | null | undefined): boolean {
  return registration == null || !isSubmittedStatus(registration.status);
}

function sortPreviousLeagues(leagues: ReturningMemberQaLeague[]): ReturningMemberQaLeague[] {
  const firstDrawByLeagueId = new Map<number, string>();
  return [...leagues].sort((a, b) =>
    compareLeaguesByDayThenFirstDraw(
      { id: a.id, name: a.name, dayOfWeek: a.dayOfWeek },
      { id: b.id, name: b.name, dayOfWeek: b.dayOfWeek },
      firstDrawByLeagueId,
    ),
  );
}

export function buildReturningMembersQaRows(input: {
  roster: Array<{
    memberId: number;
    memberName: string;
    memberEmail: string | null;
    league: ReturningMemberQaLeague;
  }>;
  registrationsByMemberId: ReadonlyMap<number, RegistrationPickRow>;
}): ReturningMemberQaRow[] {
  const byMemberId = new Map<
    number,
    {
      memberName: string;
      memberEmail: string | null;
      leaguesById: Map<number, ReturningMemberQaLeague>;
    }
  >();
  for (const row of input.roster) {
    const existing = byMemberId.get(row.memberId);
    if (!existing) {
      byMemberId.set(row.memberId, {
        memberName: row.memberName,
        memberEmail: row.memberEmail,
        leaguesById: new Map([[row.league.id, row.league]]),
      });
      continue;
    }
    existing.leaguesById.set(row.league.id, row.league);
  }

  const members: ReturningMemberQaRow[] = [];
  for (const [memberId, row] of byMemberId) {
    const registration = input.registrationsByMemberId.get(memberId) ?? null;
    if (!isNotYetRegisteredForQa(registration)) continue;
    members.push({
      memberId,
      memberName: row.memberName,
      memberEmail: row.memberEmail,
      previousLeagues: sortPreviousLeagues([...row.leaguesById.values()]),
      registrationId: registration?.id ?? null,
      registrationStatus: registration?.status ?? null,
    });
  }
  return members.sort((a, b) => a.memberName.localeCompare(b.memberName) || a.memberId - b.memberId);
}

async function loadPickedRegistrationsByMemberId(
  db: DrizzleBundle['db'],
  schema: DrizzleBundle['schema'],
  sessionId: number,
  memberIds: number[],
): Promise<Map<number, PickedRegistrationRow>> {
  const registrationsByMemberId = new Map<number, PickedRegistrationRow>();
  if (memberIds.length === 0) return registrationsByMemberId;

  const registrationRows = await db
    .select({
      id: schema.curlingRegistrations.id,
      curlerMemberId: schema.curlingRegistrations.curler_member_id,
      status: schema.curlingRegistrations.status,
      submittedAt: schema.curlingRegistrations.submitted_at,
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

  const grouped = new Map<number, PickedRegistrationRow[]>();
  for (const row of registrationRows) {
    if (row.curlerMemberId == null) continue;
    const list = grouped.get(row.curlerMemberId) ?? [];
    list.push({
      id: row.id,
      curlerMemberId: row.curlerMemberId,
      status: row.status,
      submittedAt: timestampToStringOrNull(row.submittedAt),
      updatedAt: timestampToString(row.updatedAt),
      desiredLeagueCount: row.desiredLeagueCount,
      returningMemberAnswer: row.returningMemberAnswer,
    });
    grouped.set(row.curlerMemberId, list);
  }
  for (const [memberId, rows] of grouped) {
    const picked = pickStaffRegistrationForQa(rows);
    if (picked) registrationsByMemberId.set(memberId, picked);
  }
  return registrationsByMemberId;
}

export function emptyReturningPlayerQaCounts(): Record<ReturningPlayerQaStatus, number> {
  return {
    not_yet_registered: 0,
    guaranteed_return: 0,
    guaranteed_fallback: 0,
    dropped: 0,
    third_or_higher: 0,
    sabbatical: 0,
  };
}

/**
 * Maps a previous-session rostered player onto the QA status staff use to catch
 * missed or incorrect return registrations.
 *
 * Rank 1–2 on the list is the expected return path (green), even when the live
 * guarantee label is still assembling a roster or the window is open. Guaranteed
 * fallback wins over a generic 3rd+ label so a protected switch stays visible.
 */
export function classifyReturningPlayerQa(input: {
  hasSubmittedRegistration: boolean;
  leagueId: number;
  priorities: Array<{ leagueId: number; priorityRank: number }>;
  selections: Array<{ selectionType: string; leagueId: number | null }>;
  guaranteeLabelByLeagueId: ReadonlyMap<number, LeaguePriorityGuaranteeLabel>;
}): ReturningPlayerQaClassification {
  const priority = input.priorities.find((entry) => entry.leagueId === input.leagueId) ?? null;
  const guaranteeLabel = priority ? (input.guaranteeLabelByLeagueId.get(input.leagueId) ?? null) : null;
  const priorityRank = priority?.priorityRank ?? null;

  if (!input.hasSubmittedRegistration) {
    return { status: 'not_yet_registered', priorityRank, guaranteeLabel };
  }

  const selection = input.selections.find((entry) => entry.leagueId === input.leagueId);
  if (selection?.selectionType === 'sabbatical') {
    return { status: 'sabbatical', priorityRank, guaranteeLabel };
  }
  if (selection?.selectionType === 'drop' || !priority) {
    return { status: 'dropped', priorityRank: priority ? priorityRank : null, guaranteeLabel };
  }

  if (guaranteeLabel === 'guaranteed_fallback') {
    return { status: 'guaranteed_fallback', priorityRank, guaranteeLabel };
  }
  if (guaranteeLabel === 'guaranteed_return' || priority.priorityRank <= 2) {
    return { status: 'guaranteed_return', priorityRank, guaranteeLabel };
  }
  return { status: 'third_or_higher', priorityRank, guaranteeLabel };
}

function asPriorityLeague(row: {
  league_type: 'standard' | 'bring_your_own_team';
  format: 'teams' | 'doubles' | 'instructional';
  waitlist_id: number | null;
  is_play_in_based: number | null;
  registration_fee_minor: number | null;
}): PriorityLeagueShape {
  return {
    leagueType: row.league_type,
    format: row.format,
    allowsWaitlist: row.waitlist_id != null,
    isPlayInBased: row.is_play_in_based === 1,
    registrationFeeMinor: row.registration_fee_minor ?? 0,
  };
}

function sabbaticalMatchesLeague(input: {
  originalLeagueId: number | null;
  currentLeagueId: number | null;
  predecessorLeagueId: number | null;
  leagueId: number;
}): boolean {
  return (
    input.currentLeagueId === input.predecessorLeagueId ||
    input.originalLeagueId === input.predecessorLeagueId ||
    input.currentLeagueId === input.leagueId ||
    input.originalLeagueId === input.leagueId
  );
}

function evaluateGuaranteeLabels(input: {
  priorities: LeaguePriorityInput[];
  desiredLeagueCount: number | null;
  mode: 'priority' | 'open';
  memberId: number;
  isReturningMember: boolean;
  participatedLeagueIds: ReadonlySet<number>;
  sabbaticals: Array<{ originalLeagueId: number | null; currentLeagueId: number | null; status: string }>;
  leaguesById: Map<
    number,
    {
      id: number;
      predecessorLeagueId: number | null;
      league: PriorityLeagueShape;
    }
  >;
  returnEligibleMemberIdsByLeagueId: ReadonlyMap<number, ReadonlySet<number>>;
}): Map<number, LeaguePriorityGuaranteeLabel> {
  const candidates: PriorityLabelCandidate[] = [...input.priorities]
    .sort((a, b) => a.priorityRank - b.priorityRank)
    .flatMap((priority) => {
      const leagueRow = input.leaguesById.get(priority.leagueId);
      if (!leagueRow) return [];
      const predecessorId = leagueRow.predecessorLeagueId;
      const sabbaticalRight = input.sabbaticals.some(
        (sabbatical) =>
          (ACTIVE_SABBATICAL_STATUSES as readonly string[]).includes(sabbatical.status) &&
          sabbaticalMatchesLeague({
            originalLeagueId: sabbatical.originalLeagueId,
            currentLeagueId: sabbatical.currentLeagueId,
            predecessorLeagueId: predecessorId,
            leagueId: leagueRow.id,
          }),
      );
      const hasReturnRight =
        input.mode === 'priority' &&
        input.isReturningMember &&
        predecessorId != null &&
        (input.participatedLeagueIds.has(predecessorId) || sabbaticalRight);
      const returnEligible = new Set(input.returnEligibleMemberIdsByLeagueId.get(priority.leagueId) ?? []);
      if (hasReturnRight) returnEligible.add(input.memberId);
      return [
        {
          leagueId: priority.leagueId,
          priorityRank: priority.priorityRank,
          hasReturnRight,
          rosterComplete: priorityRosterIsComplete(leagueRow.league, priority, input.memberId),
          rosterAllReturning: priorityRosterAllReturning(leagueRow.league, priority, returnEligible, input.memberId),
          feeMinor: leagueRow.league.registrationFeeMinor,
          allowsWaitlist: leagueRow.league.allowsWaitlist,
          isPlayInBased: leagueRow.league.isPlayInBased === true,
          isInstructional: leagueRow.league.format === 'instructional',
        },
      ];
    });

  const evaluation = labelPriorityEntries({
    candidates,
    desiredLeagueCount: input.desiredLeagueCount,
    mode: input.mode,
  });
  return new Map(evaluation.entries.map((entry) => [entry.leagueId, entry.label]));
}

export async function getStaffReturningPlayersQa(input: {
  actor: Member;
  sessionId: number;
  leagueId?: number;
}) {
  assertStaffAccess(input.actor);
  const { db, schema } = getDrizzleDb();

  const [session] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
      seasonId: schema.curlingSessions.season_id,
    })
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.id, input.sessionId))
    .limit(1);
  if (!session) {
    throw new RegistrationStaffValidationError({ sessionId: 'Session was not found.' });
  }

  const leaguesUnsorted = await db
    .select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      day_of_week: schema.leagues.day_of_week,
      session_id: schema.leagues.session_id,
      predecessor_league_id: schema.leagues.predecessor_league_id,
      league_type: schema.leagues.league_type,
      format: schema.leagues.format,
      waitlist_id: schema.leagues.waitlist_id,
      is_play_in_based: schema.leagues.is_play_in_based,
      registration_fee_minor: schema.leagues.registration_fee_minor,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.session_id, input.sessionId));
  const leaguesSorted = await sortLeaguesByDayOfWeekThenFirstDrawTime(db, schema, leaguesUnsorted);

  const leagues = leaguesSorted.map((league) => ({
    id: league.id,
    name: league.name,
    dayOfWeek: league.day_of_week,
    predecessorLeagueId: league.predecessor_league_id,
  }));

  const window = await getScheduleRegistrationWindow(session.seasonId, session.id);
  const registrationState = window?.state ?? 'closed';
  const labelMode: 'priority' | 'open' = registrationState === 'open' ? 'open' : 'priority';

  const empty = {
    sessionId: session.id,
    sessionName: session.name,
    registrationState,
    leagues,
    league: null as {
      id: number;
      name: string;
      dayOfWeek: number;
    } | null,
    predecessor: null as {
      id: number;
      name: string;
      sessionName: string | null;
    } | null,
    players: [] as Array<{
      memberId: number;
      memberName: string;
      memberEmail: string | null;
      isTemporarySabbaticalFill: boolean;
      status: ReturningPlayerQaStatus;
      priorityRank: number | null;
      guaranteeLabel: LeaguePriorityGuaranteeLabel | null;
      registrationId: number | null;
      registrationStatus: string | null;
    }>,
    counts: emptyReturningPlayerQaCounts(),
  };

  if (input.leagueId == null) {
    return empty;
  }

  const selected = leaguesSorted.find((league) => league.id === input.leagueId);
  if (!selected) {
    throw new RegistrationStaffValidationError({ leagueId: 'League was not found in this session.' });
  }

  empty.league = { id: selected.id, name: selected.name, dayOfWeek: selected.day_of_week };

  if (selected.predecessor_league_id == null) {
    return empty;
  }

  const [predecessor] = await db
    .select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      sessionName: schema.curlingSessions.name,
    })
    .from(schema.leagues)
    .leftJoin(schema.curlingSessions, eq(schema.leagues.session_id, schema.curlingSessions.id))
    .where(eq(schema.leagues.id, selected.predecessor_league_id))
    .limit(1);
  if (!predecessor) {
    return empty;
  }

  empty.predecessor = {
    id: predecessor.id,
    name: predecessor.name,
    sessionName: predecessor.sessionName,
  };

  const rosterRows = await db
    .select({
      memberId: schema.leagueRoster.member_id,
      isTemporarySabbaticalFill: schema.leagueRoster.is_temporary_sabbatical_fill,
      memberName: schema.members.name,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      email: schema.members.email,
    })
    .from(schema.leagueRoster)
    .innerJoin(schema.members, eq(schema.leagueRoster.member_id, schema.members.id))
    .where(
      and(
        eq(schema.leagueRoster.league_id, predecessor.id),
        inArray(schema.leagueRoster.status, [...ROSTERED_STATUSES]),
      ),
    );

  const memberIds = [...new Set(rosterRows.map((row) => row.memberId))];
  if (memberIds.length === 0) {
    return empty;
  }

  const registrationsByMemberId = await loadPickedRegistrationsByMemberId(db, schema, session.id, memberIds);

  const registrationIds = [...registrationsByMemberId.values()].map((row) => row.id);
  const prioritiesByRegistrationId = new Map<number, LeaguePriorityInput[]>();
  const selectionsByRegistrationId = new Map<number, Array<{ selectionType: string; leagueId: number | null }>>();

  if (registrationIds.length > 0) {
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

    const selectionRows = await db
      .select({
        registrationId: schema.registrationSelections.registration_id,
        selectionType: schema.registrationSelections.selection_type,
        leagueId: schema.registrationSelections.league_id,
      })
      .from(schema.registrationSelections)
      .where(inArray(schema.registrationSelections.registration_id, registrationIds));
    for (const row of selectionRows) {
      const list = selectionsByRegistrationId.get(row.registrationId) ?? [];
      list.push({ selectionType: row.selectionType, leagueId: row.leagueId });
      selectionsByRegistrationId.set(row.registrationId, list);
    }
  }

  const participatedByMemberId = new Map<number, Set<number>>();
  const participationRows = await db
    .select({
      memberId: schema.leagueRoster.member_id,
      leagueId: schema.leagueRoster.league_id,
    })
    .from(schema.leagueRoster)
    .where(
      and(inArray(schema.leagueRoster.member_id, memberIds), inArray(schema.leagueRoster.status, [...ROSTERED_STATUSES])),
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
    .where(inArray(schema.curlingLeagueSabbaticals.member_id, memberIds));
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
    ...new Set(leaguesSorted.map((league) => league.predecessor_league_id).filter((id): id is number => id != null)),
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
    for (const league of leaguesSorted) {
      if (league.predecessor_league_id == null) continue;
      returnEligibleMemberIdsByLeagueId.set(
        league.id,
        new Set(membersByPredecessorId.get(league.predecessor_league_id) ?? []),
      );
    }
  }

  const leaguesById = new Map(
    leaguesSorted.map((league) => [
      league.id,
      {
        id: league.id,
        predecessorLeagueId: league.predecessor_league_id,
        league: asPriorityLeague(league),
      },
    ]),
  );

  const counts = emptyReturningPlayerQaCounts();
  const players = rosterRows
    .map((row) => {
      const registration = registrationsByMemberId.get(row.memberId) ?? null;
      const priorities = registration ? (prioritiesByRegistrationId.get(registration.id) ?? []) : [];
      const selections = registration ? (selectionsByRegistrationId.get(registration.id) ?? []) : [];
      const guaranteeLabelByLeagueId =
        registration && priorities.length > 0
          ? evaluateGuaranteeLabels({
              priorities,
              desiredLeagueCount: registration.desiredLeagueCount,
              mode: labelMode,
              memberId: row.memberId,
              isReturningMember: registration.returningMemberAnswer === 1,
              participatedLeagueIds: participatedByMemberId.get(row.memberId) ?? new Set(),
              sabbaticals: sabbaticalsByMemberId.get(row.memberId) ?? [],
              leaguesById,
              returnEligibleMemberIdsByLeagueId,
            })
          : new Map<number, LeaguePriorityGuaranteeLabel>();
      const classified = classifyReturningPlayerQa({
        hasSubmittedRegistration: registration != null && isSubmittedStatus(registration.status),
        leagueId: selected.id,
        priorities,
        selections,
        guaranteeLabelByLeagueId,
      });
      counts[classified.status] += 1;
      return {
        memberId: row.memberId,
        memberName: memberName({
          name: row.memberName,
          first_name: row.firstName,
          last_name: row.lastName,
          email: row.email,
        }),
        memberEmail: row.email,
        isTemporarySabbaticalFill: row.isTemporarySabbaticalFill === 1,
        status: classified.status,
        priorityRank: classified.priorityRank,
        guaranteeLabel: classified.guaranteeLabel,
        registrationId: registration?.id ?? null,
        registrationStatus: registration?.status ?? null,
      };
    })
    .sort((a, b) => a.memberName.localeCompare(b.memberName) || a.memberId - b.memberId);

  return {
    ...empty,
    players,
    counts,
  };
}

export async function getStaffReturningMembersQa(input: { actor: Member; sessionId: number }) {
  assertStaffAccess(input.actor);
  const { db, schema } = getDrizzleDb();

  const [session] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
      seasonName: schema.curlingSeasons.name,
    })
    .from(schema.curlingSessions)
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
    .where(eq(schema.curlingSessions.id, input.sessionId))
    .limit(1);
  if (!session) {
    throw new RegistrationStaffValidationError({ sessionId: 'Session was not found.' });
  }

  const adjacent = await resolveAdjacentSessionsForLeagues(session.id);
  const empty = {
    sessionId: session.id,
    sessionName: session.name,
    predecessorSession: null as {
      id: number;
      name: string;
      seasonName: string | null;
    } | null,
    previousRosterCount: 0,
    members: [] as ReturningMemberQaRow[],
  };

  if (adjacent.previous == null) {
    return empty;
  }

  const [predecessorSession] = await db
    .select({
      id: schema.curlingSessions.id,
      name: schema.curlingSessions.name,
      seasonName: schema.curlingSeasons.name,
    })
    .from(schema.curlingSessions)
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
    .where(eq(schema.curlingSessions.id, adjacent.previous.id))
    .limit(1);

  empty.predecessorSession = {
    id: adjacent.previous.id,
    name: predecessorSession?.name ?? adjacent.previous.name,
    seasonName: predecessorSession?.seasonName ?? null,
  };

  const previousLeaguesUnsorted = await db
    .select({
      id: schema.leagues.id,
      name: schema.leagues.name,
      day_of_week: schema.leagues.day_of_week,
    })
    .from(schema.leagues)
    .where(eq(schema.leagues.session_id, adjacent.previous.id));
  const previousLeagues = await sortLeaguesByDayOfWeekThenFirstDrawTime(db, schema, previousLeaguesUnsorted);
  if (previousLeagues.length === 0) {
    return empty;
  }

  const previousLeaguesById = new Map(
    previousLeagues.map((league) => [
      league.id,
      { id: league.id, name: league.name, dayOfWeek: league.day_of_week },
    ]),
  );

  const rosterRows = await db
    .select({
      memberId: schema.leagueRoster.member_id,
      leagueId: schema.leagueRoster.league_id,
      memberName: schema.members.name,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      email: schema.members.email,
    })
    .from(schema.leagueRoster)
    .innerJoin(schema.members, eq(schema.leagueRoster.member_id, schema.members.id))
    .where(
      and(
        inArray(
          schema.leagueRoster.league_id,
          previousLeagues.map((league) => league.id),
        ),
        inArray(schema.leagueRoster.status, [...ROSTERED_STATUSES]),
      ),
    );

  const memberIds = [...new Set(rosterRows.map((row) => row.memberId))];
  const registrationsByMemberId = await loadPickedRegistrationsByMemberId(db, schema, session.id, memberIds);
  const members = buildReturningMembersQaRows({
    roster: rosterRows.flatMap((row) => {
      const league = previousLeaguesById.get(row.leagueId);
      if (!league) return [];
      return [
        {
          memberId: row.memberId,
          memberName: memberName({
            name: row.memberName,
            first_name: row.firstName,
            last_name: row.lastName,
            email: row.email,
          }),
          memberEmail: row.email,
          league,
        },
      ];
    }),
    registrationsByMemberId,
  });

  return {
    ...empty,
    previousRosterCount: memberIds.length,
    members,
  };
}
