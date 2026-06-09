import { countHybridRoster } from './waitlistTeamRoster.js';
import { validateLeagueEligibility, validateRegistrationIsOpen, validateSpareOnlyEligibility, validateWaitlistEligibility } from './registrationEligibility.js';
import { evaluateGuaranteedReturnEligibility, evaluateSabbaticalEligibility, protectedClaimCount } from './registrationReturningRights.js';
import { blockingError, createDecision, type BusinessDecision, type DecisionMessage, type RegistrationReasonCode } from './registrationDecisionTypes.js';
import {
  activeLeagueCount,
  getSelectionLeague,
  isActiveWaitlistEntry,
  playInSelectionDefersPayment,
  waitlistSelectionDefersPayment,
  type LeagueConfig,
  type RegistrationContext,
  type RegistrationSelectionInput,
} from './registrationContext.js';
import { validateWaitlistFulfillment } from './waitlistFulfillment.js';

export type SelectionValidationResult = BusinessDecision<'valid' | 'invalid'> & {
  deferralReasonCodes: RegistrationReasonCode[];
  rankedThirdLeagueInterest: RegistrationSelectionInput[];
};

function hasJuniorRecreationalConflict(context: RegistrationContext): boolean {
  if (context.membershipOption !== 'junior_recreational') return false;
  return context.selections.some(
    (selection) =>
      selection.selectionType !== 'junior_recreational' &&
      (selection.selectionType === 'spare_only' || selection.leagueId != null)
  );
}

function activeReplaceWaitlistCount(context: RegistrationContext): number {
  return context.existingWaitlistEntries.filter(
    (entry) => isActiveWaitlistEntry(entry) && entry.entryType === 'replace'
  ).length;
}

function isNonGuaranteedLeagueInterest(selection: RegistrationSelectionInput): boolean {
  return (
    selection.selectionType === 'third_league_interest' ||
    selection.selectionType === 'return_subject_to_availability'
  );
}

function isJoinWaitlistSelection(selection: RegistrationSelectionInput): boolean {
  return (
    selection.selectionType === 'waitlist_add' ||
    selection.selectionType === 'waitlist_replace' ||
    selection.selectionType === 'waitlist_add_auto_decline' ||
    selection.selectionType === 'waitlist_replace_auto_decline'
  );
}

function isExistingWaitlistPreferenceSelection(selection: RegistrationSelectionInput): boolean {
  return (
    selection.selectionType === 'waitlist_keep_auto_accept' ||
    selection.selectionType === 'waitlist_keep_auto_decline' ||
    selection.selectionType === 'waitlist_remove'
  );
}

function existingWaitlistEntryForLeague(context: RegistrationContext, leagueId: number) {
  return context.existingWaitlistEntries.find(
    (entry) => entry.leagueId === leagueId && isActiveWaitlistEntry(entry),
  );
}

const SCHEDULED_LEAGUE_REQUEST_TYPES = [
  'guaranteed_return',
  'byot_request',
  'play_in_request',
] as const;

function selectedFirstTwoLeagueCount(context: RegistrationContext): number {
  return context.selections.filter((selection) =>
    SCHEDULED_LEAGUE_REQUEST_TYPES.includes(
      selection.selectionType as (typeof SCHEDULED_LEAGUE_REQUEST_TYPES)[number],
    ),
  ).length;
}

function hasReplacementLeague(context: RegistrationContext, leagueId: number): boolean {
  return (
    context.activeLeagueIds.includes(leagueId) ||
    context.selections.some(
      (selection) =>
        selection.leagueId === leagueId &&
        SCHEDULED_LEAGUE_REQUEST_TYPES.includes(
          selection.selectionType as (typeof SCHEDULED_LEAGUE_REQUEST_TYPES)[number],
        ),
    )
  );
}

function validateHybridByotRoster(
  context: RegistrationContext,
  league: NonNullable<ReturnType<typeof getSelectionLeague>>,
  selection: RegistrationSelectionInput,
  blockingErrors: DecisionMessage[],
  errorCode: 'byot_waitlist_requires_full_roster' | 'byot_play_in_requires_full_roster',
  emptyMessage: string,
  sizeMessage: (expectedSize: number) => string,
): void {
  if (league.leagueType !== 'bring_your_own_team') return;
  const expectedSize = expectedByotRosterSize(league);
  const rosterCounts = countHybridRoster({
    placements: selection.teamRosterPlacements,
    pendingRosterText: selection.byotTeammateText,
    teamRosterText: selection.teamRosterText,
    primaryMemberId: context.registrant.memberId,
    expectedSize,
  });
  if (expectedSize === null || rosterCounts.total !== expectedSize) {
    blockingErrors.push(
      blockingError(errorCode, expectedSize === null ? emptyMessage : sizeMessage(expectedSize)),
    );
  }
}

