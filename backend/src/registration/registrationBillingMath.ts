export const SETTLED_REGISTRATION_PAYMENT_STATUSES = new Set([
  'succeeded',
  'partially_refunded',
  'refunded',
  'pending_refund',
]);

/** Refunds that reduce net paid, including Square/in-flight rows that have not yet settled. */
export const COUNTED_REGISTRATION_REFUND_STATUSES = new Set([
  'succeeded',
  'processing',
  'requested',
  'approved',
]);

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
    .filter((entry) => entry.kind === 'refund' && COUNTED_REGISTRATION_REFUND_STATUSES.has(entry.status))
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

export type StaffPaidRegistrationAdjustmentKind = 'none' | 'refund' | 'balance_due';

/**
 * Compare a paid registration's new bill to what is already on file.
 * Refunds from this comparison must be staff-approved; callers should not
 * issue them automatically.
 */
export function staffPaidRegistrationAdjustment(
  owedMinor: number,
  paidMinor: number,
): { kind: StaffPaidRegistrationAdjustmentKind; adjustmentMinor: number } {
  const paid = Math.max(0, Math.round(paidMinor));
  const adjustmentMinor = registrationBalanceMinor(owedMinor, paid);
  if (paid <= 0 || adjustmentMinor === 0) {
    return { kind: 'none', adjustmentMinor: 0 };
  }
  if (adjustmentMinor < 0) {
    return { kind: 'refund', adjustmentMinor };
  }
  return { kind: 'balance_due', adjustmentMinor };
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
 * Apply money already paid to current invoice charges in order (membership,
 * then later fees). Fully covered charges are omitted so Square can sell the
 * remaining catalog items instead of a synthetic "amount already paid" credit.
 */
export function applyPriorPaidToInvoiceLines<T extends { amountMinor: number }>(
  invoiceLines: T[],
  priorPaidMinor: number,
): T[] {
  const remainingPaid = Math.max(0, Math.round(priorPaidMinor));
  if (remainingPaid <= 0) return invoiceLines;

  let leftoverPaid = remainingPaid;
  const leftoverCharges: T[] = [];
  const discounts: T[] = [];
  for (const line of invoiceLines) {
    if (line.amountMinor < 0) {
      discounts.push(line);
      continue;
    }
    if (leftoverPaid >= line.amountMinor) {
      leftoverPaid -= line.amountMinor;
      continue;
    }
    if (leftoverPaid > 0) {
      leftoverCharges.push({ ...line, amountMinor: line.amountMinor - leftoverPaid });
      leftoverPaid = 0;
      continue;
    }
    leftoverCharges.push(line);
  }
  return [...leftoverCharges, ...discounts];
}

/**
 * Build Square/Stripe checkout lines for a registration charge.
 * Prior payments cover leading invoice charges and drop those items from the
 * cart. Real discounts stay; the checkout total must still match the remaining
 * amount due.
 */
export function curlingRegistrationCheckoutLineItems(input: {
  invoiceLines: Array<{ description: string; amountMinor: number }>;
  orderAmountMinor: number;
  priorPaidMinor?: number | null;
  allowBalanceFallback?: boolean;
}): CurlingCheckoutLine[] | undefined {
  const priorPaidMinor = Math.max(0, Math.round(input.priorPaidMinor ?? 0));
  const lineItems: CurlingCheckoutLine[] = applyPriorPaidToInvoiceLines(
    input.invoiceLines
      .map((line) => ({
        description: line.description.trim(),
        amountMinor: line.amountMinor,
      }))
      .filter((line) => line.description.length > 0 && line.amountMinor !== 0),
    priorPaidMinor,
  );

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
