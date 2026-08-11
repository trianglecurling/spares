/**
 * Client half of the league priority model. The guarantee-label algorithm and
 * the bring-your-own-team ordering clamp are imported from the same module the
 * server uses, so the chips the registrant sees while reordering cannot drift
 * from the labels the server assigns on save.
 */
import {
  clampPriorityOrder,
  countPriorityRoster,
  expectedByotRosterSize,
  isGuaranteedLabel,
  labelPriorityEntries,
  LEAGUE_PRIORITY_GUARANTEE_LABEL_TEXT,
  MAX_DESIRED_LEAGUE_COUNT,
  MAX_PROTECTED_CLAIMS,
  MIN_PLAY_IN_ROSTER_SIZE,
  pendingRosterNames,
  priorityRosterAllReturning,
  priorityRosterIsComplete,
  type LabeledPriorityEntry,
  type LeaguePriorityGuaranteeLabel,
  type PriorityLabelCandidate,
  type PriorityLabelResult,
} from '../../../../backend/src/registration/leaguePriorityRules';
import type {
  ContinuingSabbaticalSummary,
  LeagueCatalogItem,
  RegistrationLeagueEvaluation,
  RegistrationPlayInEntrySummary,
} from './registrationViewEditShared';

export {
  clampPriorityOrder,
  countPriorityRoster,
  expectedByotRosterSize,
  isGuaranteedLabel,
  labelPriorityEntries,
  LEAGUE_PRIORITY_GUARANTEE_LABEL_TEXT,
  MAX_DESIRED_LEAGUE_COUNT,
  MAX_PROTECTED_CLAIMS,
  MIN_PLAY_IN_ROSTER_SIZE,
  pendingRosterNames,
  priorityRosterAllReturning,
  priorityRosterIsComplete,
};
export type { LabeledPriorityEntry, LeaguePriorityGuaranteeLabel, PriorityLabelResult };

/** One league on the registrant's list, most wanted first. */
export type LeaguePriorityInput = {
  leagueId: number;
  priorityRank: number;
  /** Newline-separated names of teammates who do not have member accounts. */
  byotTeammateText?: string | null;
  teamRosterPlacements?: Array<{ memberId: number }> | null;
};

/** What to do with a league the registrant played last session but left off their list. */
export type PriorLeagueDecision = {
  leagueId: number;
  decision: 'sabbatical' | 'drop';
  isTemporarySabbaticalFill?: boolean;
};

export type RegistrationLeagueCatalogPayload = {
  leagues: LeagueCatalogItem[];
  priorities: LeaguePriorityInput[];
  desiredLeagueCount: number | null;
  maxDesiredLeagueCount: number;
  priorSeasonLeagueIds: number[];
  priorLeagueDecisions: PriorLeagueDecision[];
  activeLeagueIds: number[];
  participatedLeagueIds: number[];
  returnRightLeagueIds: number[];
  /**
   * Members who hold a return right for each bring-your-own-team league. Used
   * live to decide whether a declared roster earns a guaranteed return.
   */
  returnEligibleMemberIdsByLeagueId?: Record<number, number[]>;
  continuingSabbaticals?: ContinuingSabbaticalSummary[];
  /** Session sabbatical fee used in the leave-league sabbatical option copy. */
  sabbaticalFeeMinor?: number;
  existingWaitlistEntries?: Array<{
    waitlistId: number;
    leagueId: number;
    status: string;
    position?: number | null;
    queueTotal?: number | null;
  }>;
  basicIceFallbackInterest: boolean | null;
  collectBasicIceFallback: boolean;
  playInEntry?: Record<number, RegistrationPlayInEntrySummary>;
  evaluation?: RegistrationLeagueEvaluation;
};

export type LeaguePrioritySavePayload = {
  desiredLeagueCount: number | null;
  priorities: LeaguePriorityInput[];
  priorLeagueDecisions: PriorLeagueDecision[];
  basicIceFallbackInterest?: boolean | null;
};

export function leagueById(leagues: LeagueCatalogItem[]): Record<number, LeagueCatalogItem | undefined> {
  return Object.fromEntries(leagues.map((league) => [league.id, league]));
}

/**
 * Mirrors `hasReturnRight` on the server. A standard league's return right is
 * decided by prior participation or a sabbatical, which the catalog resolves; a
 * play-in league's also requires a full declared team over the TLINE bar.
 */
