import { describe, expect, test } from 'bun:test';
import {
  AMOUNT_ALREADY_PAID_DESCRIPTION,
  curlingRegistrationCheckoutLineItems,
  netPaidMinorFromPaymentActivity,
  parseRegistrationRefundNote,
  refundDueMinor,
  refundableRemainingMinor,
  registrationBalanceMinor,
  remainingDueMinor,
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

describe('parseRegistrationRefundNote', () => {
  test('requires a trimmed note', () => {
    expect(parseRegistrationRefundNote('')).toEqual({ ok: false, error: 'Enter a refund note.' });
    expect(parseRegistrationRefundNote('  Overpayment  ')).toEqual({ ok: true, note: 'Overpayment' });
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

  test('appends an already-paid credit so remaining charges stay itemized', () => {
    expect(
      curlingRegistrationCheckoutLineItems({
        invoiceLines: [
          { description: 'Regular membership', amountMinor: 10000 },
          { description: 'Tuesday league fee', amountMinor: 30000 },
        ],
        orderAmountMinor: 15000,
        priorPaidMinor: 25000,
      }),
    ).toEqual([
      { description: 'Regular membership', amountMinor: 10000 },
      { description: 'Tuesday league fee', amountMinor: 30000 },
      { description: AMOUNT_ALREADY_PAID_DESCRIPTION, amountMinor: -25000 },
    ]);
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
