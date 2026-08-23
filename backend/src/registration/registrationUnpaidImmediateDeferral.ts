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

const RECORDABLE_OFFLINE_INVOICE_STATUSES = new Set([
  'draft',
  'deferred',
  'awaiting_payment',
  'checkout_started',
  'failed',
]);

export const OFFLINE_PAYMENT_NOTE_MAX_LENGTH = 500;

export function staffCanRecordOfflinePayment(input: {
  registrationStatus: string;
  invoiceStatus: string | null | undefined;
}): boolean {
  if (input.registrationStatus === 'cancelled') return false;
  return Boolean(input.invoiceStatus && RECORDABLE_OFFLINE_INVOICE_STATUSES.has(input.invoiceStatus));
}

export function parseOfflinePaymentNote(
  note: string | null | undefined,
): { ok: true; note: string } | { ok: false; error: string } {
  const trimmed = note?.trim() ?? '';
  if (!trimmed) {
    return { ok: false, error: 'Enter a check number or other explanation.' };
  }
  if (trimmed.length > OFFLINE_PAYMENT_NOTE_MAX_LENGTH) {
    return { ok: false, error: `The payment comment must be ${OFFLINE_PAYMENT_NOTE_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, note: trimmed };
}
