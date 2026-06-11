import { canExtendSabbaticalIntoLeague } from './sabbaticalDurationLimit.js';
import { blockingError, createDecision, type BusinessDecision, type DecisionMessage } from './registrationDecisionTypes.js';
import type { ExistingSabbatical, LeagueConfig, RegistrationContext } from './registrationContext.js';

function isActiveSabbatical(sabbatical: ExistingSabbatical): boolean {
  return sabbatical.status === 'active' || sabbatical.status === 'staff_overridden' || sabbatical.status === 'returning';
}

function sabbaticalMatchesLeagueLineage(sabbatical: ExistingSabbatical, league: LeagueConfig): boolean {
  return (
    sabbatical.currentLeagueId === league.predecessorLeagueId ||
    sabbatical.originalLeagueId === league.predecessorLeagueId ||
    sabbatical.currentLeagueId === league.id ||
    sabbatical.originalLeagueId === league.id
  );
}

export function protectedClaimCount(context: RegistrationContext): number {
  return context.selections.filter(
    (selection) => selection.selectionType === 'guaranteed_return' || selection.selectionType === 'sabbatical',
  ).length;
}

export function activeSabbaticalCount(context: RegistrationContext): number {
  return context.existingSabbaticals.filter(isActiveSabbatical).length;
}

export function findRelevantSabbatical(
  context: RegistrationContext,
  league: LeagueConfig
): ExistingSabbatical | undefined {
  return context.existingSabbaticals.find(
    (sabbatical) => isActiveSabbatical(sabbatical) && sabbaticalMatchesLeagueLineage(sabbatical, league)
  );
}

export function evaluateGuaranteedReturnEligibility(
  context: RegistrationContext,
  league: LeagueConfig
): BusinessDecision<'eligible' | 'ineligible'> {
  const blockingErrors: DecisionMessage[] = [];

  if (context.registrationState !== 'priority') {
    blockingErrors.push(blockingError('not_priority_registration', 'Guaranteed returns are available only during priority registration.'));
  }
  if (!context.registrant.isReturningMember) {
    blockingErrors.push(
      blockingError('guaranteed_return_requires_predecessor_participation', 'Guaranteed return requires returning member history.')
    );
  }
  if (league.predecessorLeagueId === null || league.predecessorLeagueId === undefined) {
    blockingErrors.push(
      blockingError('guaranteed_return_requires_predecessor', 'Guaranteed return requires a configured predecessor league.')
    );
  } else {
    const playedPredecessor = context.participatedLeagueIds.includes(league.predecessorLeagueId);
    const hasSabbaticalRight = findRelevantSabbatical(context, league) !== undefined;
    if (!playedPredecessor && !hasSabbaticalRight) {
      blockingErrors.push(
        blockingError(
          'guaranteed_return_requires_predecessor_participation',
          'Guaranteed return requires predecessor league participation or a qualifying sabbatical.'
        )
      );
    }
  }

  if (protectedClaimCount(context) > 2) {
    blockingErrors.push(blockingError('protected_claim_limit_exceeded', 'A registrant may protect at most two league claims.'));
  }

  return createDecision({
    status: blockingErrors.length > 0 ? 'ineligible' : 'eligible',
    eligible: blockingErrors.length === 0,
    blockingErrors,
  });
}

export function evaluateSabbaticalEligibility(
  context: RegistrationContext,
  league: LeagueConfig,
  options: { isTemporarySabbaticalFill?: boolean } = {}
): BusinessDecision<'eligible' | 'ineligible' | 'requires_staff_review'> {
  const blockingErrors: DecisionMessage[] = [];
  const warnings: DecisionMessage[] = [];

  const returnEligibility = evaluateGuaranteedReturnEligibility(context, league);
  if (!returnEligibility.eligible) {
    blockingErrors.push(blockingError('sabbatical_requires_return_right', 'Sabbatical requires guaranteed return eligibility.'));
  }
  if (!league.allowsSabbatical) {
    blockingErrors.push(blockingError('byot_no_sabbatical', 'This league does not allow sabbaticals.'));
  }
  if (league.leagueType === 'bring_your_own_team') {
    blockingErrors.push(blockingError('byot_no_sabbatical', 'Bring-your-own-team leagues do not use sabbaticals.'));
  }
  if (options.isTemporarySabbaticalFill) {
    blockingErrors.push(
      blockingError('sabbatical_not_for_temporary_fill', 'Temporary sabbatical-fill spots do not create sabbatical rights.')
    );
  }
  if (protectedClaimCount(context) > 2) {
    blockingErrors.push(blockingError('protected_claim_limit_exceeded', 'A registrant may protect at most two league claims.'));
  }
  if (activeSabbaticalCount(context) > 2) {
    blockingErrors.push(blockingError('sabbatical_limit_exceeded', 'A registrant may be on sabbatical for at most two leagues.'));
  }

  const relevantSabbatical = findRelevantSabbatical(context, league);
  if (relevantSabbatical) {
    const durationCheck = canExtendSabbaticalIntoLeague({
      sabbatical: relevantSabbatical,
      league,
      durationLimitYears: context.sabbaticalDurationLimitYears,
      staffOverrideSabbaticalDuration: context.staffOverrideSabbaticalDuration,
    });
    if (durationCheck.requiresStaffReview) {
      warnings.push({
        code: 'sabbatical_staff_override_required',
        message: 'Sabbatical duration limit requires staff override.',
        severity: 'warning',
      });
    } else if (!durationCheck.allowed) {
      blockingErrors.push(
        blockingError(
          'sabbatical_duration_limit_exceeded',
          durationCheck.blockedMessage ?? 'Sabbatical duration limit has been reached.',
        ),
      );
    }
  }

  return createDecision({
    status: blockingErrors.length > 0 ? 'ineligible' : warnings.length > 0 ? 'requires_staff_review' : 'eligible',
    eligible: blockingErrors.length === 0,
    blockingErrors,
    warnings,
    requiresStaffReview: warnings.length > 0,
  });
}
