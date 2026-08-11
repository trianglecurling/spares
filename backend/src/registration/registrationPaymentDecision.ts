import { createDecision, type BusinessDecision, type RegistrationReasonCode } from './registrationDecisionTypes.js';
import type { RegistrationFeePreview } from './registrationFeeCalculator.js';
import { evaluateLeaguePriorities, type PriorityValidationResult } from './leaguePriorityEvaluation.js';
import { getLeague, type RegistrationContext } from './registrationContext.js';

export type RegistrationPaymentOutcome = 'immediate_payment' | 'deferred_payment' | 'no_payment_required';

export type RegistrationPaymentDecision = BusinessDecision<RegistrationPaymentOutcome> & {
  outcome: RegistrationPaymentOutcome;
  deferralReasons: RegistrationReasonCode[];
  createStripeCheckoutNow: boolean;
  paymentLinkMayBeGeneratedLater: boolean;
  totalDueMinor: number;
  /**
   * Quoted range for a deferred registration. Equal to `totalDueMinor` on both
   * ends when the registrant's guarantees already fill their desired count.
   */
  estimatedMinimumDueMinor: number;
  estimatedMaximumDueMinor: number;
};

/**
 * Payment can be collected now only when the registrant's guaranteed entries
 * fill their desired league count. Anything short of that leaves the final
 * amount unresolved, so we quote a range and bill later.
 */
function leagueDeferralReasons(context: RegistrationContext): RegistrationReasonCode[] {
  const evaluation = evaluateLeaguePriorities(context);
  if (evaluation.guaranteedCount >= evaluation.desiredLeagueCount) return [];

  const reasons: RegistrationReasonCode[] = [];
  for (const entry of evaluation.entries) {
    if (entry.guaranteed) continue;
    if (getLeague(context, entry.leagueId)?.isPlayInBased) {
      reasons.push('play_in_placement_pending');
    } else if (entry.label === 'waitlisted') {
      reasons.push('waitlist_placement_pending');
    } else {
      reasons.push('non_guaranteed_league_defers_payment');
    }
  }
  // The registrant wants more leagues than they listed reachable options for.
  if (reasons.length === 0) reasons.push('non_guaranteed_league_defers_payment');
  return reasons;
}

function assistanceDeferralReasons(context: RegistrationContext): RegistrationReasonCode[] {
  if (
    context.membershipOption === 'junior_recreational' &&
    context.juniorAssistance?.requestedPercent &&
    context.juniorAssistance.status !== 'approved' &&
    context.juniorAssistance.status !== 'partially_approved'
  ) {
    return ['junior_financial_assistance_requires_review', 'staff_review_required'];
  }
  return [];
}

export function decideRegistrationPayment(input: {
  context: RegistrationContext;
  feePreview: RegistrationFeePreview;
  priorityValidation?: PriorityValidationResult;
  /**
   * Set once every placement has resolved, so pending leagues no longer defer
   * the bill and the remaining balance can be collected.
   */
  placementSettled?: boolean;
}): RegistrationPaymentDecision {
  const staffReviewReasons = input.priorityValidation?.requiresStaffReview ? ['staff_review_required' as const] : [];
  const deferralReasons = Array.from(
    new Set([
      ...(input.placementSettled ? [] : leagueDeferralReasons(input.context)),
      ...assistanceDeferralReasons(input.context),
      ...staffReviewReasons,
    ]),
  );

  const totalDueMinor = input.feePreview.totalDueMinor;
  const estimatedMaximumDueMinor = Math.max(totalDueMinor, input.feePreview.estimatedMaximumTotalDueMinor);
  const hasCharge = totalDueMinor > 0 || estimatedMaximumDueMinor > 0;
  const outcome: RegistrationPaymentOutcome = !hasCharge
    ? 'no_payment_required'
    : deferralReasons.length > 0
      ? 'deferred_payment'
      : 'immediate_payment';

  const decision = createDecision({
    status: outcome,
    allowed: true,
    reasonCodes:
      outcome === 'deferred_payment'
        ? deferralReasons
        : outcome === 'no_payment_required'
          ? ['no_payment_due']
          : ['all_items_guaranteed'],
    messages: [
      outcome === 'deferred_payment'
        ? 'Payment is deferred because registration includes pending placement or staff review.'
        : outcome === 'no_payment_required'
          ? 'No payment is required now.'
          : 'Payment can be collected immediately.',
    ],
    requiresStaffReview: deferralReasons.includes('staff_review_required'),
  });

  return {
    ...decision,
    outcome,
    deferralReasons,
    createStripeCheckoutNow: outcome === 'immediate_payment',
    paymentLinkMayBeGeneratedLater: outcome === 'deferred_payment',
    totalDueMinor,
    estimatedMinimumDueMinor: totalDueMinor,
    estimatedMaximumDueMinor,
  };
}
