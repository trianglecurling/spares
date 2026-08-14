/**
 * League priority evaluation.
 *
 * A registrant tells us two things: how many leagues they want to play in, and
 * an ordered list of leagues, most wanted first. Everything else — which spots
 * are guaranteed, which go on a waitlist, what we can bill now — is derived
 * from those two facts plus the registrant's return rights.
 *
 * See docs/registration/league-priority.md for the product rules.
 */
import {
  clampPriorityOrder,
  countPriorityRoster,
  expectedByotRosterSize,
  isPriorityOrderClamped,
  labelPriorityEntries,
  pendingRosterNames,
  priorityHasDeclaredRoster,
  priorityRosterAllReturning,
  priorityRosterIsComplete,
  resolveDesiredLeagueCount,
  guaranteeBudgetFor,
  immediateChargeEntries,
  isGuaranteedLabel,
  MAX_DESIRED_LEAGUE_COUNT,
  MAX_PROTECTED_CLAIMS,
  MAX_SIMULTANEOUS_SABBATICALS,
  MIN_PLAY_IN_ROSTER_SIZE,
  type LabeledPriorityEntry,
  type LeaguePriorityGuaranteeLabel,
  type PriorityLabelCandidate,
} from './leaguePriorityRules.js';
import {
  blockingError,
  createDecision,
  type BusinessDecision,
  type DecisionMessage,
  type RegistrationReasonCode,
} from './registrationDecisionTypes.js';
import { validateLeagueEligibility, validateRegistrationIsOpen, validateSpareOnlyEligibility } from './registrationEligibility.js';
import { evaluateSabbaticalEligibility, findRelevantSabbatical } from './registrationReturningRights.js';
import { validateContinuingSabbaticalDecisions } from './registrationSabbaticalContinuity.js';
import {
  getLeague,
  orderedPriorities,
  type LeagueConfig,
  type LeaguePriorityInput,
  type RegistrationContext,
  type RegistrationSelectionInput,
} from './registrationContext.js';

export {
  clampPriorityOrder,
  countPriorityRoster,
  expectedByotRosterSize,
  isGuaranteedLabel,
  isPriorityOrderClamped,
  pendingRosterNames,
  priorityHasDeclaredRoster,
  priorityRosterAllReturning,
  MAX_DESIRED_LEAGUE_COUNT,
  MAX_PROTECTED_CLAIMS,
  MAX_SIMULTANEOUS_SABBATICALS,
  MIN_PLAY_IN_ROSTER_SIZE,
};

// ---------------------------------------------------------------------------
// Return rights
// ---------------------------------------------------------------------------

/**
 * Whether the registrant holds a return right for this league, ignoring rank and
 * budget. For a standard league this is prior participation or a sabbatical
 * right; for a play-in league the declared team must also clear the TLINE bar.
 */
export function hasReturnRight(context: RegistrationContext, priority: LeaguePriorityInput): boolean {
  const league = getLeague(context, priority.leagueId);
  if (!league) return false;
  if (context.registrationState !== 'priority') return false;
  if (!context.registrant.isReturningMember) return false;

  if (league.isPlayInBased) {
    const entry = context.playInEntry?.[league.id];
    if (!entry?.guaranteed) return false;
    const expectedSize = expectedByotRosterSize(league);
    if (expectedSize == null) return false;
    return countPriorityRoster(priority, context.registrant.memberId).total === expectedSize;
  }

  if (league.predecessorLeagueId == null) return false;
  if (context.participatedLeagueIds.includes(league.predecessorLeagueId)) return true;
  return findRelevantSabbatical(context, league) !== undefined;
}

/** Count of sabbatical selections on the current registration (not a guarantee budget cost). */
export function sabbaticalClaimCount(context: RegistrationContext): number {
  return context.selections.filter((selection) => selection.selectionType === 'sabbatical').length;
}

export function resolvedDesiredLeagueCount(context: RegistrationContext): number {
  return resolveDesiredLeagueCount(context.desiredLeagueCount);
}

