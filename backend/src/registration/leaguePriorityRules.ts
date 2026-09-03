/**
 * The parts of league priority evaluation that the registration page and the
 * server must agree on exactly: the play-in ordering clamp, the roster
 * arithmetic, and the guarantee-label algorithm.
 *
 * This module is imported by the browser, so it must stay free of database,
 * config, and other Node-only dependencies. Anything that needs to look up
 * sabbaticals or prior seasons lives in `leaguePriorityEvaluation.ts` and feeds
 * its answer in through `hasReturnRight`.
 */

/** Upper bound for `curling_registrations.desired_league_count`. */
export const MAX_DESIRED_LEAGUE_COUNT = 5;

/** Most guaranteed spots (returns + fallbacks + sabbaticals) any registrant may hold. */
export const MAX_PROTECTED_CLAIMS = 2;

/** Most leagues a registrant may hold on sabbatical at the same time. */
export const MAX_SIMULTANEOUS_SABBATICALS = 2;

/** Minimum players (linked members + pending names) required to declare a play-in team. */
export const MIN_PLAY_IN_ROSTER_SIZE = 2;

/** Derived guarantee label for a priority list entry. Never stored. */
export type LeaguePriorityGuaranteeLabel =
  | 'guaranteed_return'
  | 'awaiting_roster_entry'
  | 'guaranteed_fallback'
  | 'available'
  | 'temporary_spot_available'
  | 'waitlisted'
  | 'subject_to_availability'
  | 'superfluous';

export const LEAGUE_PRIORITY_GUARANTEE_LABEL_TEXT: Record<LeaguePriorityGuaranteeLabel, string> = {
  guaranteed_return: 'Guaranteed return',
  awaiting_roster_entry: 'Awaiting roster entry',
  guaranteed_fallback: 'Guaranteed fallback',
  available: 'Available',
  temporary_spot_available: 'Temporary spot available',
  waitlisted: 'Waitlisted',
  subject_to_availability: 'Subject to availability',
  superfluous: 'Superfluous',
};

/** Product-facing chip text. Play-in guarantees are entry, not a returning-member hold. */
export function leaguePriorityGuaranteeLabelText(
  label: LeaguePriorityGuaranteeLabel,
  league?: { isPlayInBased?: boolean } | null,
): string {
  if (label === 'guaranteed_return' && league?.isPlayInBased === true) {
    return 'Guaranteed entry';
  }
  return LEAGUE_PRIORITY_GUARANTEE_LABEL_TEXT[label];
}

/** How labels are derived. Priority uses return rights; open uses live vacancies. */
export type PriorityLabelMode = 'priority' | 'open';

export type PriorityLeagueShape = {
  leagueType: 'standard' | 'bring_your_own_team';
  format: 'teams' | 'doubles' | 'instructional';
  allowsWaitlist: boolean;
  isPlayInBased?: boolean;
  registrationFeeMinor: number;
};

export type PriorityRosterShape = {
  byotTeammateText?: string | null;
  teamRosterPlacements?: Array<{ memberId: number }> | null;
};

export type RankedPriority = PriorityRosterShape & {
  leagueId: number;
  priorityRank: number;
};

export function expectedByotRosterSize(league: Pick<PriorityLeagueShape, 'format'>): number | null {
  if (league.format === 'teams') return 4;
  if (league.format === 'doubles') return 2;
  return null;
}

/**
 * Whether a draft roster can join an existing incomplete play-in team: the team
 * still has an open slot, and every account-linked member on that team is named
 * in the draft (the registrant plus declared teammates).
 */
export function playInDraftJoinsIncompleteTeam(input: {
  teamSize: number;
  teamMemberCount: number;
  teamMemberIds: Array<number | null | undefined>;
  draftMemberIds: Iterable<number>;
}): boolean {
  if (input.teamSize <= 0 || input.teamMemberCount >= input.teamSize) return false;
  const accountIds = input.teamMemberIds.filter((id): id is number => id != null);
  if (accountIds.length === 0) return false;
  const draft = input.draftMemberIds instanceof Set ? input.draftMemberIds : new Set(input.draftMemberIds);
  return accountIds.every((id) => draft.has(id));
}