function validatePlayInRoster(
  context: RegistrationContext,
  league: NonNullable<ReturnType<typeof getSelectionLeague>>,
  selection: RegistrationSelectionInput,
  blockingErrors: DecisionMessage[],
): void {
  validateHybridByotRoster(
    context,
    league,
    selection,
    blockingErrors,
    'byot_play_in_requires_full_roster',
    'Play-in BYOT leagues require a full team roster.',
    (expectedSize) => `Play-in BYOT leagues require exactly ${expectedSize} players for this league.`,
  );
}

function isBasicIceIncludedDaytimeLeague(context: RegistrationContext, league: LeagueConfig): boolean {
  return (
    context.membershipOption === 'regular_spare_only' &&
    league.registrationFeeMinor === 0 &&
    !league.allowsWaitlist &&
    !league.isPlayInBased &&
    league.leagueType !== 'bring_your_own_team' &&
    league.format !== 'instructional'
  );
}

function validateNonGuaranteedLeagueInterest(
  context: RegistrationContext,
  league: NonNullable<ReturnType<typeof getSelectionLeague>>,
  blockingErrors: DecisionMessage[],
  warnings: DecisionMessage[],
  deferralReasonCodes: RegistrationReasonCode[]
): { blockingErrors: DecisionMessage[]; warnings: DecisionMessage[]; deferralReasonCodes: RegistrationReasonCode[] } {
  if (league.leagueType === 'bring_your_own_team') {
    blockingErrors.push(blockingError('byot_cannot_be_third_league', 'BYOT leagues cannot be third-league interest.'));
  }
  blockingErrors.push(...validateLeagueEligibility(context, league).blockingErrors);
  deferralReasonCodes.push('third_league_interest_defers_payment');
  return { blockingErrors, warnings, deferralReasonCodes };
}

function expectedByotRosterSize(league: { format: string }): number | null {
  if (league.format === 'teams') return 4;
  if (league.format === 'doubles') return 2;
  return null;
}

