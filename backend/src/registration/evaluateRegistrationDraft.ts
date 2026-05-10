import { calculateRegistrationFees } from './registrationFeeCalculator.js';
import { validateRegistrationSelections } from './registrationLeagueSelections.js';
import { decideRegistrationPayment } from './registrationPaymentDecision.js';
import type { RegistrationContext } from './registrationContext.js';

export function evaluateRegistrationDraft(context: RegistrationContext) {
  const selectionValidation = validateRegistrationSelections(context);
  const feePreview = calculateRegistrationFees(context);
  const paymentDecision = decideRegistrationPayment({ context, feePreview, selectionValidation });

  return {
    selectionValidation,
    feePreview,
    paymentDecision,
  };
}
