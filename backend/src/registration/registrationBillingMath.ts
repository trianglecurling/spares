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

export type RegistrationCheckoutInvoiceLine = {
  description?: string;
  amountMinor: number;
  lineType?: string;
  relatedLeagueId?: number | null;
  discountEligible?: boolean | number;
};

function isPositiveCharge(line: RegistrationCheckoutInvoiceLine): boolean {
  return line.amountMinor > 0;
}

function isDiscountEligibleCharge(line: RegistrationCheckoutInvoiceLine): boolean {
  if (line.discountEligible === false || line.discountEligible === 0) return false;
  return line.lineType !== 'sabbatical_fee' && line.lineType !== 'replacement_name_tag_fee';
}

function discountTargetIndices<T extends RegistrationCheckoutInvoiceLine>(charges: T[], discount: T): number[] {
  if (discount.relatedLeagueId != null) {
    const matched = charges
      .map((charge, index) => (charge.relatedLeagueId === discount.relatedLeagueId ? index : -1))
      .filter((index) => index >= 0);
    if (matched.length > 0) return matched;
  }

  const lineType = discount.lineType ?? '';
  const matched = charges
    .map((charge, index) => {
      if (!isDiscountEligibleCharge(charge)) return -1;
      if (lineType === 'student_discount' || lineType === 'winter_only_discount') {
        return charge.lineType === 'regular_membership_fee' ? index : -1;
      }
      if (lineType === 'student_league_discount') {
        return charge.lineType !== 'regular_membership_fee' ? index : -1;
      }
      if (lineType === 'financial_assistance_discount') {
        return charge.lineType === 'junior_recreational_fee' ? index : -1;
      }
      if (lineType === 'sabbatical_fill_discount') {
        return charge.lineType === 'league_fee' ? index : -1;
      }
      if (lineType === 'reciprocal_discount') {
        return charge.lineType === 'regular_membership_fee' ? index : -1;
      }
      return index;
    })
    .filter((index) => index >= 0);
  return matched.length > 0 ? matched : charges.map((_, index) => index);
}

function applyAmountToTargets(remaining: number[], targets: number[], amount: number): void {
  const positiveTargets = targets.filter((index) => remaining[index] > 0);
  const total = positiveTargets.reduce((sum, index) => sum + remaining[index], 0);
  if (total <= 0 || amount <= 0) return;

  let leftover = Math.min(amount, total);
  const planned = positiveTargets.map((index) =>
    Math.min(remaining[index], Math.round((amount * remaining[index]) / total)),
  );
  let plannedSum = planned.reduce((sum, share) => sum + share, 0);
  if (plannedSum > leftover) {
    for (let index = planned.length - 1; index >= 0 && plannedSum > leftover; index -= 1) {
      const decrease = Math.min(planned[index], plannedSum - leftover);
      planned[index] -= decrease;
      plannedSum -= decrease;
    }
  } else if (plannedSum < leftover) {
    for (let index = 0; index < planned.length && plannedSum < leftover; index += 1) {
      const increase = Math.min(remaining[positiveTargets[index]] - planned[index], leftover - plannedSum);
      planned[index] += increase;
      plannedSum += increase;
    }
  }
  positiveTargets.forEach((chargeIndex, index) => {
    remaining[chargeIndex] -= planned[index];
  });
}

/**
 * Fold invoice discounts into the charges they belong to, then apply money
 * already paid to those net amounts in order. Fully covered charges are omitted
 * so a later unpaid league is not split with a completed one.
 */
export function applyPriorPaidToInvoiceLines<T extends RegistrationCheckoutInvoiceLine>(
  invoiceLines: T[],
  priorPaidMinor: number,
): T[] {
  const charges = invoiceLines.filter((line) => isPositiveCharge(line));
  const discounts = invoiceLines.filter((line) => line.amountMinor < 0);
  const remaining = charges.map((line) => line.amountMinor);
  for (const discount of discounts) {
    applyAmountToTargets(remaining, discountTargetIndices(charges, discount), Math.abs(Math.round(discount.amountMinor)));
  }

  let leftoverPaid = Math.max(0, Math.round(priorPaidMinor));
  const leftoverCharges: T[] = [];
  for (const [index, charge] of charges.entries()) {
    const netMinor = remaining[index];
    if (netMinor <= 0) continue;
    if (leftoverPaid >= netMinor) {
      leftoverPaid -= netMinor;
      continue;
    }
    leftoverCharges.push({ ...charge, amountMinor: netMinor - leftoverPaid });
    leftoverPaid = 0;
  }
  return leftoverCharges;
}

/**
 * Build Square/Stripe checkout lines for a registration charge.
 * Prior payments cover leading invoice charges and drop those items from the
 * cart. Real discounts stay; the checkout total must still match the remaining
 * amount due.
 */
export function curlingRegistrationCheckoutLineItems(input: {
  invoiceLines: Array<{
    description: string;
    amountMinor: number;
    lineType?: string;
    relatedLeagueId?: number | null;
    discountEligible?: boolean | number;
  }>;
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
        lineType: line.lineType,
        relatedLeagueId: line.relatedLeagueId,
        discountEligible: line.discountEligible,
      }))
      .filter((line) => line.description.length > 0 && line.amountMinor !== 0),
    priorPaidMinor,
  ).map((line) => ({
    description: line.description,
    amountMinor: line.amountMinor,
  }));

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
