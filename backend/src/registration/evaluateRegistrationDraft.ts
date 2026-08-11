import { calculateRegistrationFees } from './registrationFeeCalculator.js';
import { validateLeaguePriorities } from './leaguePriorityEvaluation.js';
import { decideRegistrationPayment } from './registrationPaymentDecision.js';
import type { RegistrationContext } from './registrationContext.js';

export function evaluateRegistrationDraft(context: RegistrationContext) {
  const priorityValidation = validateLeaguePriorities(context);
  const feePreview = calculateRegistrationFees(context);
  const paymentDecision = decideRegistrationPayment({ context, feePreview, priorityValidation });

  return {
    priorityValidation,
    priorityEvaluation: priorityValidation.evaluation,
    feePreview,
    paymentDecision,
  };
}
