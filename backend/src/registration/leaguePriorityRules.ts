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

/** Minimum players (linked members + pending names) required to declare a play-in team. */
export const MIN_PLAY_IN_ROSTER_SIZE = 2;

/** Derived guarantee label for a priority list entry. Never stored. */
export type LeaguePriorityGuaranteeLabel =
  | 'guaranteed_return'
  | 'guaranteed_fallback'
  | 'waitlisted'
  | 'subject_to_availability';

export const LEAGUE_PRIORITY_GUARANTEE_LABEL_TEXT: Record<LeaguePriorityGuaranteeLabel, string> = {
  guaranteed_return: 'Guaranteed return',
  guaranteed_fallback: 'Guaranteed fallback',
  waitlisted: 'Waitlisted',
  subject_to_availability: 'Subject to availability',
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

export function resolveDesiredLeagueCount(value: number | null | undefined): number {
  if (value == null) return 0;
  return Math.max(0, Math.min(MAX_DESIRED_LEAGUE_COUNT, Math.trunc(value)));
}

export function guaranteeBudgetFor(desiredLeagueCount: number, sabbaticalClaimCount: number): number {
  return Math.min(Math.max(0, MAX_PROTECTED_CLAIMS - sabbaticalClaimCount), resolveDesiredLeagueCount(desiredLeagueCount));
}

/**
 * Assigns a guarantee label to every entry on the list.
 *
 * A return right in the top two spots earns `guaranteed_return`. A registrant
 * who could not fill both of those spots keeps the unused guarantee and may
 * spend it further down the list as a `guaranteed_fallback` — but never on a
 * play-in league, which sends a team that misses the bar to playdowns rather
 * than into a held spot. Everything left over is waitlisted where the league
 * has a waitlist, and otherwise simply subject to availability.
 */
export function labelPriorityEntries(input: {
  candidates: PriorityLabelCandidate[];
  desiredLeagueCount: number | null | undefined;
  sabbaticalClaimCount?: number;
}): PriorityLabelResult {
  const desiredLeagueCount = resolveDesiredLeagueCount(input.desiredLeagueCount);
  const budget = guaranteeBudgetFor(desiredLeagueCount, input.sabbaticalClaimCount ?? 0);
  const entries: LabeledPriorityEntry[] = [...input.candidates]
    .sort((a, b) => a.priorityRank - b.priorityRank)
    .map((candidate) => ({ ...candidate, label: 'subject_to_availability' as const, guaranteed: false }));

  let granted = 0;

  for (const entry of entries) {
    if (entry.priorityRank > MAX_PROTECTED_CLAIMS) break;
    if (granted >= budget) break;
    if (!entry.hasReturnRight || !entry.rosterComplete) continue;
    entry.label = 'guaranteed_return';
    entry.guaranteed = true;
    granted += 1;
  }

  if (granted < MAX_PROTECTED_CLAIMS) {
    for (const entry of entries) {
      if (entry.priorityRank <= MAX_PROTECTED_CLAIMS) continue;
      if (granted >= budget) break;
      if (!entry.hasReturnRight || !entry.rosterComplete) continue;
      if (entry.isPlayInBased) continue;
      entry.label = 'guaranteed_fallback';
      entry.guaranteed = true;
      granted += 1;
    }
  }

  for (const entry of entries) {
    if (entry.guaranteed) continue;
    entry.label = entry.allowsWaitlist ? 'waitlisted' : 'subject_to_availability';
  }

  const confirmedLeagueFeeMinor = entries
    .filter((entry) => entry.guaranteed)
    .reduce((total, entry) => total + entry.feeMinor, 0);

  const remainingSlots = Math.max(0, desiredLeagueCount - granted);
  const maximumLeagueFeeMinor =
    confirmedLeagueFeeMinor +
    entries
      .filter((entry) => !entry.guaranteed)
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