export function hasReturnRight(input: {
  league: LeagueCatalogItem | undefined;
  priority: LeaguePriorityInput;
  returnRightLeagueIds: ReadonlySet<number>;
  playInEntry?: Record<number, RegistrationPlayInEntrySummary>;
  registrantMemberId: number | null;
}): boolean {
  const { league, priority } = input;
  if (!league) return false;
  if (league.isPlayInBased === true) {
    if (!input.playInEntry?.[league.id]?.guaranteed) return false;
    return priorityRosterIsComplete(league, priority, input.registrantMemberId);
  }
  return input.returnRightLeagueIds.has(league.id);
}

export function evaluatePriorityList(input: {
  priorities: LeaguePriorityInput[];
  leagues: LeagueCatalogItem[];
  desiredLeagueCount: number | null;
  returnRightLeagueIds: number[];
  returnEligibleMemberIdsByLeagueId?: Record<number, number[]>;
  playInEntry?: Record<number, RegistrationPlayInEntrySummary>;
  priorLeagueDecisions: PriorLeagueDecision[];
  registrantMemberId: number | null;
}): PriorityLabelResult {
  const leagues = leagueById(input.leagues);
  const returnRightLeagueIds = new Set(input.returnRightLeagueIds);
  const candidates: PriorityLabelCandidate[] = input.priorities.map((priority) => {
    const league = leagues[priority.leagueId];
    const hasRight = hasReturnRight({
      league,
      priority,
      returnRightLeagueIds,
      playInEntry: input.playInEntry,
      registrantMemberId: input.registrantMemberId,
    });
    const returnEligibleMemberIds = new Set(input.returnEligibleMemberIdsByLeagueId?.[priority.leagueId] ?? []);
    if (hasRight && input.registrantMemberId != null) {
      returnEligibleMemberIds.add(input.registrantMemberId);
    }
    return {
      leagueId: priority.leagueId,
      priorityRank: priority.priorityRank,
      hasReturnRight: hasRight,
      rosterComplete: league ? priorityRosterIsComplete(league, priority, input.registrantMemberId) : false,
      rosterAllReturning: league
        ? priorityRosterAllReturning(league, priority, returnEligibleMemberIds, input.registrantMemberId)
        : false,
      feeMinor: league?.registrationFeeMinor ?? 0,
      allowsWaitlist: league?.allowsWaitlist === true,
      isPlayInBased: league?.isPlayInBased === true,
    };
  });

  return labelPriorityEntries({
    candidates,
    desiredLeagueCount: input.desiredLeagueCount,
  });
}

/** Renumbers ranks from 1 and re-applies the bring-your-own-team clamp. */
export function normalizePriorityOrder(
  priorities: LeaguePriorityInput[],
  leagues: LeagueCatalogItem[],
): LeaguePriorityInput[] {
  return clampPriorityOrder(priorities, leagueById(leagues));
}

/**
 * Seeds an empty list: the leagues the registrant played last session, plus any
 * league they are already waitlisted for. Waitlisted leagues lead because the
 * registrant already told us they want in.
 */
export function seedPriorityList(payload: RegistrationLeagueCatalogPayload): LeaguePriorityInput[] {
  return mergeActiveWaitlistLeagues(
    normalizePriorityOrder(
      payload.priorSeasonLeagueIds.map((leagueId, index) => ({ leagueId, priorityRank: index + 1 })),
      payload.leagues,
    ),
    payload,
  );
}

/**
 * Initial list for the priority page: saved ranks when present, otherwise the
 * prior-session seed. Active waitlist leagues are always merged in so joining
 * a waitlist outside registration still shows up after a refresh.
 */
export function hydratePriorityList(payload: RegistrationLeagueCatalogPayload): LeaguePriorityInput[] {
  const base =
    payload.priorities.length > 0
      ? normalizePriorityOrder(payload.priorities, payload.leagues)
      : normalizePriorityOrder(
          payload.priorSeasonLeagueIds.map((leagueId, index) => ({ leagueId, priorityRank: index + 1 })),
          payload.leagues,
        );
  return mergeActiveWaitlistLeagues(base, payload);
}

function isSeedableWaitlistEntry(entry: { status: string }): boolean {
  return entry.status === 'active' || entry.status === 'offered';
}

