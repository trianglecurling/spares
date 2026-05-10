import { validateLeagueEligibility, validateRegistrationIsOpen, validateSpareOnlyEligibility, validateWaitlistEligibility } from './registrationEligibility.js';
import { evaluateGuaranteedReturnEligibility, evaluateSabbaticalEligibility, protectedClaimCount } from './registrationReturningRights.js';
import { blockingError, createDecision, type BusinessDecision, type DecisionMessage, type RegistrationReasonCode } from './registrationDecisionTypes.js';
import {
  activeLeagueCount,
  getSelectionLeague,
  isActiveWaitlistEntry,
  type RegistrationContext,
  type RegistrationSelectionInput,
} from './registrationContext.js';

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

function selectedFirstTwoLeagueCount(context: RegistrationContext): number {
  return context.selections.filter((selection) =>
    ['guaranteed_return', 'return_subject_to_availability', 'byot_request'].includes(selection.selectionType)
  ).length;
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
    const leagueEligibility = validateLeagueEligibility(context, league);
    blockingErrors.push(...leagueEligibility.blockingErrors);
    deferralReasonCodes.push('non_guaranteed_league_defers_payment', 'return_subject_to_availability');
    return { blockingErrors, warnings, deferralReasonCodes };
  }

  if (selection.selectionType === 'waitlist_add' || selection.selectionType === 'waitlist_replace') {
    const waitlistEligibility = validateWaitlistEligibility(context, league);
    blockingErrors.push(...waitlistEligibility.blockingErrors);
    deferralReasonCodes.push('waitlist_placement_pending');

    if (selection.selectionType === 'waitlist_add' && activeLeagueCount(context) > 1) {
      blockingErrors.push(
        blockingError('add_waitlist_requires_zero_or_one_leagues', 'ADD waitlist entries require zero or one current leagues.')
      );
    }
    if (selection.selectionType === 'waitlist_replace') {
      if (!selection.replacesLeagueId) {
        blockingErrors.push(
          blockingError('replace_waitlist_requires_replaced_league', 'REPLACE waitlist entries must identify a league to replace.')
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

  if (selection.selectionType === 'third_league_interest') {
    if (league.leagueType === 'bring_your_own_team') {
      blockingErrors.push(blockingError('byot_cannot_be_third_league', 'BYOT leagues cannot be third-league interest.'));
    }
    deferralReasonCodes.push('third_league_interest_defers_payment');
    return { blockingErrors, warnings, deferralReasonCodes };
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

  const rankedThirdLeagueInterest = context.selections
    .filter((selection) => selection.selectionType === 'third_league_interest')
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
