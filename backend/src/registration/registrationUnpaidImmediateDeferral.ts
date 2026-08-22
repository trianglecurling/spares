const UNPAID_IMMEDIATE_REGISTRATION_STATUSES = new Set(['awaiting_payment', 'payment_started']);
const UNPAID_INVOICE_STATUSES = new Set(['awaiting_payment', 'checkout_started']);
const REQUEST_PAYMENT_REGISTRATION_STATUSES = new Set(['awaiting_placement', 'awaiting_staff_review']);

export function unpaidImmediateRegistrationCanDefer(input: {
  registrationStatus: string;
  invoiceStatus: string | null | undefined;
  invoiceDeferred?: number | boolean | null;
}): boolean {
  if (!UNPAID_IMMEDIATE_REGISTRATION_STATUSES.has(input.registrationStatus)) return false;
  if (!input.invoiceStatus || !UNPAID_INVOICE_STATUSES.has(input.invoiceStatus)) return false;
  return !input.invoiceDeferred;
}

export function staffCanRequestDeferredPayment(registrationStatus: string): boolean {
  return REQUEST_PAYMENT_REGISTRATION_STATUSES.has(registrationStatus);
}
