import { describe, expect, test } from 'bun:test';
import {
  applyPriorPaidToInvoiceLines,
  curlingRegistrationCheckoutLineItems,
  netPaidMinorFromPaymentActivity,
  parseRegistrationRefundNote,
  refundDueMinor,
  refundableRemainingMinor,
  registrationBalanceMinor,
  remainingDueMinor,
  staffPaidRegistrationAdjustment,
} from './registrationBillingMath.js';

describe('netPaidMinorFromPaymentActivity', () => {
  test('nets settled charges minus succeeded refunds', () => {
    expect(
      netPaidMinorFromPaymentActivity([
        { kind: 'payment', status: 'succeeded', amountMinor: 50000 },
        { kind: 'refund', status: 'succeeded', amountMinor: 10000 },
        { kind: 'payment', status: 'pending', amountMinor: 20000 },
      ]),
    ).toBe(40000);
  });

  test('counts in-flight refunds so a processing full refund is not still paid', () => {
    expect(
      netPaidMinorFromPaymentActivity([
        { kind: 'payment', status: 'succeeded', amountMinor: 58300 },
        { kind: 'refund', status: 'processing', amountMinor: 58300 },
      ]),
    ).toBe(0);
  });

  test('does not treat a failed refund as money returned', () => {
    expect(
      netPaidMinorFromPaymentActivity([
        { kind: 'payment', status: 'succeeded', amountMinor: 58300 },
        { kind: 'refund', status: 'failed', amountMinor: 58300 },
      ]),
    ).toBe(58300);
  });

  test('treats an offline paid invoice as paid when card activity is short', () => {
    expect(
      netPaidMinorFromPaymentActivity([], {
        status: 'paid',
        totalMinor: 25000,
        offlinePaymentNote: 'Check 1042',
      }),
    ).toBe(25000);
  });

  test('does not replace card payments with a later unpaid invoice total', () => {
    expect(
      netPaidMinorFromPaymentActivity(
        [{ kind: 'payment', status: 'succeeded', amountMinor: 20000 }],
        { status: 'awaiting_payment', totalMinor: 35000, offlinePaymentNote: null },
      ),
    ).toBe(20000);
  });
});

describe('registration balances', () => {
  test('positive remaining due and negative refund due', () => {
    expect(registrationBalanceMinor(50000, 30000)).toBe(20000);
    expect(remainingDueMinor(50000, 30000)).toBe(20000);
    expect(refundDueMinor(30000, 50000)).toBe(20000);
    expect(remainingDueMinor(30000, 50000)).toBe(0);
  });

  test('refundable remaining never goes negative', () => {
    expect(refundableRemainingMinor(50000, 20000)).toBe(30000);
    expect(refundableRemainingMinor(50000, 50000)).toBe(0);
    expect(refundableRemainingMinor(50000, 60000)).toBe(0);
  });
});

describe('staffPaidRegistrationAdjustment', () => {
  test('does not treat an unchanged paid bill as a refund', () => {
    expect(staffPaidRegistrationAdjustment(45000, 45000)).toEqual({ kind: 'none', adjustmentMinor: 0 });
  });

  test('classifies a lower bill as a refund that callers must approve', () => {
    expect(staffPaidRegistrationAdjustment(30000, 50000)).toEqual({ kind: 'refund', adjustmentMinor: -20000 });
  });

  test('classifies a higher bill as a remaining balance', () => {
    expect(staffPaidRegistrationAdjustment(50000, 30000)).toEqual({ kind: 'balance_due', adjustmentMinor: 20000 });
  });
});

describe('parseRegistrationRefundNote', () => {
  test('requires a trimmed note', () => {
    expect(parseRegistrationRefundNote('')).toEqual({ ok: false, error: 'Enter a refund note.' });
    expect(parseRegistrationRefundNote('  Overpayment  ')).toEqual({ ok: true, note: 'Overpayment' });
  });
});

