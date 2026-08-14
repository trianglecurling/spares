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
  immediateChargeEntries,
  LEAGUE_PRIORITY_GUARANTEE_LABEL_TEXT,
  MAX_DESIRED_LEAGUE_COUNT,
  MAX_PROTECTED_CLAIMS,
  MAX_SIMULTANEOUS_SABBATICALS,
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
  immediateChargeEntries,
  LEAGUE_PRIORITY_GUARANTEE_LABEL_TEXT,
  MAX_DESIRED_LEAGUE_COUNT,
  MAX_PROTECTED_CLAIMS,
  MAX_SIMULTANEOUS_SABBATICALS,
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

/** Basic ice privileges only include leagues listed as free (no registration fee). */
export function isFreeLeague(league: Pick<LeagueCatalogItem, 'registrationFeeMinor'> | undefined): boolean {
  return (league?.registrationFeeMinor ?? 0) === 0;
}

/** Standard leagues that allow a sabbatical. Bring-your-own-team leagues never do. */
export function isSabbaticalEligibleLeague(
  league: Pick<LeagueCatalogItem, 'allowsSabbatical' | 'leagueType'> | undefined,
): boolean {
  return league?.allowsSabbatical === true && league.leagueType !== 'bring_your_own_team';
}

export type PriorityListOptions = {
  /** When true, paid leagues cannot be seeded, merged, or kept on the list. */
  freeLeaguesOnly?: boolean;
};

function allowedLeagueIds(leagues: LeagueCatalogItem[], freeLeaguesOnly: boolean | undefined): Set<number> | null {
  if (!freeLeaguesOnly) return null;
  return new Set(leagues.filter(isFreeLeague).map((league) => league.id));
}

