import { createDecision, type BusinessDecision, type RegistrationReasonCode } from './registrationDecisionTypes.js';
import type { RegistrationFeePreview } from './registrationFeeCalculator.js';
import { evaluateLeaguePriorities, leaguePlacementDeferralReasons, type PriorityValidationResult } from './leaguePriorityEvaluation.js';
import type { RegistrationContext } from './registrationContext.js';

export type RegistrationPaymentOutcome = 'immediate_payment' | 'deferred_payment' | 'no_payment_required';

export type RegistrationPaymentDecision = BusinessDecision<RegistrationPaymentOutcome> & {
  outcome: RegistrationPaymentOutcome;
  deferralReasons: RegistrationReasonCode[];
  createStripeCheckoutNow: boolean;
  paymentLinkMayBeGeneratedLater: boolean;
  totalDueMinor: number;
  /**
   * Quoted range for a deferred registration. Equal to `totalDueMinor` on both
   * ends when unresolved leftovers cannot change the amount due.
   */
  estimatedMinimumDueMinor: number;
  estimatedMaximumDueMinor: number;
};

/**
 * Unresolved waitlists, incomplete rosters, play-in misses, and
 * subject-to-availability leftovers. Payment only waits on these when they can
 * still change the quoted total; fee-0 leftovers that leave floor equal to
 * ceiling do not defer checkout.
 */
function leagueDeferralReasons(context: RegistrationContext): RegistrationReasonCode[] {
  return leaguePlacementDeferralReasons(evaluateLeaguePriorities(context));
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
  const totalDueMinor = input.feePreview.totalDueMinor;
  const estimatedMaximumDueMinor = Math.max(totalDueMinor, input.feePreview.estimatedMaximumTotalDueMinor);
  // Quoted floor, not a membership-only placeholder. Unconfirmed leftover
  // leagues still defer when they can change this range.
  const amountDueIsSettled = estimatedMaximumDueMinor <= totalDueMinor;
  const deferralReasons = Array.from(
    new Set([
      ...(input.placementSettled || amountDueIsSettled ? [] : leagueDeferralReasons(input.context)),
      ...assistanceDeferralReasons(input.context),
      ...staffReviewReasons,
    ]),
  );

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