/**
 * Inserts any active/offered waitlist leagues that are missing from the list,
 * ahead of existing entries (then re-applies the bring-your-own-team clamp).
 * Returns the same array reference when nothing needs to be added.
 */
export function mergeActiveWaitlistLeagues(
  priorities: LeaguePriorityInput[],
  payload: RegistrationLeagueCatalogPayload,
): LeaguePriorityInput[] {
  const catalogIds = new Set(payload.leagues.map((league) => league.id));
  const listed = new Set(priorities.map((priority) => priority.leagueId));
  const missingWaitlistLeagueIds = [
    ...new Set(
      (payload.existingWaitlistEntries ?? [])
        .filter(isSeedableWaitlistEntry)
        .map((entry) => entry.leagueId)
        .filter((leagueId) => catalogIds.has(leagueId) && !listed.has(leagueId)),
    ),
  ];
  if (missingWaitlistLeagueIds.length === 0) return priorities;
  const additions = missingWaitlistLeagueIds.map((leagueId, index) => ({
    leagueId,
    priorityRank: index + 1,
  }));
  const existing = priorities.map((priority, index) => ({
    ...priority,
    priorityRank: additions.length + index + 1,
  }));
  return normalizePriorityOrder([...additions, ...existing], payload.leagues);
}

/**
 * Initial "how many leagues do you want" value. Uses a saved answer when
 * present; otherwise only last-session participation (not waitlist seeds).
 */
export function defaultDesiredLeagueCount(payload: RegistrationLeagueCatalogPayload): number | null {
  if (payload.desiredLeagueCount != null) return payload.desiredLeagueCount;
  const priorSeasonCount = payload.priorSeasonLeagueIds.length;
  if (priorSeasonCount <= 0) return null;
  return Math.min(priorSeasonCount, MAX_DESIRED_LEAGUE_COUNT);
}

export function addPriority(
  priorities: LeaguePriorityInput[],
  leagueId: number,
  leagues: LeagueCatalogItem[],
): LeaguePriorityInput[] {
  if (priorities.some((priority) => priority.leagueId === leagueId)) return priorities;
  return normalizePriorityOrder([...priorities, { leagueId, priorityRank: priorities.length + 1 }], leagues);
}

/** Puts a league at the top of the priority list (BYOT clamp may still lift team leagues). */
export function addPriorityAtTop(
  priorities: LeaguePriorityInput[],
  leagueId: number,
  leagues: LeagueCatalogItem[],
): LeaguePriorityInput[] {
  if (priorities.some((priority) => priority.leagueId === leagueId)) return priorities;
  return normalizePriorityOrder([{ leagueId, priorityRank: 1 }, ...priorities], leagues);
}

export function removePriority(
  priorities: LeaguePriorityInput[],
  leagueId: number,
  leagues: LeagueCatalogItem[],
): LeaguePriorityInput[] {
  return normalizePriorityOrder(
    priorities.filter((priority) => priority.leagueId !== leagueId),
    leagues,
  );
}

export function reorderPriorities(
  ordered: LeaguePriorityInput[],
  leagues: LeagueCatalogItem[],
): LeaguePriorityInput[] {
  return normalizePriorityOrder(
    ordered.map((priority, index) => ({ ...priority, priorityRank: index + 1 })),
    leagues,
  );
}

export function updatePriorityRoster(
  priorities: LeaguePriorityInput[],
  leagueId: number,
  update: Partial<Pick<LeaguePriorityInput, 'byotTeammateText' | 'teamRosterPlacements'>>,
): LeaguePriorityInput[] {
  return priorities.map((priority) =>
    priority.leagueId === leagueId ? { ...priority, ...update } : priority,
  );
}

/** Leagues the registrant may still add: eligible, in session, and not already listed. */
export function availableLeaguesToAdd(input: {
  leagues: LeagueCatalogItem[];
  priorities: LeaguePriorityInput[];
  isEligible: (league: LeagueCatalogItem) => boolean;
}): LeagueCatalogItem[] {
  const listed = new Set(input.priorities.map((priority) => priority.leagueId));
  return input.leagues.filter((league) => !listed.has(league.id) && input.isEligible(league));
}

/**
 * Leagues from last session that are neither on the list nor answered with a
 * sabbatical or drop. Registration cannot be submitted while any remain.
 */
