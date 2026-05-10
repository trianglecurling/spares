import { createDecision, type BusinessDecision, type RegistrationReasonCode } from './registrationDecisionTypes.js';
import type { RegistrationFeePreview } from './registrationFeeCalculator.js';
import type { SelectionValidationResult } from './registrationLeagueSelections.js';
import type { RegistrationContext } from './registrationContext.js';

export type RegistrationPaymentOutcome = 'immediate_payment' | 'deferred_payment' | 'no_payment_required';

export type RegistrationPaymentDecision = BusinessDecision<RegistrationPaymentOutcome> & {
  outcome: RegistrationPaymentOutcome;
  deferralReasons: RegistrationReasonCode[];
  createStripeCheckoutNow: boolean;
  paymentLinkMayBeGeneratedLater: boolean;
  totalDueMinor: number;
};

function selectionDeferralReasons(context: RegistrationContext): RegistrationReasonCode[] {
  const reasons: RegistrationReasonCode[] = [];
  for (const selection of context.selections) {
    if (selection.selectionType === 'return_subject_to_availability') {
      reasons.push('non_guaranteed_league_defers_payment', 'return_subject_to_availability');
    }
    if (selection.selectionType === 'waitlist_add' || selection.selectionType === 'waitlist_replace') {
      reasons.push('waitlist_placement_pending');
    }
    if (selection.selectionType === 'third_league_interest') {
      reasons.push('third_league_interest_defers_payment');
    }
  }
  if (
    context.membershipOption === 'junior_recreational' &&
    context.juniorAssistance?.requestedPercent &&
    context.juniorAssistance.status !== 'approved' &&
    context.juniorAssistance.status !== 'partially_approved'
  ) {
    reasons.push('junior_financial_assistance_requires_review', 'staff_review_required');
  }
  return reasons;
}

export function decideRegistrationPayment(input: {
  context: RegistrationContext;
  feePreview: RegistrationFeePreview;
  selectionValidation?: SelectionValidationResult;
}): RegistrationPaymentDecision {
  const validationReasons = input.selectionValidation?.deferralReasonCodes ?? [];
  const staffReviewReasons = input.selectionValidation?.requiresStaffReview ? ['staff_review_required' as const] : [];
  const deferralReasons = Array.from(
    new Set([...selectionDeferralReasons(input.context), ...validationReasons, ...staffReviewReasons])
  );
  const totalDueMinor = input.feePreview.totalDueMinor;
  const outcome: RegistrationPaymentOutcome =
    totalDueMinor <= 0 ? 'no_payment_required' : deferralReasons.length > 0 ? 'deferred_payment' : 'immediate_payment';

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
  };
}