describe('applyPriorPaidToInvoiceLines', () => {
  test('drops a paid membership and leaves later league fees', () => {
    expect(
      applyPriorPaidToInvoiceLines(
        [
          { description: 'Regular membership', amountMinor: 20800 },
          { description: 'Monday Late league fee', amountMinor: 15000 },
        ],
        20800,
      ),
    ).toEqual([{ description: 'Monday Late league fee', amountMinor: 15000 }]);
  });

  test('covers a paid league at its discounted net instead of splitting the remainder', () => {
    expect(
      applyPriorPaidToInvoiceLines(
        [
          {
            description: 'Regular membership fee',
            amountMinor: 20800,
            lineType: 'regular_membership_fee',
          },
          {
            description: 'Monday Late league fee',
            amountMinor: 12500,
            lineType: 'league_fee',
          },
          {
            description: 'Thursday Night league fee',
            amountMinor: 12500,
            lineType: 'league_fee',
          },
          {
            description: 'Student discount (membership)',
            amountMinor: -6240,
            lineType: 'student_discount',
          },
          {
            description: 'Student discount (leagues)',
            amountMinor: -7500,
            lineType: 'student_league_discount',
          },
        ],
        23310,
      ),
    ).toEqual([
      {
        description: 'Thursday Night league fee',
        amountMinor: 8750,
        lineType: 'league_fee',
      },
    ]);
  });
});

describe('curlingRegistrationCheckoutLineItems', () => {
  test('uses invoice lines when nothing has been paid', () => {
    expect(
      curlingRegistrationCheckoutLineItems({
        invoiceLines: [
          { description: 'Regular membership', amountMinor: 10000 },
          { description: 'Tuesday league fee', amountMinor: 30000 },
        ],
        orderAmountMinor: 40000,
        priorPaidMinor: 0,
      }),
    ).toEqual([
      { description: 'Regular membership', amountMinor: 10000 },
      { description: 'Tuesday league fee', amountMinor: 30000 },
    ]);
  });

  test('omits fully paid leading charges instead of adding a credit', () => {
    expect(
      curlingRegistrationCheckoutLineItems({
        invoiceLines: [
          { description: 'Regular membership', amountMinor: 20800 },
          { description: 'Tuesday league fee', amountMinor: 15000 },
        ],
        orderAmountMinor: 15000,
        priorPaidMinor: 20800,
      }),
    ).toEqual([{ description: 'Tuesday league fee', amountMinor: 15000 }]);
  });

  test('reduces a partially paid leading charge and keeps later unpaid items', () => {
    expect(
      curlingRegistrationCheckoutLineItems({
        invoiceLines: [
          { description: 'Regular membership', amountMinor: 10000 },
          { description: 'Tuesday league fee', amountMinor: 30000 },
        ],
        orderAmountMinor: 15000,
        priorPaidMinor: 25000,
      }),
    ).toEqual([{ description: 'Tuesday league fee', amountMinor: 15000 }]);
  });

  test('nets a remaining league discount after omitting a paid membership', () => {
    expect(
      curlingRegistrationCheckoutLineItems({
        invoiceLines: [
          { description: 'Regular membership', amountMinor: 20800, lineType: 'regular_membership_fee' },
          { description: 'Friday Evening league fee', amountMinor: 15000, lineType: 'league_fee' },
          {
            description: 'Temporary sabbatical-fill discount',
            amountMinor: -2000,
            lineType: 'sabbatical_fill_discount',
          },
        ],
        orderAmountMinor: 13000,
        priorPaidMinor: 20800,
      }),
    ).toEqual([{ description: 'Friday Evening league fee', amountMinor: 13000 }]);
  });

  test('charges only the newly added discounted league after the original payment', () => {
    expect(
      curlingRegistrationCheckoutLineItems({
        invoiceLines: [
          { description: 'Regular membership', amountMinor: 20800, lineType: 'regular_membership_fee' },
          { description: 'Monday Late league fee', amountMinor: 12500, lineType: 'league_fee' },
          { description: 'Thursday Night league fee', amountMinor: 12500, lineType: 'league_fee' },
          { description: 'Student discount (membership)', amountMinor: -6240, lineType: 'student_discount' },
          { description: 'Student discount (leagues)', amountMinor: -7500, lineType: 'student_league_discount' },
        ],
        orderAmountMinor: 8750,
        priorPaidMinor: 23310,
      }),
    ).toEqual([{ description: 'Thursday Night league fee', amountMinor: 8750 }]);
  });

  test('falls back to a single balance line when items cannot be reconciled', () => {
    expect(
      curlingRegistrationCheckoutLineItems({
        invoiceLines: [{ description: 'Regular membership', amountMinor: 10000 }],
        orderAmountMinor: 15000,
        priorPaidMinor: 0,
        allowBalanceFallback: true,
      }),
    ).toEqual([{ description: 'Registration balance payment', amountMinor: 15000 }]);
  });
});
