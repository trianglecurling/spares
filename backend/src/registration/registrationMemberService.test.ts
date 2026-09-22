import { describe, expect, test } from 'bun:test';
import {
  registrationAmountDueMinor,
  registrationAmountPaidMinor,
  registrationDisplayedPaymentAmounts,
} from './registrationMemberService.js';

describe('registrationAmountDueMinor', () => {
  test('returns the invoice total while payment is still outstanding', () => {
    expect(
      registrationAmountDueMinor({
        invoiceStatus: 'awaiting_payment',
        invoiceTotalMinor: 12500,
        registrationStatus: 'awaiting_payment',
      }),
    ).toBe(12500);
  });

  test('returns zero when the invoice is paid, including staff-recorded offline payment', () => {
    expect(
      registrationAmountDueMinor({
        invoiceStatus: 'paid',
        invoiceTotalMinor: 12500,
        registrationStatus: 'confirmed',
      }),
    ).toBe(0);
  });

  test('returns zero for canceled or refunded invoices', () => {
    expect(
      registrationAmountDueMinor({
        invoiceStatus: 'cancelled',
        invoiceTotalMinor: 12500,
        registrationStatus: 'cancelled',
      }),
    ).toBe(0);
    expect(
      registrationAmountDueMinor({
        invoiceStatus: 'refunded',
        invoiceTotalMinor: 12500,
        registrationStatus: 'cancelled',
      }),
    ).toBe(0);
  });
});

describe('registrationAmountPaidMinor', () => {
  test('returns the invoice total when the invoice is paid', () => {
    expect(
      registrationAmountPaidMinor({
        invoiceStatus: 'paid',
        invoiceTotalMinor: 12500,
      }),
    ).toBe(12500);
  });

  test('returns null while payment is still outstanding', () => {
    expect(
      registrationAmountPaidMinor({
        invoiceStatus: 'awaiting_payment',
        invoiceTotalMinor: 12500,
      }),
    ).toBeNull();
  });
});

describe('registrationDisplayedPaymentAmounts', () => {
  test('uses settled activity so a sibling payment covers an unpaid invoice', () => {
    expect(
      registrationDisplayedPaymentAmounts({
        invoiceStatus: 'awaiting_payment',
        invoiceTotalMinor: 45800,
        registrationStatus: 'awaiting_payment',
        paidMinor: 45800,
      }),
    ).toEqual({ amountDueMinor: 0, amountPaidMinor: 45800 });
  });

  test('keeps a remaining balance when activity only covers part of the invoice', () => {
    expect(
      registrationDisplayedPaymentAmounts({
        invoiceStatus: 'awaiting_payment',
        invoiceTotalMinor: 45800,
        registrationStatus: 'awaiting_payment',
        paidMinor: 20800,
      }),
    ).toEqual({ amountDueMinor: 25000, amountPaidMinor: 20800 });
  });
});
