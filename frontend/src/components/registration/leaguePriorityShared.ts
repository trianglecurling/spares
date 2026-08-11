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
  continuingSabbaticals?: ContinuingSabbaticalSummary[];
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
  playInEntry?: Record<number, RegistrationPlayInEntrySummary>;
  priorLeagueDecisions: PriorLeagueDecision[];
  registrantMemberId: number | null;
}): PriorityLabelResult {
  const leagues = leagueById(input.leagues);
  const returnRightLeagueIds = new Set(input.returnRightLeagueIds);
  const candidates: PriorityLabelCandidate[] = input.priorities.map((priority) => {
    const league = leagues[priority.leagueId];
    return {
      leagueId: priority.leagueId,
      priorityRank: priority.priorityRank,
      hasReturnRight: hasReturnRight({
        league,
        priority,
        returnRightLeagueIds,
        playInEntry: input.playInEntry,
        registrantMemberId: input.registrantMemberId,
      }),
      rosterComplete: league ? priorityRosterIsComplete(league, priority, input.registrantMemberId) : false,
      feeMinor: league?.registrationFeeMinor ?? 0,
      allowsWaitlist: league?.allowsWaitlist === true,
      isPlayInBased: league?.isPlayInBased === true,
    };
  });

  return labelPriorityEntries({
    candidates,
    desiredLeagueCount: input.desiredLeagueCount,
    sabbaticalClaimCount: input.priorLeagueDecisions.filter((decision) => decision.decision === 'sabbatical').length,
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
  const waitlistLeagueIds = (payload.existingWaitlistEntries ?? [])
    .filter((entry) => entry.status === 'active')
    .map((entry) => entry.leagueId);
  const seeded = [...new Set([...waitlistLeagueIds, ...payload.priorSeasonLeagueIds])];
  return normalizePriorityOrder(
    seeded.map((leagueId, index) => ({ leagueId, priorityRank: index + 1 })),
    payload.leagues,
  );
}

export function addPriority(
  priorities: LeaguePriorityInput[],
  leagueId: number,
  leagues: LeagueCatalogItem[],
): LeaguePriorityInput[] {
  if (priorities.some((priority) => priority.leagueId === leagueId)) return priorities;
  return normalizePriorityOrder([...priorities, { leagueId, priorityRank: priorities.length + 1 }], leagues);
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

export function guaranteeChipLabel(label: LeaguePriorityGuaranteeLabel): string {
  return LEAGUE_PRIORITY_GUARANTEE_LABEL_TEXT[label];
}

export function guaranteeChipClassName(label: LeaguePriorityGuaranteeLabel): string {
  if (label === 'guaranteed_return') return 'bg-emerald-100 text-emerald-900';
  if (label === 'guaranteed_fallback') return 'bg-sky-100 text-sky-900';
  if (label === 'waitlisted') return 'bg-amber-100 text-amber-900';
  return 'bg-gray-100 text-gray-800';
}