export function undecidedPriorLeagueIds(input: {
  priorSeasonLeagueIds: number[];
  priorities: LeaguePriorityInput[];
  priorLeagueDecisions: PriorLeagueDecision[];
}): number[] {
  const decided = new Set([
    ...input.priorities.map((priority) => priority.leagueId),
    ...input.priorLeagueDecisions.map((decision) => decision.leagueId),
  ]);
  return input.priorSeasonLeagueIds.filter((leagueId) => !decided.has(leagueId));
}

/**
 * A row in the sabbatical list under Add a league: either a sabbatical just
 * chosen when removing a return-right league, or a prior-session sabbatical
 * that still needs extend / return / drop.
 */
export type SabbaticalListEntry = {
  leagueId: number;
  leagueName: string;
  sabbaticalFeeMinor: number;
  kind: 'indicated' | 'continuing';
  canExtend: boolean;
  extensionBlockedMessage: string | null;
  /**
   * Continuing rows keep radios selected: return (on priority list), sabbatical,
   * drop, or null when still undecided. Indicated rows are always sabbatical.
   */
  decision: 'sabbatical' | 'drop' | 'return' | null;
};

/**
 * Continuing sabbaticals that are neither on the priority list nor answered
 * with sabbatical or drop. Mirrors server `validateContinuingSabbaticalDecisions`.
 */
export function undecidedContinuingSabbaticalIds(input: {
  continuingSabbaticals: ContinuingSabbaticalSummary[];
  priorities: LeaguePriorityInput[];
  priorLeagueDecisions: PriorLeagueDecision[];
}): number[] {
  const resolved = new Set([
    ...input.priorities.map((priority) => priority.leagueId),
    ...input.priorLeagueDecisions.map((decision) => decision.leagueId),
  ]);
  return input.continuingSabbaticals
    .filter((entry) => !resolved.has(entry.leagueId))
    .map((entry) => entry.leagueId);
}

/**
 * Sabbaticals to show below Add a league. Continuing rows stay visible after
 * return / extend / drop so the radio selection can remain. Indicated rows are
 * omitted once cashed back onto the priority list.
 */
export function sabbaticalListEntries(input: {
  continuingSabbaticals: ContinuingSabbaticalSummary[];
  priorLeagueDecisions: PriorLeagueDecision[];
  priorities: LeaguePriorityInput[];
  leagues: LeagueCatalogItem[];
  defaultSabbaticalFeeMinor: number;
}): SabbaticalListEntry[] {
  const onPriority = new Set(input.priorities.map((priority) => priority.leagueId));
  const decisionByLeagueId = new Map(
    input.priorLeagueDecisions.map((decision) => [decision.leagueId, decision.decision]),
  );
  const leagueNameById = new Map(input.leagues.map((league) => [league.id, league.name]));
  const entries: SabbaticalListEntry[] = [];
  const seen = new Set<number>();

  for (const continuing of input.continuingSabbaticals) {
    seen.add(continuing.leagueId);
    const recorded = decisionByLeagueId.get(continuing.leagueId);
    let decision: SabbaticalListEntry['decision'] = null;
    if (onPriority.has(continuing.leagueId)) {
      decision = 'return';
    } else if (recorded === 'sabbatical' || recorded === 'drop') {
      decision = recorded;
    }
    entries.push({
      leagueId: continuing.leagueId,
      leagueName: continuing.leagueName,
      sabbaticalFeeMinor: continuing.sabbaticalFeeMinor,
      kind: 'continuing',
      canExtend: continuing.canExtend,
      extensionBlockedMessage: continuing.extensionBlockedMessage,
      decision,
    });
  }

  for (const prior of input.priorLeagueDecisions) {
    if (prior.decision !== 'sabbatical') continue;
    if (onPriority.has(prior.leagueId) || seen.has(prior.leagueId)) continue;
    seen.add(prior.leagueId);
    entries.push({
      leagueId: prior.leagueId,
      leagueName: leagueNameById.get(prior.leagueId) ?? 'League',
      sabbaticalFeeMinor: input.defaultSabbaticalFeeMinor,
      kind: 'indicated',
      canExtend: true,
      extensionBlockedMessage: null,
      decision: 'sabbatical',
    });
  }

  return entries;
}

/**
 * Play-in leagues whose declared roster meets the minimum to continue but is
 * still short of a full team. Continuing prompts a confirmation that the
 * coordinator will try to help fill the team with no guarantee.
 */