export function pendingRosterNames(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Counts a priority entry's declared team. The registrant always occupies a
 * roster spot whether or not the client echoed them back in the placements.
 */
export function countPriorityRoster(
  priority: PriorityRosterShape,
  registrantMemberId?: number | null,
): { memberCount: number; pendingCount: number; total: number } {
  const memberIds = new Set((priority.teamRosterPlacements ?? []).map((placement) => placement.memberId));
  const pendingCount = pendingRosterNames(priority.byotTeammateText).length;
  if (registrantMemberId != null && (memberIds.size > 0 || pendingCount > 0)) {
    memberIds.add(registrantMemberId);
  }
  return { memberCount: memberIds.size, pendingCount, total: memberIds.size + pendingCount };
}

export function priorityHasDeclaredRoster(priority: PriorityRosterShape): boolean {
  return (priority.teamRosterPlacements?.length ?? 0) > 0 || pendingRosterNames(priority.byotTeammateText).length > 0;
}

/** Account-linked teammates only. A free-text name is not a linked roster. */
export function priorityHasLinkedMemberRoster(priority: PriorityRosterShape): boolean {
  return (priority.teamRosterPlacements?.length ?? 0) > 0;
}

/**
 * Drop and sabbatical answers only apply to leagues left off the list. A league
 * that is on the priority list is being kept, so a leftover leave-behind
 * decision for it is stale — for example after last-session leagues are
 * re-seeded onto an empty saved list.
 */
export function omitLeaveBehindDecisionsForListedLeagues<T extends { leagueId?: number | null }>(
  decisions: T[],
  priorities: Array<{ leagueId: number }>,
): T[] {
  const listed = new Set(priorities.map((priority) => priority.leagueId));
  return decisions.filter((decision) => decision.leagueId == null || !listed.has(decision.leagueId));
}

export function omitLeaveBehindSelectionsForListedLeagues<
  T extends { leagueId?: number | null; selectionType: string },
>(selections: T[], priorities: Array<{ leagueId: number }>): T[] {
  const listed = new Set(priorities.map((priority) => priority.leagueId));
  return selections.filter((selection) => {
    if (selection.selectionType !== 'drop' && selection.selectionType !== 'sabbatical') return true;
    return selection.leagueId == null || !listed.has(selection.leagueId);
  });
}

/** Whether a league needs a full declared team before it can be guaranteed. */
export function priorityRosterIsComplete(
  league: PriorityLeagueShape,
  priority: PriorityRosterShape,
  registrantMemberId?: number | null,
): boolean {
  if (league.leagueType !== 'bring_your_own_team' && !league.isPlayInBased) return true;
  const expectedSize = expectedByotRosterSize(league);
  if (expectedSize == null) return false;
  return countPriorityRoster(priority, registrantMemberId).total === expectedSize;
}

/**
 * Bring-your-own-team guaranteed return is a team right: every declared player
 * must themselves hold a return right for the league. Free-text pending names
 * never count as returning. Play-in leagues use the TLINE bar instead, so this
 * always returns true for them and for standard leagues.
 *
 * When the roster is still incomplete, this answers whether everyone named so
 * far is returning — used to decide between "awaiting roster" and waitlisted.
 */
export function priorityRosterAllReturning(
  league: PriorityLeagueShape,
  priority: PriorityRosterShape,
  returnEligibleMemberIds: ReadonlySet<number>,
  registrantMemberId?: number | null,
): boolean {
  if (league.leagueType !== 'bring_your_own_team' || league.isPlayInBased) return true;
  if (pendingRosterNames(priority.byotTeammateText).length > 0) return false;

  const memberIds = new Set((priority.teamRosterPlacements ?? []).map((placement) => placement.memberId));
  if (registrantMemberId != null) memberIds.add(registrantMemberId);
  if (memberIds.size === 0) return registrantMemberId != null && returnEligibleMemberIds.has(registrantMemberId);

  for (const memberId of memberIds) {
    if (!returnEligibleMemberIds.has(memberId)) return false;
  }
  return true;
}

/** Member ids on a teammate's declared BYOT pair, when this registrant was listed. */
export function memberIdsFromExistingByotTeam(input: {
  onExistingTeam?: boolean;
  existingTeamMemberIds?: number[] | null;
  existingTeam?: { members?: Array<{ memberId?: number | null } | null> | null } | null;
} | null | undefined): number[] | undefined {
  if (!input?.onExistingTeam) return undefined;
  if (input.existingTeamMemberIds && input.existingTeamMemberIds.length > 0) {
    return input.existingTeamMemberIds;
  }
  const fromMembers = (input.existingTeam?.members ?? [])
    .map((member) => member?.memberId)
    .filter((id): id is number => id != null);
  return fromMembers.length > 0 ? fromMembers : undefined;
}

/**
 * When the registrant was listed on someone else's BYOT team and has not
 * linked any teammates locally, label from that existing team's members.
 * Free-text pending names (for example typing the partner who already listed
 * them) must not block this, or the pair is waitlisted as a mixed team.
 */
export function overlayExistingByotTeamRoster(
  priority: PriorityRosterShape,
  existingTeamMemberIds: number[] | undefined,
  registrantMemberId?: number | null,
): PriorityRosterShape {
  if (priorityHasLinkedMemberRoster(priority)) return priority;
  if (!existingTeamMemberIds?.length) return priority;
  const teamRosterPlacements = existingTeamMemberIds
    .filter((memberId) => registrantMemberId == null || memberId !== registrantMemberId)
    .map((memberId) => ({ memberId }));
  if (teamRosterPlacements.length === 0) return priority;
  return { ...priority, teamRosterPlacements, byotTeammateText: null };
}

/** Copies last-session or existing-team member ids onto empty priority rosters. */
export function applyMemberIdsToEmptyPriorityRosters<T extends RankedPriority>(
  priorities: T[],
  memberIdsByLeagueId: Record<number, number[]> | undefined,
): T[] {
  if (!memberIdsByLeagueId) return priorities;
  let changed = false;
  const next = priorities.map((priority) => {
    if (priorityHasDeclaredRoster(priority)) return priority;
    const ids = memberIdsByLeagueId[priority.leagueId] ?? [];
    if (ids.length === 0) return priority;
    changed = true;
    return {
      ...priority,
      teamRosterPlacements: ids.map((memberId) => ({ memberId })),
      byotTeammateText: null,
    };
  });
  return changed ? next : priorities;
}

// ---------------------------------------------------------------------------
// Play-in ordering
// ---------------------------------------------------------------------------

function isPlayInBasedLeague(league: PriorityLeagueShape | undefined): boolean {
  return league?.isPlayInBased === true;
}

/**
 * Play-in leagues must outrank every other league, because a play-in team is
 * committed as a unit and cannot sit behind a league that might displace it.
 * Bring-your-own-team leagues that are not play-in based may sit anywhere.
 * Stable within each block so the registrant's relative ordering survives.
 */
export function clampPriorityOrder<T extends RankedPriority>(
  priorities: T[],
  leagues: Record<number, PriorityLeagueShape | undefined>,
): T[] {
  const sorted = [...priorities].sort((a, b) => a.priorityRank - b.priorityRank);
  const playIn = sorted.filter((priority) => isPlayInBasedLeague(leagues[priority.leagueId]));
  const other = sorted.filter((priority) => !isPlayInBasedLeague(leagues[priority.leagueId]));
  return [...playIn, ...other].map((priority, index) => ({ ...priority, priorityRank: index + 1 }));
}

export function isPriorityOrderClamped(
  priorities: RankedPriority[],
  leagues: Record<number, PriorityLeagueShape | undefined>,
): boolean {
  const sorted = [...priorities].sort((a, b) => a.priorityRank - b.priorityRank);
  let seenOther = false;
  for (const priority of sorted) {
    if (isPlayInBasedLeague(leagues[priority.leagueId])) {
      if (seenOther) return false;
    } else {
      seenOther = true;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Guarantee labeling
// ---------------------------------------------------------------------------

export type PriorityLabelCandidate = {
  leagueId: number;
  priorityRank: number;
  /** The registrant holds a return right for this league, ignoring rank and budget. */
  hasReturnRight: boolean;
  /** Declared team is the full league team size. Always true for non-team leagues. */
  rosterComplete: boolean;
  /**
   * Every declared BYOT player holds a return right for this league. Always true
   * for standard and play-in leagues. When the roster is incomplete, true means
   * everyone named so far is still returning.
   */
  rosterAllReturning: boolean;
  feeMinor: number;
  allowsWaitlist: boolean;
  isPlayInBased: boolean;
  /**
   * Waitlist length is strictly below remaining open spots. Used in open
   * registration, and for instructional programs in every registration state.
   */
  hasVacancies?: boolean;
  /**
   * A sabbatical has left a temporary fill vacancy. Registration never places
   * those spots; they are offered only through the waitlist.
   */
  hasTemporaryFillVacancy?: boolean;
  /**
   * Play-in team cleared the TLINE bar. Used in open registration so a miss is
   * not labeled Available just because the league still has roster room.
   */
  playInGuaranteed?: boolean;
  /**
   * Instructional programs use live vacancies in both priority and open
   * registration: space remaining is Available and billed now; full is subject
   * to availability and payment waits.
   */
  isInstructional?: boolean;
};

export type LabeledPriorityEntry = PriorityLabelCandidate & {
  label: LeaguePriorityGuaranteeLabel;
  guaranteed: boolean;
};

export type PriorityLabelResult = {
  desiredLeagueCount: number;
  guaranteeBudget: number;
  entries: LabeledPriorityEntry[];
  guaranteedCount: number;
  /** League fees the registrant is committed to today. */
  confirmedLeagueFeeMinor: number;
  /**
   * Upper bound on league fees: the confirmed total plus the most expensive
   * remaining entries, up to the desired league count. Most expensive rather
   * than next-by-priority so the quoted ceiling is never exceeded.
   */
  maximumLeagueFeeMinor: number;
};

export function isGuaranteedLabel(label: LeaguePriorityGuaranteeLabel): boolean {
  return label === 'guaranteed_return' || label === 'guaranteed_fallback';
}

/**
 * A league has vacancies when current waitlist demand is strictly below the
 * remaining open spots. Open spots already subtract roster placements,
 * sabbaticals, and earmarked priority-list demand that is not yet on the
 * roster or waitlist. Missing counts are treated as zero so we do not
 * over-promise availability.
 */
export function leagueHasVacancies(league: {
  activeWaitlistEntryCount?: number | null;
  openSpotCount?: number | null;
} | undefined): boolean {
  if (!league) return false;
  return (league.activeWaitlistEntryCount ?? 0) < (league.openSpotCount ?? 0);
}

/** A sabbatical has left at least one unfilled temporary spot. */
export function leagueHasTemporaryFillVacancy(league: {
  temporarySabbaticalFillVacancyCount?: number | null;
} | undefined): boolean {
  return (league?.temporarySabbaticalFillVacancyCount ?? 0) > 0;
}

/**
 * Leagues billed today: protected guarantees, open-registration available
 * spots, and instructional programs with remaining space. Subject-to-availability
 * entries — including no-waitlist leftovers and a third league below two
 * guarantees — stay unconfirmed until staff places them. Temporary sabbatical-fill
 * vacancies are never billed or placed from this list.
 */
export function isImmediateChargeEntry(entry: LabeledPriorityEntry): boolean {
  return entry.guaranteed || entry.label === 'available';
}

/**
 * Guaranteed entries are always billed. Available entries fill remaining
 * desired-count slots in rank order, and only among ranks at or above the
 * desired count so backups below that line stay off the floor.
 */
export function immediateChargeEntries(
  result: Pick<PriorityLabelResult, 'entries' | 'desiredLeagueCount'>,
): LabeledPriorityEntry[] {
  const guaranteed = result.entries.filter((entry) => entry.guaranteed);
  const remaining = Math.max(0, result.desiredLeagueCount - guaranteed.length);
  const availableNow = result.entries.filter(
    (entry) => isImmediateChargeEntry(entry) && !entry.guaranteed && entry.priorityRank <= result.desiredLeagueCount,
  );
  return [...guaranteed, ...availableNow.slice(0, remaining)].sort(
    (left, right) => left.priorityRank - right.priorityRank,
  );
}

export function resolveDesiredLeagueCount(value: number | null | undefined): number {
  if (value == null) return 0;
  return Math.max(0, Math.min(MAX_DESIRED_LEAGUE_COUNT, Math.trunc(value)));
}

export function guaranteeBudgetFor(desiredLeagueCount: number): number {
  return Math.min(MAX_PROTECTED_CLAIMS, resolveDesiredLeagueCount(desiredLeagueCount));
}

/**
 * An entry that already counts toward the desired league count: a held
 * guarantee or an available spot. Those are confirmed placements.
 * Subject-to-availability leftovers are unconfirmed, so they do not fill a
 * slot — later rows stay valid backups. Waitlists, incomplete rosters,
 * play-in misses, and temporary sabbatical-fill vacancies also do not
 * secure a slot.
 */
function entrySecuresDesiredSlot(entry: LabeledPriorityEntry): boolean {
  return entry.guaranteed || entry.label === 'available';
}

/**
 * Anything below a confirmed fill of the desired count cannot be placed, billed,
 * or waitlisted. Relabel those rows so the registrant can remove them or move
 * them higher (for example to try a switch with guaranteed fallback).
 */
function markSuperfluousEntries(entries: LabeledPriorityEntry[], desiredLeagueCount: number): void {
  let secured = 0;
  for (const entry of entries) {
    if (secured >= desiredLeagueCount) {
      entry.label = 'superfluous';
      entry.guaranteed = false;
      continue;
    }
    if (entrySecuresDesiredSlot(entry)) secured += 1;
  }
}

/**
 * Assigns a guarantee label to every entry on the list.
 *
 * A return right in the top two spots earns `guaranteed_return` once the roster
 * is complete and — for bring-your-own-team leagues — every declared player is
 * themselves returning. A BYOT entry that still has the registrant's return
 * right but an incomplete all-returning roster, or a play-in entry whose team
 * is not yet fully declared, shows `awaiting_roster_entry` instead of
 * waitlisted or subject to availability. Naming a non-returning BYOT teammate
 * (or a free-text pending name) ends that awaiting state and the entry goes on
 * the waitlist like any other non-guaranteed request. Awaiting labels do not
 * consume budget, bill, or fill a desired-count slot.
 *
 * A registrant who could not fill both of the top spots keeps the unused
 * guarantee and may spend it further down the list as a `guaranteed_fallback`
 * — but never on a play-in league, which sends a team that misses the bar to
 * playdowns rather than into a held spot.
 *
 * Leftovers join a waitlist while fewer than two guarantees sit above them —
 * including waitlists at rank 3+ that sit above a fallback further down the
 * list. Counting total grants (including those later fallbacks) would label
 * the leftover subject to availability and then mark the fallback superfluous.
 * Once two spots above are already guaranteed, extra leagues further down the
 * list are subject to availability even if the league has a waitlist. Those
 * leftovers do not consume the guarantee budget, and they are not billed or
 * rostered until staff confirms placement.
 * Instructional programs ignore that leftover rule: remaining space is
 * Available and billed now; a full program is subject to availability and
 * payment waits.
 *
 * Once guaranteed spots plus available entries already fill
 * the desired league count, every later entry is `superfluous`. Those rows
 * are not waitlisted or billed. Subject-to-availability leftovers do not fill
 * the count, so extra rows remain backups while confirmed placements are still
 * short of the number wanted. A registrant can still add a league and move it
 * above a guaranteed spot to try a switch with fallback; until they do, extra
 * rows below an already-filled count block continue.
 *
 * Sabbaticals do not consume this budget. A registrant may hold two guaranteed
 * priority spots and still take sabbatical from other prior leagues.
 */
function labelInstructionalByVacancies(entry: LabeledPriorityEntry): void {
  if (entry.hasVacancies) {
    entry.label = 'available';
    return;
  }
  entry.label = 'subject_to_availability';
}

function labelOpenRegistrationEntries(entries: LabeledPriorityEntry[], desiredLeagueCount: number): void {
  const availableBudget = guaranteeBudgetFor(desiredLeagueCount);
  let availableGranted = 0;

  for (const entry of entries) {
    entry.guaranteed = false;
    if (entry.isPlayInBased && !entry.rosterComplete) {
      entry.label = 'awaiting_roster_entry';
      continue;
    }
    if (entry.isPlayInBased && entry.rosterComplete && entry.playInGuaranteed !== true) {
      entry.label = 'subject_to_availability';
      continue;
    }
    if (entry.isInstructional) {
      labelInstructionalByVacancies(entry);
      continue;
    }
    if (entry.hasVacancies) {
      if (availableGranted < availableBudget) {
        entry.label = 'available';
        availableGranted += 1;
        continue;
      }
      if (desiredLeagueCount >= 3) {
        entry.label = 'subject_to_availability';
        continue;
      }
    }
    entry.label = 'waitlisted';
  }
}

export function labelPriorityEntries(input: {
  candidates: PriorityLabelCandidate[];
  desiredLeagueCount: number | null | undefined;
  mode?: PriorityLabelMode;
}): PriorityLabelResult {
  const desiredLeagueCount = resolveDesiredLeagueCount(input.desiredLeagueCount);
  const budget = guaranteeBudgetFor(desiredLeagueCount);
  const entries: LabeledPriorityEntry[] = [...input.candidates]
    .sort((a, b) => a.priorityRank - b.priorityRank)
    .map((candidate) => ({ ...candidate, label: 'subject_to_availability' as const, guaranteed: false }));

  let granted = 0;

  if (input.mode === 'open') {
    labelOpenRegistrationEntries(entries, desiredLeagueCount);
  } else {
    for (const entry of entries) {
      if (entry.priorityRank > MAX_PROTECTED_CLAIMS) break;
      if (granted >= budget) break;
      if (!entry.hasReturnRight) continue;
      if (!entry.rosterComplete) {
        // Still a return right — just waiting on an all-returning declared team.
        if (entry.rosterAllReturning) {
          entry.label = 'awaiting_roster_entry';
        }
        continue;
      }
      if (!entry.rosterAllReturning) continue;
      entry.label = 'guaranteed_return';
      entry.guaranteed = true;
      granted += 1;
    }

    if (granted < MAX_PROTECTED_CLAIMS) {
      for (const entry of entries) {
        if (entry.priorityRank <= MAX_PROTECTED_CLAIMS) continue;
        if (granted >= budget) break;
        if (!entry.hasReturnRight || !entry.rosterComplete || !entry.rosterAllReturning) continue;
        if (entry.isPlayInBased) continue;
        entry.label = 'guaranteed_fallback';
        entry.guaranteed = true;
        granted += 1;
      }
    }

    for (const entry of entries) {
      if (entry.guaranteed) continue;
      if (entry.label === 'awaiting_roster_entry') continue;
      // Play-in teams with an incomplete declared roster are still assembling —
      // same awaiting chip as an incomplete returning BYOT team.
      if (entry.isPlayInBased && !entry.rosterComplete) {
        entry.label = 'awaiting_roster_entry';
        continue;
      }
      if (entry.isInstructional) {
        labelInstructionalByVacancies(entry);
        continue;
      }
      // Waitlists fill protected spots. Count guarantees above this leftover,
      // not later fallbacks: a rank-3 waitlist above a rank-4 fallback is still
      // switching into a higher league. Once two spots above are guaranteed,
      // ranks below that are subject to availability even when the league has
      // a waitlist.
      const guaranteesAbove = entries.filter(
        (other) => other.guaranteed && other.priorityRank < entry.priorityRank,
      ).length;
      const waitlistToFillProtectedSpots = entry.allowsWaitlist && guaranteesAbove < MAX_PROTECTED_CLAIMS;
      entry.label = waitlistToFillProtectedSpots ? 'waitlisted' : 'subject_to_availability';
    }
  }

  markSuperfluousEntries(entries, desiredLeagueCount);

  const charged = immediateChargeEntries({ entries, desiredLeagueCount });
  const chargedLeagueIds = new Set(charged.map((entry) => entry.leagueId));
  const confirmedLeagueFeeMinor = charged.reduce((total, entry) => total + entry.feeMinor, 0);

  const remainingSlots = Math.max(0, desiredLeagueCount - charged.length);
  const maximumLeagueFeeMinor =
    confirmedLeagueFeeMinor +
    entries
      .filter((entry) => !chargedLeagueIds.has(entry.leagueId) && entry.label !== 'superfluous')
      .map((entry) => entry.feeMinor)
      .sort((a, b) => b - a)
      .slice(0, remainingSlots)
      .reduce((total, fee) => total + fee, 0);

  return {
    desiredLeagueCount,
    guaranteeBudget: budget,
    entries,
    guaranteedCount: granted,
    confirmedLeagueFeeMinor,
    maximumLeagueFeeMinor,
  };
}
