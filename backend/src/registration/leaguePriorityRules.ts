/**
 * The parts of league priority evaluation that the registration page and the
 * server must agree on exactly: the bring-your-own-team ordering clamp, the
 * roster arithmetic, and the guarantee-label algorithm.
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
  | 'waitlisted'
  | 'subject_to_availability'
  | 'superfluous';

export const LEAGUE_PRIORITY_GUARANTEE_LABEL_TEXT: Record<LeaguePriorityGuaranteeLabel, string> = {
  guaranteed_return: 'Guaranteed return',
  awaiting_roster_entry: 'Awaiting roster entry',
  guaranteed_fallback: 'Guaranteed fallback',
  waitlisted: 'Waitlisted',
  subject_to_availability: 'Subject to availability',
  superfluous: 'Superfluous',
};

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

// ---------------------------------------------------------------------------
// Bring-your-own-team ordering
// ---------------------------------------------------------------------------

function isByotLeague(league: PriorityLeagueShape | undefined): boolean {
  return league?.leagueType === 'bring_your_own_team';
}

/**
 * Bring-your-own-team leagues must outrank every standard league, because a team
 * roster is committed as a unit and cannot sit behind a league that might
 * displace it. Stable within each block so the registrant's relative ordering
 * survives.
 */
export function clampPriorityOrder<T extends RankedPriority>(
  priorities: T[],
  leagues: Record<number, PriorityLeagueShape | undefined>,
): T[] {
  const sorted = [...priorities].sort((a, b) => a.priorityRank - b.priorityRank);
  const byot = sorted.filter((priority) => isByotLeague(leagues[priority.leagueId]));
  const standard = sorted.filter((priority) => !isByotLeague(leagues[priority.leagueId]));
  return [...byot, ...standard].map((priority, index) => ({ ...priority, priorityRank: index + 1 }));
}

export function isPriorityOrderClamped(
  priorities: RankedPriority[],
  leagues: Record<number, PriorityLeagueShape | undefined>,
): boolean {
  const sorted = [...priorities].sort((a, b) => a.priorityRank - b.priorityRank);
  let seenStandard = false;
  for (const priority of sorted) {
    if (isByotLeague(leagues[priority.leagueId])) {
      if (seenStandard) return false;
    } else {
      seenStandard = true;
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
 * Leagues billed today: protected guarantees, plus non-waitlist leagues we
 * assume have room. Play-in entries that missed the bar stay unlabeled as
 * subject to availability but are not charged until placement settles.
 */
export function isImmediateChargeEntry(entry: LabeledPriorityEntry): boolean {
  if (entry.guaranteed) return true;
  return entry.label === 'subject_to_availability' && !entry.isPlayInBased;
}

/**
 * Guaranteed entries are always billed. Subject-to-availability entries fill
 * remaining desired-count slots in rank order, and only among ranks at or
 * above the desired count so backups below that line stay off the floor.
 */
export function immediateChargeEntries(
  result: Pick<PriorityLabelResult, 'entries' | 'desiredLeagueCount'>,
): LabeledPriorityEntry[] {
  const guaranteed = result.entries.filter((entry) => entry.guaranteed);
  const remaining = Math.max(0, result.desiredLeagueCount - guaranteed.length);
  const subjectToAvailability = result.entries.filter(
    (entry) => isImmediateChargeEntry(entry) && !entry.guaranteed && entry.priorityRank <= result.desiredLeagueCount,
  );
  return [...guaranteed, ...subjectToAvailability.slice(0, remaining)].sort(
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
 * guarantee, a roster still being completed for a potential guarantee, or a
 * billed subject-to-availability league. Waitlists and play-in misses do not
 * secure a slot, so later entries can still be necessary.
 */
function entrySecuresDesiredSlot(entry: LabeledPriorityEntry): boolean {
  if (entry.guaranteed || entry.label === 'awaiting_roster_entry') return true;
  return entry.label === 'subject_to_availability' && !entry.isPlayInBased;
}

/**
 * Anything below an already-filled desired count cannot be placed, billed, or
 * waitlisted. Relabel those rows so the registrant can remove them or move
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
 * consume budget or bill.
 *
 * A registrant who could not fill both of the top spots keeps the unused
 * guarantee and may spend it further down the list as a `guaranteed_fallback`
 * — but never on a play-in league, which sends a team that misses the bar to
 * playdowns rather than into a held spot.
 *
 * Leftovers join a waitlist only while fewer than two spots are guaranteed, or
 * when the leftover sits in the top two ranks (trying to switch into a higher
 * league while holding a fallback). Once two spots are already guaranteed,
 * extra leagues further down the list are subject to availability even if the
 * league has a waitlist. Subject-to-availability leagues (except play-in
 * misses) are billed now and do not consume the guarantee budget.
 *
 * Once guaranteed spots plus billed subject-to-availability entries already
 * fill the desired league count, every later entry is `superfluous`. Those
 * rows are not waitlisted or billed. A registrant can still add a league and
 * move it above a guaranteed spot to try a switch with fallback; until they
 * do, the extra row blocks continue.
 *
 * Sabbaticals do not consume this budget. A registrant may hold two guaranteed
 * priority spots and still take sabbatical from other prior leagues.
 */
export function labelPriorityEntries(input: {
  candidates: PriorityLabelCandidate[];
  desiredLeagueCount: number | null | undefined;
}): PriorityLabelResult {
  const desiredLeagueCount = resolveDesiredLeagueCount(input.desiredLeagueCount);
  const budget = guaranteeBudgetFor(desiredLeagueCount);
  const entries: LabeledPriorityEntry[] = [...input.candidates]
    .sort((a, b) => a.priorityRank - b.priorityRank)
    .map((candidate) => ({ ...candidate, label: 'subject_to_availability' as const, guaranteed: false }));

  let granted = 0;

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
    // Waitlists fill protected spots. Rank 1–2 leftovers can still waitlist
    // (switch-with-fallback). Once two guarantees are granted, ranks 3+ are
    // subject to availability even when the league has a waitlist.
    const waitlistToFillProtectedSpots =
      entry.allowsWaitlist &&
      (granted < MAX_PROTECTED_CLAIMS || entry.priorityRank <= MAX_PROTECTED_CLAIMS);
    entry.label = waitlistToFillProtectedSpots ? 'waitlisted' : 'subject_to_availability';
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