function rosterEntries(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function validateSelection(context: RegistrationContext, selection: RegistrationSelectionInput): {
  blockingErrors: DecisionMessage[];
  warnings: DecisionMessage[];
  deferralReasonCodes: RegistrationReasonCode[];
} {
  const blockingErrors: DecisionMessage[] = [];
  const warnings: DecisionMessage[] = [];
  const deferralReasonCodes: RegistrationReasonCode[] = [];
  const league = getSelectionLeague(context, selection);

  if (selection.selectionType === 'junior_recreational') {
    if (hasJuniorRecreationalConflict(context)) {
      blockingErrors.push(
        blockingError('junior_recreational_exclusive', 'Junior Recreational cannot be combined with other leagues or spare-only.')
      );
    }
    return { blockingErrors, warnings, deferralReasonCodes };
  }

  if (selection.selectionType === 'spare_only') {
    const spareOnly = validateSpareOnlyEligibility(context);
    blockingErrors.push(...spareOnly.blockingErrors);
    return { blockingErrors, warnings, deferralReasonCodes };
  }

  if (!league) {
    if (selection.leagueId !== null && selection.leagueId !== undefined) {
      blockingErrors.push(
        blockingError('league_not_in_registration_session', 'Selected league is not available for this registration session.')
      );
    }
    return { blockingErrors, warnings, deferralReasonCodes };
  }

  if (league.sessionId !== null && league.sessionId !== undefined && league.sessionId !== context.session.id) {
    blockingErrors.push(
      blockingError('league_not_in_registration_session', 'Selected league is not available for this registration session.')
    );
    return { blockingErrors, warnings, deferralReasonCodes };
  }

  if (selection.selectionType === 'drop') {
    return { blockingErrors, warnings, deferralReasonCodes };
  }

  if (selection.selectionType === 'guaranteed_return') {
    const leagueEligibility = validateLeagueEligibility(context, league);
    const returnEligibility = evaluateGuaranteedReturnEligibility(context, league);
    blockingErrors.push(...leagueEligibility.blockingErrors);
    blockingErrors.push(...returnEligibility.blockingErrors);
    warnings.push(...returnEligibility.warnings);
    return { blockingErrors, warnings, deferralReasonCodes };
  }

  if (selection.selectionType === 'sabbatical') {
    const sabbaticalEligibility = evaluateSabbaticalEligibility(context, league, {
      isTemporarySabbaticalFill: selection.isTemporarySabbaticalFill,
    });
    blockingErrors.push(...sabbaticalEligibility.blockingErrors);
    warnings.push(...sabbaticalEligibility.warnings);
    return { blockingErrors, warnings, deferralReasonCodes };
  }

  if (selection.selectionType === 'return_subject_to_availability') {
    return validateNonGuaranteedLeagueInterest(context, league, blockingErrors, warnings, deferralReasonCodes);
  }

  if (selection.selectionType === 'waitlist_add' || selection.selectionType === 'waitlist_replace') {
    const waitlistEligibility = validateWaitlistEligibility(context, league);
    blockingErrors.push(...waitlistEligibility.blockingErrors);
    if (waitlistSelectionDefersPayment(context, selection)) {
      deferralReasonCodes.push('waitlist_placement_pending');
    }

    if (league.leagueType === 'bring_your_own_team') {
      validateHybridByotRoster(
        context,
        league,
        selection,
        blockingErrors,
        'byot_waitlist_requires_full_roster',
        'BYOT waitlists require a full team roster.',
        (expectedSize) => `BYOT waitlists require exactly ${expectedSize} players for this league.`,
      );
    }

    if (selection.selectionType === 'waitlist_add' && activeLeagueCount(context) > 1) {
      blockingErrors.push(
        blockingError('add_waitlist_requires_zero_or_one_leagues', 'ADD waitlist entries are only available for members with zero or one current leagues.')
      );
    }
    if (selection.selectionType === 'waitlist_replace') {
      if (!selection.replacesLeagueId) {
        blockingErrors.push(
          blockingError('replace_waitlist_requires_replaced_league', 'REPLACE waitlist entries must identify a league to replace.')
        );
      } else if (!hasReplacementLeague(context, selection.replacesLeagueId)) {
        blockingErrors.push(
          blockingError('replace_waitlist_replacement_not_held', 'REPLACE waitlists must identify a league the registrant currently holds.')
        );
      }
      const selectedReplaceCount = context.selections.filter((item) => item.selectionType === 'waitlist_replace').length;
      if (activeReplaceWaitlistCount(context) + selectedReplaceCount > 2) {
        blockingErrors.push(
          blockingError('replace_waitlist_limit_exceeded', 'A registrant may have at most two active REPLACE waitlists.')
        );
      }
    }
    return { blockingErrors, warnings, deferralReasonCodes };
  }

  if (selection.selectionType === 'waitlist_add_auto_decline' || selection.selectionType === 'waitlist_replace_auto_decline') {
    const normalizedSelection: RegistrationSelectionInput = {
      ...selection,
      selectionType: selection.selectionType === 'waitlist_replace_auto_decline' ? 'waitlist_replace' : 'waitlist_add',
    };
    return validateSelection(context, normalizedSelection);
  }

  if (isExistingWaitlistPreferenceSelection(selection)) {
    if (!existingWaitlistEntryForLeague(context, league.id)) {
      blockingErrors.push(
        blockingError('existing_waitlist_not_found', 'This waitlist choice does not match an active waitlist entry.')
      );
    }
    if (selection.selectionType === 'waitlist_remove') {
      return { blockingErrors, warnings, deferralReasonCodes };
    }
    deferralReasonCodes.push('waitlist_placement_pending');
    return { blockingErrors, warnings, deferralReasonCodes };
  }

  if (selection.selectionType === 'third_league_interest') {
    return validateNonGuaranteedLeagueInterest(context, league, blockingErrors, warnings, deferralReasonCodes);
  }

  if (selection.selectionType === 'byot_request') {
    const leagueEligibility = validateLeagueEligibility(context, league);
    blockingErrors.push(...leagueEligibility.blockingErrors);
    if (league.leagueType !== 'bring_your_own_team') {
      blockingErrors.push(blockingError('byot_requires_teammates', 'BYOT requests must target a BYOT league.'));
    }
    if (!selection.byotTeammateText?.trim()) {
      blockingErrors.push(blockingError('byot_requires_teammates', 'BYOT requests require teammate names.'));
    }
    if (activeLeagueCount(context) + selectedFirstTwoLeagueCount(context) > 2) {
      blockingErrors.push(blockingError('byot_cannot_be_third_league', 'BYOT leagues must count as one of the first two leagues.'));
    }
    return { blockingErrors, warnings, deferralReasonCodes };
  }

  if (selection.selectionType === 'play_in_request') {
    const leagueEligibility = validateLeagueEligibility(context, league);
    blockingErrors.push(...leagueEligibility.blockingErrors);
    if (!league.isPlayInBased) {
      blockingErrors.push(blockingError('play_in_not_enabled', 'This league does not use play-in based registration.'));
    }
    validatePlayInRoster(context, league, selection, blockingErrors);
    if (!selection.replacesLeagueId) {
      if (activeLeagueCount(context) > 1) {
        blockingErrors.push(
          blockingError('play_in_add_requires_zero_or_one_leagues', 'Play-in ADD requests are only available for members with zero or one current leagues.'),
        );
      }
      if (activeLeagueCount(context) + selectedFirstTwoLeagueCount(context) > 2) {
        blockingErrors.push(blockingError('play_in_cannot_be_third_league', 'Play-in leagues must count as one of the first two leagues.'));
      }
    } else if (!hasReplacementLeague(context, selection.replacesLeagueId)) {
      blockingErrors.push(
        blockingError('play_in_replace_replacement_not_held', 'Play-in REPLACE requests must identify a league the registrant currently holds.'),
      );
    }
    if (playInSelectionDefersPayment(context, selection)) {
      deferralReasonCodes.push('play_in_placement_pending');
    }
    return { blockingErrors, warnings, deferralReasonCodes };
  }

  if (selection.selectionType === 'instructional_join') {
    const leagueEligibility = validateLeagueEligibility(context, league);
    blockingErrors.push(...leagueEligibility.blockingErrors);
    const basicIceDaytimeLeague = isBasicIceIncludedDaytimeLeague(context, league);
    if (!basicIceDaytimeLeague) {
      if (league.format !== 'instructional') {
        blockingErrors.push(blockingError('instructional_join_requires_instructional', 'Only instructional leagues can use instructional join.'));
      }
      if (league.isPlayInBased) {
        blockingErrors.push(blockingError('instructional_join_not_play_in', 'Instructional leagues cannot be play-in based.'));
      }
      if (league.allowsWaitlist) {
        blockingErrors.push(blockingError('instructional_join_not_waitlisted', 'Instructional leagues with waitlists must be joined through the waitlist.'));
      }
    }
    return { blockingErrors, warnings, deferralReasonCodes };
  }

  return { blockingErrors, warnings, deferralReasonCodes };
}

export function validateRegistrationSelections(context: RegistrationContext): SelectionValidationResult {
  const blockingErrors: DecisionMessage[] = [];
  const warnings: DecisionMessage[] = [];
  const deferralReasonCodes: RegistrationReasonCode[] = [];
  const registrationOpen = validateRegistrationIsOpen(context);
  blockingErrors.push(...registrationOpen.blockingErrors);

  if (protectedClaimCount(context) > 2) {
    blockingErrors.push(blockingError('protected_claim_limit_exceeded', 'A registrant may protect at most two league claims.'));
  }

  for (const selection of context.selections) {
    const result = validateSelection(context, selection);
    blockingErrors.push(...result.blockingErrors);
    warnings.push(...result.warnings);
    deferralReasonCodes.push(...result.deferralReasonCodes);
  }

  blockingErrors.push(...validateWaitlistFulfillment(context, context.desiredAddWaitlistLeagueCount));

  const rankedThirdLeagueInterest = context.selections
    .filter((selection) => isNonGuaranteedLeagueInterest(selection))
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

  const decision = createDecision({
    status: blockingErrors.length > 0 ? 'invalid' : 'valid',
    allowed: blockingErrors.length === 0,
    blockingErrors,
    warnings,
    reasonCodes: deferralReasonCodes,
    requiresStaffReview: warnings.some((warning) => warning.code === 'sabbatical_staff_override_required'),
  });

  return {
    ...decision,
    deferralReasonCodes: Array.from(new Set(deferralReasonCodes)),
    rankedThirdLeagueInterest,
  };
}

export function registrationTouchesWaitlistChoices(selections: RegistrationSelectionInput[]): boolean {
  return selections.some((selection) => selection.selectionType.startsWith('waitlist_'));
}

export function evaluateExistingWaitlistPreferences(context: RegistrationContext): BusinessDecision<'valid' | 'invalid'> {
  const blockingErrors: DecisionMessage[] = [];
  for (const entry of context.existingWaitlistEntries.filter((item) => isActiveWaitlistEntry(item))) {
    const preference = context.selections.find((selection) => selection.leagueId === entry.leagueId);
    const hasPreference =
      preference != null &&
      (isExistingWaitlistPreferenceSelection(preference) || isJoinWaitlistSelection(preference));
    if (!hasPreference) {
      blockingErrors.push(
        blockingError(
          'existing_waitlist_preference_required',
          'Choose what to do with each current waitlist before continuing.'
        )
      );
      break;
    }
  }
  return createDecision({
    status: blockingErrors.length > 0 ? 'invalid' : 'valid',
    allowed: blockingErrors.length === 0,
    blockingErrors,
  });
}

export function evaluateWaitlistCleanup(context: RegistrationContext): BusinessDecision<'valid' | 'cleanup_required'> {
  const activeAddWaitlists = context.existingWaitlistEntries.filter(
    (entry) => isActiveWaitlistEntry(entry) && entry.entryType === 'add'
  );
  if (activeLeagueCount(context) >= 2 && activeAddWaitlists.length > 0) {
    return createDecision({
      status: 'cleanup_required',
      allowed: false,
      blockingErrors: [
        blockingError(
          'add_waitlist_cleanup_required',
          'Active ADD waitlists must be removed or converted after reaching two leagues.'
        ),
      ],
    });
  }
  return createDecision({ status: 'valid', allowed: true });
}