export function incompletePlayInLeagueNames(
  priorities: LeaguePriorityInput[],
  leagues: LeagueCatalogItem[],
  registeringCurlerMemberId: number | null,
): string[] {
  const leagueById = new Map(leagues.map((league) => [league.id, league]));
  const names: string[] = [];
  for (const priority of priorities) {
    const league = leagueById.get(priority.leagueId);
    if (!league?.isPlayInBased) continue;
    const expectedSize = expectedByotRosterSize(league);
    if (expectedSize == null) continue;
    const size = countPriorityRoster(priority, registeringCurlerMemberId).total;
    const minSize = Math.min(MIN_PLAY_IN_ROSTER_SIZE, expectedSize);
    if (size >= minSize && size < expectedSize) {
      names.push(league.name);
    }
  }
  return names;
}

/**
 * Bring-your-own-team (and play-in) leagues must stay above standard leagues.
 * Used by drag-and-drop so the live preview cannot cross that boundary.
 */
export function canReorderPriorityDrop(
  active: LeaguePriorityInput,
  over: LeaguePriorityInput,
  leagues: LeagueCatalogItem[],
): boolean {
  const byId = leagueById(leagues);
  const activeIsByot = byId[active.leagueId]?.leagueType === 'bring_your_own_team';
  const overIsByot = byId[over.leagueId]?.leagueType === 'bring_your_own_team';
  return activeIsByot === overIsByot;
}

/** Whether a priority entry can move one step in the given direction without crossing the BYOT boundary. */
export function canMovePriority(
  priorities: LeaguePriorityInput[],
  leagueId: number,
  direction: 'up' | 'down',
  leagues: LeagueCatalogItem[],
): boolean {
  const index = priorities.findIndex((priority) => priority.leagueId === leagueId);
  if (index < 0) return false;
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= priorities.length) return false;
  return canReorderPriorityDrop(priorities[index]!, priorities[swapIndex]!, leagues);
}

const BYOT_ORDER_TOOLTIP =
  'Bring-your-own-team leagues must be prioritized higher than standard leagues.';

/**
 * Hover text for the move up/down control. Explains the BYOT boundary when that
 * is what blocks the move; otherwise omit a tooltip on disabled buttons.
 */
export function priorityMoveButtonTitle(
  priorities: LeaguePriorityInput[],
  leagueId: number,
  direction: 'up' | 'down',
  leagues: LeagueCatalogItem[],
  leagueName: string,
): string | undefined {
  const index = priorities.findIndex((priority) => priority.leagueId === leagueId);
  if (index < 0) return undefined;
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= priorities.length) {
    // Already at the end of the list — no extra explanation.
    return undefined;
  }
  if (canReorderPriorityDrop(priorities[index]!, priorities[swapIndex]!, leagues)) {
    return direction === 'up' ? `Move ${leagueName} up` : `Move ${leagueName} down`;
  }
  return direction === 'up'
    ? `Cannot move up. ${BYOT_ORDER_TOOLTIP}`
    : `Cannot move down. ${BYOT_ORDER_TOOLTIP}`;
}

/** Swaps a priority entry one step up or down when the move stays inside its block. */
export function movePriorityInList(
  priorities: LeaguePriorityInput[],
  leagueId: number,
  direction: 'up' | 'down',
  leagues: LeagueCatalogItem[],
): LeaguePriorityInput[] {
  if (!canMovePriority(priorities, leagueId, direction, leagues)) return priorities;
  const index = priorities.findIndex((priority) => priority.leagueId === leagueId);
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  const next = [...priorities];
  const current = next[index]!;
  next[index] = next[swapIndex]!;
  next[swapIndex] = current;
  return reorderPriorities(next, leagues);
}

export function guaranteeChipLabel(label: LeaguePriorityGuaranteeLabel): string {
  return LEAGUE_PRIORITY_GUARANTEE_LABEL_TEXT[label];
}

export function guaranteeChipClassName(label: LeaguePriorityGuaranteeLabel): string {
  if (label === 'guaranteed_return') return 'bg-emerald-100 text-emerald-900';
  if (label === 'awaiting_roster_entry') return 'bg-yellow-100 text-yellow-900';
  if (label === 'guaranteed_fallback') return 'bg-sky-100 text-sky-900';
  if (label === 'waitlisted') return 'bg-amber-100 text-amber-900';
  return 'bg-gray-100 text-gray-800';
}