export function guaranteeBudget(context: RegistrationContext): number {
  return guaranteeBudgetFor(resolvedDesiredLeagueCount(context));
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type LeaguePriorityEntryEvaluation = LabeledPriorityEntry;

export type LeaguePriorityEvaluation = {
  desiredLeagueCount: number;
  guaranteeBudget: number;
  entries: LeaguePriorityEntryEvaluation[];
  guaranteedCount: number;
  confirmedLeagueFeeMinor: number;
  maximumLeagueFeeMinor: number;
};

export function evaluateLeaguePriorities(context: RegistrationContext): LeaguePriorityEvaluation {
  const candidates: PriorityLabelCandidate[] = orderedPriorities(context).map((priority) => {
    const league = getLeague(context, priority.leagueId);
    const returnEligibleMemberIds = new Set(context.returnEligibleMemberIdsByLeagueId?.[priority.leagueId] ?? []);
    // The registrant themselves always counts when they hold the return right —
    // the map may omit them if they only have a sabbatical right loaded later.
    if (hasReturnRight(context, priority) && context.registrant.memberId != null) {
      returnEligibleMemberIds.add(context.registrant.memberId);
    }
    return {
      leagueId: priority.leagueId,
      priorityRank: priority.priorityRank,
      hasReturnRight: hasReturnRight(context, priority),
      rosterComplete: league ? priorityRosterIsComplete(league, priority, context.registrant.memberId) : false,
      rosterAllReturning: league
        ? priorityRosterAllReturning(league, priority, returnEligibleMemberIds, context.registrant.memberId)
        : false,
      feeMinor: league?.registrationFeeMinor ?? 0,
      allowsWaitlist: league?.allowsWaitlist === true,
      isPlayInBased: league?.isPlayInBased === true,
    };
  });

  return labelPriorityEntries({
    candidates,
    desiredLeagueCount: context.desiredLeagueCount,
  });
}

export function guaranteedPriorityLeagueIds(evaluation: LeaguePriorityEvaluation): number[] {
  return evaluation.entries.filter((entry) => entry.guaranteed).map((entry) => entry.leagueId);
}

export function waitlistedPriorityEntries(evaluation: LeaguePriorityEvaluation): LeaguePriorityEntryEvaluation[] {
  return evaluation.entries.filter((entry) => entry.label === 'waitlisted');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type PriorityValidationResult = BusinessDecision<'valid' | 'invalid'> & {
  deferralReasonCodes: RegistrationReasonCode[];
  evaluation: LeaguePriorityEvaluation;
};

function validateDesiredCount(context: RegistrationContext, blockingErrors: DecisionMessage[]): void {
  const raw = context.desiredLeagueCount;
  if (context.priorities.length === 0 && (raw == null || raw === 0)) return;
  if (raw == null) {
    blockingErrors.push(
      blockingError('desired_league_count_required', 'Choose how many leagues you want to play in.'),
    );
    return;
  }
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_DESIRED_LEAGUE_COUNT) {
    blockingErrors.push(
      blockingError(
        'desired_league_count_out_of_range',
        `Choose between 1 and ${MAX_DESIRED_LEAGUE_COUNT} leagues.`,
      ),
    );
    return;
  }
  if (context.priorities.length < raw) {
    blockingErrors.push(
      blockingError(
        'priority_list_too_short',
        `List at least ${raw} ${raw === 1 ? 'league' : 'leagues'} so we know which ones you want.`,
      ),
    );
  }
}

function validateRanks(context: RegistrationContext, blockingErrors: DecisionMessage[]): void {
  const leagueIds = context.priorities.map((priority) => priority.leagueId);
  if (new Set(leagueIds).size !== leagueIds.length) {
    blockingErrors.push(
      blockingError('priority_list_duplicate_league', 'Each league may appear only once on your list.'),
    );
  }
  const ranks = context.priorities.map((priority) => priority.priorityRank).sort((a, b) => a - b);
  const contiguous = ranks.every((rank, index) => rank === index + 1);
  if (!contiguous) {
    blockingErrors.push(
      blockingError('priority_rank_not_contiguous', 'League priorities must be numbered consecutively from 1.'),
    );
  }
  if (!isPriorityOrderClamped(context.priorities, context.leagues)) {
    blockingErrors.push(
      blockingError(
        'byot_must_outrank_standard_leagues',
        'Bring-your-own-team leagues must be ranked above your other leagues.',
      ),
    );
  }
}

function validateRoster(
  context: RegistrationContext,
  league: LeagueConfig,
  priority: LeaguePriorityInput,
  blockingErrors: DecisionMessage[],
): void {
  const expectedSize = expectedByotRosterSize(league);

  if (league.isPlayInBased) {
    if (expectedSize == null) {
      blockingErrors.push(
        blockingError(
          'byot_play_in_requires_full_roster',
          `Include at least one person on your ${league.name} roster.`,
        ),
      );
      return;
    }
    const counts = countPriorityRoster(priority, context.registrant.memberId);
    const minSize = Math.min(MIN_PLAY_IN_ROSTER_SIZE, expectedSize);
    if (counts.total < minSize) {
      blockingErrors.push(
        blockingError(
          'byot_play_in_requires_minimum_roster',
          counts.total === 0
            ? `Include at least one person on your ${league.name} roster.`
            : `${league.name} needs at least ${minSize} players on the team to enter.`,
        ),
      );
      return;
    }
    if (counts.total > expectedSize) {
      blockingErrors.push(
        blockingError(
          'byot_play_in_requires_full_roster',
          `${league.name} allows at most ${expectedSize} players.`,
        ),
      );
      return;
    }
    const entry = context.playInEntry?.[league.id];
    if (entry) {
      const committed = new Set(entry.committedOtherMemberIds);
      const conflicting = (priority.teamRosterPlacements ?? []).filter((placement) =>
        committed.has(placement.memberId),
      );
      if (conflicting.length > 0) {
        blockingErrors.push(
          blockingError(
            'play_in_teammate_already_committed',
            'One or more selected teammates are already on another declared team for this league. Contact membership@trianglecurling.com to sort out team assignments.',
          ),
        );
      }
    }
    return;
  }

  if (league.leagueType !== 'bring_your_own_team') return;

  if (expectedSize == null) {
    blockingErrors.push(
      blockingError('byot_requires_full_roster', 'Bring-your-own-team leagues require a team roster.'),
    );
    return;
  }
  const counts = countPriorityRoster(priority, context.registrant.memberId);
  if (counts.total !== expectedSize) {
    blockingErrors.push(
      blockingError(
        'byot_requires_full_roster',
        `Bring-your-own-team leagues require exactly ${expectedSize} players for this league.`,
      ),
    );
  }
  const pending = pendingRosterNames(priority.byotTeammateText).map((name) => name.toLowerCase());
  if (new Set(pending).size !== pending.length) {
    blockingErrors.push(blockingError('byot_requires_full_roster', 'Teammate names must be unique.'));
  }
}

function validatePriority(
  context: RegistrationContext,
  priority: LeaguePriorityInput,
  blockingErrors: DecisionMessage[],
): void {
  const league = getLeague(context, priority.leagueId);
  if (!league) {
    blockingErrors.push(
      blockingError(
        'league_not_in_registration_session',
        'Selected league is not available for this registration session.',
      ),
    );
    return;
  }
  if (league.isJuniorRecreational === true) {
    blockingErrors.push(
      blockingError(
        'junior_recreational_exclusive',
        'Junior Recreational is a membership choice. It cannot be added to the priority list.',
      ),
    );
    return;
  }
  if (league.sessionId != null && league.sessionId !== context.session.id) {
    blockingErrors.push(
      blockingError(
        'league_not_in_registration_session',
        'Selected league is not available for this registration session.',
      ),
    );
    return;
  }

  blockingErrors.push(...validateLeagueEligibility(context, league).blockingErrors);

  if (context.selections.some((selection) => selection.selectionType === 'sabbatical' && selection.leagueId === league.id)) {
    blockingErrors.push(
      blockingError(
        'sabbatical_league_on_priority_list',
        'A league you are taking sabbatical from cannot also be on your priority list.',
      ),
    );
  }

  validateRoster(context, league, priority, blockingErrors);
}

function validateSelection(
  context: RegistrationContext,
  selection: RegistrationSelectionInput,
  blockingErrors: DecisionMessage[],
  warnings: DecisionMessage[],
): void {
  if (selection.selectionType === 'junior_recreational') {
    const conflicts =
      context.priorities.length > 0 ||
      context.selections.some((other) => other.selectionType === 'spare_only');
    if (conflicts) {
      blockingErrors.push(
        blockingError(
          'junior_recreational_exclusive',
          'Junior Recreational cannot be combined with other leagues or spare-only.',
        ),
      );
    }
    return;
  }

  if (selection.selectionType === 'spare_only') {
    blockingErrors.push(...validateSpareOnlyEligibility(context).blockingErrors);
    return;
  }

  const league = getLeague(context, selection.leagueId);
  if (!league) {
    blockingErrors.push(
      blockingError(
        'league_not_in_registration_session',
        'Selected league is not available for this registration session.',
      ),
    );
    return;
  }

  if (selection.selectionType === 'sabbatical') {
    const eligibility = evaluateSabbaticalEligibility(context, league, {
      isTemporarySabbaticalFill: selection.isTemporarySabbaticalFill,
    });
    blockingErrors.push(...eligibility.blockingErrors);
    warnings.push(...eligibility.warnings);
  }
}

/**
 * Every prior-session league must be accounted for: either it is on the priority
 * list, or the registrant chose sabbatical or drop for it.
 */
function validatePriorLeagueDecisions(context: RegistrationContext, blockingErrors: DecisionMessage[]): void {
  if (context.registrationState !== 'priority') return;
  const decided = new Set<number>();
  for (const priority of context.priorities) {
    const league = getLeague(context, priority.leagueId);
    if (league?.predecessorLeagueId != null) decided.add(league.predecessorLeagueId);
  }
  for (const selection of context.selections) {
    if (selection.selectionType !== 'sabbatical' && selection.selectionType !== 'drop') continue;
    const league = getLeague(context, selection.leagueId);
    if (league?.predecessorLeagueId != null) decided.add(league.predecessorLeagueId);
    if (selection.leagueId != null) decided.add(selection.leagueId);
  }

  const returnableLeagueIds = new Set(
    Object.values(context.leagues)
      .filter((league) => league.predecessorLeagueId != null && context.participatedLeagueIds.includes(league.predecessorLeagueId))
      .map((league) => league.predecessorLeagueId as number),
  );

  for (const predecessorId of returnableLeagueIds) {
    if (!decided.has(predecessorId)) {
      blockingErrors.push(
        blockingError(
          'prior_league_decision_required',
          'Choose what to do with each league you played last session.',
        ),
      );
      return;
    }
  }
}

export function validateLeaguePriorities(context: RegistrationContext): PriorityValidationResult {
  const blockingErrors: DecisionMessage[] = [];
  const warnings: DecisionMessage[] = [];
  const deferralReasonCodes: RegistrationReasonCode[] = [];

  blockingErrors.push(...validateRegistrationIsOpen(context).blockingErrors);

  validateDesiredCount(context, blockingErrors);
  validateRanks(context, blockingErrors);

  for (const priority of context.priorities) {
    validatePriority(context, priority, blockingErrors);
  }
  for (const selection of context.selections) {
    validateSelection(context, selection, blockingErrors, warnings);
  }

  if (sabbaticalClaimCount(context) > MAX_SIMULTANEOUS_SABBATICALS) {
    blockingErrors.push(
      blockingError(
        'sabbatical_limit_exceeded',
        'A registrant may be on sabbatical for at most two leagues.',
      ),
    );
  }

  if (
    (context.membershipOption === 'none' || context.membershipOption === 'social') &&
    context.priorities.length > 0
  ) {
    blockingErrors.push(
      blockingError(
        'sabbatical_only_no_priority_list',
        'This membership cannot include a league priority list.',
      ),
    );
  }

  const evaluation = evaluateLeaguePriorities(context);

  if (evaluation.guaranteedCount > MAX_PROTECTED_CLAIMS) {
    blockingErrors.push(
      blockingError(
        'protected_claim_limit_exceeded',
        'A registrant may hold at most two guaranteed league spots.',
      ),
    );
  }

  if (evaluation.entries.some((entry) => entry.label === 'superfluous')) {
    blockingErrors.push(
      blockingError(
        'priority_list_has_superfluous_leagues',
        'Remove leagues below the ones that already fill the number you asked for, or move one higher if you want it as a switch with guaranteed fallback.',
      ),
    );
  }

  validatePriorLeagueDecisions(context, blockingErrors);
  blockingErrors.push(...validateContinuingSabbaticalDecisions(context));

  deferralReasonCodes.push(...leaguePlacementDeferralReasons(evaluation));

  const decision = createDecision({
    status: blockingErrors.length > 0 ? 'invalid' : 'valid',
    allowed: blockingErrors.length === 0,
    blockingErrors,
    warnings,
    reasonCodes: deferralReasonCodes,
    requiresStaffReview: warnings.some((item) => item.code === 'sabbatical_staff_override_required'),
  });

  return {
    ...decision,
    deferralReasonCodes: Array.from(new Set(deferralReasonCodes)),
    evaluation,
  };
}

/**
 * Waitlists, incomplete rosters, and play-in misses still leave the bill
 * unresolved. Subject-to-availability leagues are assumed to have room, so they
 * fill desired-count slots the same way guarantees do for payment timing.
 */
export function leaguePlacementDeferralReasons(evaluation: LeaguePriorityEvaluation): RegistrationReasonCode[] {
  const billed = immediateChargeEntries(evaluation);
  if (billed.length >= evaluation.desiredLeagueCount) return [];

  const billedLeagueIds = new Set(billed.map((entry) => entry.leagueId));
  const reasons: RegistrationReasonCode[] = [];
  for (const entry of evaluation.entries) {
    if (entry.priorityRank > evaluation.desiredLeagueCount) continue;
    if (billedLeagueIds.has(entry.leagueId)) continue;
    if (entry.label === 'superfluous') continue;
    if (entry.isPlayInBased) {
      reasons.push('play_in_placement_pending');
    } else if (entry.label === 'waitlisted') {
      reasons.push('waitlist_placement_pending');
    } else {
      reasons.push('non_guaranteed_league_defers_payment');
    }
  }
  if (reasons.length === 0) reasons.push('non_guaranteed_league_defers_payment');
  return reasons;
}

/**
 * The basic ice fallback question is asked only when nothing on the list is
 * billed as a league today, so the registrant might end the session with no ice
 * at all. Subject-to-availability leagues count: we assume they have room.
 */
export function shouldCollectBasicIceFallback(context: RegistrationContext): boolean {
  if (context.membershipOption === 'regular_spare_only') return false;
  if (context.membershipOption === 'junior_recreational') return false;
  const evaluation = evaluateLeaguePriorities(context);
  return immediateChargeEntries(evaluation).length === 0;
}