export function filterPrioritiesToAllowedLeagues(
  priorities: LeaguePriorityInput[],
  leagues: LeagueCatalogItem[],
  freeLeaguesOnly: boolean | undefined,
): LeaguePriorityInput[] {
  const allowed = allowedLeagueIds(leagues, freeLeaguesOnly);
  if (!allowed) return priorities;
  const next = priorities.filter((priority) => allowed.has(priority.leagueId));
  if (next.length === priorities.length) return priorities;
  return normalizePriorityOrder(next, leagues);
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
export function seedPriorityList(
  payload: RegistrationLeagueCatalogPayload,
  options?: PriorityListOptions,
): LeaguePriorityInput[] {
  const priorSeasonLeagueIds = options?.freeLeaguesOnly
    ? payload.priorSeasonLeagueIds.filter((leagueId) => isFreeLeague(leagueById(payload.leagues)[leagueId]))
    : payload.priorSeasonLeagueIds;
  return mergeActiveWaitlistLeagues(
    normalizePriorityOrder(
      priorSeasonLeagueIds.map((leagueId, index) => ({ leagueId, priorityRank: index + 1 })),
      payload.leagues,
    ),
    payload,
    options,
  );
}

/**
 * Initial list for the priority page. A saved list is the registrant's last
 * confirmed order and is not re-seeded with waitlist leagues they already
 * removed. An empty list still seeds last-session leagues plus active waitlist
 * entries (first visit, or joining a waitlist before any save).
 */
export function hydratePriorityList(
  payload: RegistrationLeagueCatalogPayload,
  options?: PriorityListOptions,
): LeaguePriorityInput[] {
  const allowed = allowedLeagueIds(payload.leagues, options?.freeLeaguesOnly);
  if (payload.priorities.length > 0) {
    const source = allowed
      ? payload.priorities.filter((priority) => allowed.has(priority.leagueId))
      : payload.priorities;
    return normalizePriorityOrder(source, payload.leagues);
  }
  const source = payload.priorSeasonLeagueIds.map((leagueId, index) => ({
    leagueId,
    priorityRank: index + 1,
  }));
  const base = normalizePriorityOrder(
    allowed ? source.filter((priority) => allowed.has(priority.leagueId)) : source,
    payload.leagues,
  );
  return mergeActiveWaitlistLeagues(base, payload, options);
}

function isSeedableWaitlistEntry(entry: { status: string }): boolean {
  return entry.status === 'active' || entry.status === 'offered';
}

/** Active or offered waitlist league ids in the catalog, de-duplicated. */
export function seedableWaitlistLeagueIds(payload: RegistrationLeagueCatalogPayload): number[] {
  return [
    ...new Set(
      (payload.existingWaitlistEntries ?? [])
        .filter(isSeedableWaitlistEntry)
        .map((entry) => entry.leagueId),
    ),
  ];
}

/**
 * Inserts any active/offered waitlist leagues that are missing from the list,
 * ahead of existing entries (then re-applies the bring-your-own-team clamp).
 * Returns the same array reference when nothing needs to be added.
 */
export function mergeActiveWaitlistLeagues(
  priorities: LeaguePriorityInput[],
  payload: RegistrationLeagueCatalogPayload,
  options?: PriorityListOptions,
): LeaguePriorityInput[] {
  const allowed = allowedLeagueIds(payload.leagues, options?.freeLeaguesOnly);
  const catalogIds = new Set(payload.leagues.map((league) => league.id));
  const listed = new Set(priorities.map((priority) => priority.leagueId));
  const missingWaitlistLeagueIds = [
    ...new Set(
      (payload.existingWaitlistEntries ?? [])
        .filter(isSeedableWaitlistEntry)
        .map((entry) => entry.leagueId)
        .filter(
          (leagueId) =>
            catalogIds.has(leagueId) && !listed.has(leagueId) && (allowed == null || allowed.has(leagueId)),
        ),
    ),
  ];
  const filtered = filterPrioritiesToAllowedLeagues(priorities, payload.leagues, options?.freeLeaguesOnly);
  if (missingWaitlistLeagueIds.length === 0) return filtered;
  const additions = missingWaitlistLeagueIds.map((leagueId, index) => ({
    leagueId,
    priorityRank: index + 1,
  }));
  const existing = filtered.map((priority, index) => ({
    ...priority,
    priorityRank: additions.length + index + 1,
  }));
  return normalizePriorityOrder([...additions, ...existing], payload.leagues);
}

/**
 * Adds waitlist leagues that appeared since the last catalog snapshot. Already
 * known waitlist leagues are left off if the registrant removed them, so a
 * catalog refresh or returning from review cannot put them back.
 */
export function mergeNewlyJoinedWaitlistLeagues(
  priorities: LeaguePriorityInput[],
  payload: RegistrationLeagueCatalogPayload,
  previouslyKnownWaitlistLeagueIds: ReadonlySet<number>,
  options?: PriorityListOptions,
): LeaguePriorityInput[] {
  const newEntries = (payload.existingWaitlistEntries ?? []).filter(
    (entry) => isSeedableWaitlistEntry(entry) && !previouslyKnownWaitlistLeagueIds.has(entry.leagueId),
  );
  return mergeActiveWaitlistLeagues(
    priorities,
    { ...payload, existingWaitlistEntries: newEntries },
    options,
  );
}

/** "Monday", "Monday and Tuesday", or "Monday, Tuesday, and Wednesday". */
export function formatConjunctionList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * Active or offered waitlists whose leagues are in this session's catalog but
 * not on the current priority list. Submitting without them auto-declines.
 */
export function omittedWaitlistLeagues(
  payload: RegistrationLeagueCatalogPayload,
  priorities: LeaguePriorityInput[],
): LeagueCatalogItem[] {
  const listed = new Set(priorities.map((priority) => priority.leagueId));
  const byId = leagueById(payload.leagues);
  return seedableWaitlistLeagueIds(payload)
    .filter((leagueId) => !listed.has(leagueId))
    .map((leagueId) => byId[leagueId])
    .filter((league): league is LeagueCatalogItem => league != null);
}

/**
 * Initial "how many leagues do you want" value. Uses a saved answer when
 * present; otherwise only last-session participation (not waitlist seeds).
 */
export function defaultDesiredLeagueCount(
  payload: RegistrationLeagueCatalogPayload,
  options?: PriorityListOptions,
): number | null {
  const leagues = leagueById(payload.leagues);
  const priorSeasonLeagueIds = options?.freeLeaguesOnly
    ? payload.priorSeasonLeagueIds.filter((leagueId) => isFreeLeague(leagues[leagueId]))
    : payload.priorSeasonLeagueIds;
  if (payload.desiredLeagueCount != null) {
    if (!options?.freeLeaguesOnly) return payload.desiredLeagueCount;
    const freeSavedCount = payload.priorities.filter((priority) => isFreeLeague(leagues[priority.leagueId])).length;
    const cap = Math.max(priorSeasonLeagueIds.length, freeSavedCount);
    if (cap <= 0) return null;
    return Math.min(payload.desiredLeagueCount, cap, MAX_DESIRED_LEAGUE_COUNT);
  }
  const priorSeasonCount = priorSeasonLeagueIds.length;
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
 * Paid last-session leagues that cannot stay on a basic-ice priority list.
 * The registrant must sabbatical or drop each one; decided rows stay so the
 * choice can be changed.
 */
export function paidPriorLeaguesOffList(input: {
  priorSeasonLeagueIds: number[];
  priorities: LeaguePriorityInput[];
  priorLeagueDecisions: PriorLeagueDecision[];
  leagues: LeagueCatalogItem[];
}): LeagueCatalogItem[] {
  const onPriority = new Set(input.priorities.map((priority) => priority.leagueId));
  const leagues = leagueById(input.leagues);
  return input.priorSeasonLeagueIds.flatMap((leagueId) => {
    if (onPriority.has(leagueId)) return [];
    const league = leagues[leagueId];
    if (!league || isFreeLeague(league)) return [];
    return [league];
  });
}

/**
 * Last-session leagues the registrant can take a sabbatical from. Used when they
 * are not building a priority list (sabbatical-only registration).
 */
export function sabbaticalEligiblePriorLeagues(input: {
  priorSeasonLeagueIds: number[];
  leagues: LeagueCatalogItem[];
}): LeagueCatalogItem[] {
  const leagues = leagueById(input.leagues);
  return input.priorSeasonLeagueIds.flatMap((leagueId) => {
    const league = leagues[leagueId];
    if (!isSabbaticalEligibleLeague(league)) return [];
    return [league];
  });
}

/**
 * Starting sabbatical/drop answers for sabbatical-only registration: drop last
 * session leagues that cannot take a sabbatical, and extend continuing
 * sabbaticals that still can, up to the simultaneous limit.
 */
export function defaultSabbaticalOnlyDecisions(input: {
  priorSeasonLeagueIds: number[];
  priorLeagueDecisions: PriorLeagueDecision[];
  continuingSabbaticals: ContinuingSabbaticalSummary[];
  leagues: LeagueCatalogItem[];
}): PriorLeagueDecision[] {
  const leagues = leagueById(input.leagues);
  const byLeagueId = new Map<number, PriorLeagueDecision>();
  for (const decision of input.priorLeagueDecisions) {
    byLeagueId.set(decision.leagueId, decision);
  }

  for (const leagueId of input.priorSeasonLeagueIds) {
    if (byLeagueId.has(leagueId)) continue;
    if (!isSabbaticalEligibleLeague(leagues[leagueId])) {
      byLeagueId.set(leagueId, { leagueId, decision: 'drop' });
    }
  }

  let sabbaticalCount = [...byLeagueId.values()].filter((entry) => entry.decision === 'sabbatical').length;
  for (const continuing of input.continuingSabbaticals) {
    if (byLeagueId.has(continuing.leagueId)) continue;
    if (!continuing.canExtend) continue;
    if (sabbaticalCount >= MAX_SIMULTANEOUS_SABBATICALS) continue;
    byLeagueId.set(continuing.leagueId, { leagueId: continuing.leagueId, decision: 'sabbatical' });
    sabbaticalCount += 1;
  }

  return [...byLeagueId.values()];
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

/** Leftover spots without a waitlist or guarantee still show their derived status. */
export function shouldShowGuaranteeChip(
  label: LeaguePriorityGuaranteeLabel | null | undefined,
): label is LeaguePriorityGuaranteeLabel {
  return label != null;
}

export function guaranteeChipClassName(label: LeaguePriorityGuaranteeLabel): string {
  if (label === 'guaranteed_return') return 'bg-emerald-100 text-emerald-900';
  if (label === 'awaiting_roster_entry') return 'bg-yellow-100 text-yellow-900';
  if (label === 'guaranteed_fallback') return 'bg-sky-100 text-sky-900';
  if (label === 'waitlisted') return 'bg-amber-100 text-amber-900';
  if (label === 'superfluous') return 'bg-rose-100 text-rose-900';
  return 'bg-gray-100 text-gray-800';
}
