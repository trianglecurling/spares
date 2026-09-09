export const SETTLED_REGISTRATION_PAYMENT_STATUSES = new Set([
  'succeeded',
  'partially_refunded',
  'refunded',
  'pending_refund',
]);

export const AMOUNT_ALREADY_PAID_DESCRIPTION = 'Amount already paid';
export const REGISTRATION_REFUND_NOTE_MAX_LENGTH = 160;
export const DEFAULT_REGISTRATION_REFUND_NOTE = 'Registration overpayment refund';

export type RegistrationPaymentActivityLike = {
  kind: 'payment' | 'refund';
  status: string;
  amountMinor: number;
};

export type RegistrationInvoicePaidLike = {
  status: string;
  totalMinor: number;
  offlinePaymentNote?: string | null;
};

export function checkoutLinesTotalMinor(lines: Array<{ amountMinor: number }>): number {
  return lines.reduce((sum, line) => sum + line.amountMinor, 0);
}

export function netPaidMinorFromPaymentActivity(
  activity: RegistrationPaymentActivityLike[],
  latestInvoice?: RegistrationInvoicePaidLike | null,
): number {
  const grossPaymentsMinor = activity
    .filter((entry) => entry.kind === 'payment' && SETTLED_REGISTRATION_PAYMENT_STATUSES.has(entry.status))
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
  const refundsMinor = activity
    .filter((entry) => entry.kind === 'refund' && entry.status === 'succeeded')
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
  let netPaymentsMinor = grossPaymentsMinor - refundsMinor;
  const offlineNote = latestInvoice?.offlinePaymentNote?.trim() ?? '';
  if (latestInvoice?.status === 'paid' && offlineNote && netPaymentsMinor < latestInvoice.totalMinor) {
    netPaymentsMinor = latestInvoice.totalMinor;
  }
  return Math.max(0, netPaymentsMinor);
}

/** Positive: they still owe us. Negative: we owe them a refund. */
export function registrationBalanceMinor(owedMinor: number, paidMinor: number): number {
  return Math.round(owedMinor) - Math.round(paidMinor);
}

export function remainingDueMinor(owedMinor: number, paidMinor: number): number {
  return Math.max(0, registrationBalanceMinor(owedMinor, paidMinor));
}

export function refundDueMinor(owedMinor: number, paidMinor: number): number {
  return Math.max(0, -registrationBalanceMinor(owedMinor, paidMinor));
}

export function refundableRemainingMinor(orderAmountMinor: number, succeededRefundsMinor: number): number {
  return Math.max(0, Math.round(orderAmountMinor) - Math.round(succeededRefundsMinor));
}

export function parseRegistrationRefundNote(
  note: string | null | undefined,
): { ok: true; note: string } | { ok: false; error: string } {
  const trimmed = note?.trim() ?? '';
  if (!trimmed) {
    return { ok: false, error: 'Enter a refund note.' };
  }
  if (trimmed.length > REGISTRATION_REFUND_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      error: `The refund note must be ${REGISTRATION_REFUND_NOTE_MAX_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, note: trimmed };
}

export type CurlingCheckoutLine = {
  description: string;
  amountMinor: number;
};

/**
 * Build Square/Stripe checkout lines for a registration charge.
 * Invoice lines are the current bill; a prior-paid credit is appended so the
 * checkout total matches the remaining amount due.
 */
export function curlingRegistrationCheckoutLineItems(input: {
  invoiceLines: Array<{ description: string; amountMinor: number }>;
  orderAmountMinor: number;
  priorPaidMinor?: number | null;
  allowBalanceFallback?: boolean;
}): CurlingCheckoutLine[] | undefined {
  const priorPaidMinor = Math.max(0, Math.round(input.priorPaidMinor ?? 0));
  const lineItems: CurlingCheckoutLine[] = input.invoiceLines
    .map((line) => ({
      description: line.description.trim(),
      amountMinor: line.amountMinor,
    }))
    .filter((line) => line.description.length > 0 && line.amountMinor !== 0);

  if (priorPaidMinor > 0) {
    lineItems.push({
      description: AMOUNT_ALREADY_PAID_DESCRIPTION,
      amountMinor: -priorPaidMinor,
    });
  }

  if (lineItems.length > 0 && checkoutLinesTotalMinor(lineItems) === input.orderAmountMinor) {
    return lineItems;
  }

  if (input.allowBalanceFallback) {
    return [
      {
        description: 'Registration balance payment',
        amountMinor: input.orderAmountMinor,
      },
    ];
  }

  return undefined;
}
