import { describe, expect, test } from 'bun:test';
import {
  staffCanRequestDeferredPayment,
  unpaidImmediateRegistrationCanDefer,
} from './registrationUnpaidImmediateDeferral.js';

describe('unpaidImmediateRegistrationCanDefer', () => {
  test('allows unpaid immediate invoices that are still awaiting payment', () => {
    expect(
      unpaidImmediateRegistrationCanDefer({
        registrationStatus: 'awaiting_payment',
        invoiceStatus: 'awaiting_payment',
        invoiceDeferred: 0,
      }),
    ).toBe(true);
    expect(
      unpaidImmediateRegistrationCanDefer({
        registrationStatus: 'payment_started',
        invoiceStatus: 'checkout_started',
        invoiceDeferred: false,
      }),
    ).toBe(true);
  });

  test('rejects paid, deferred, or cancelled invoices', () => {
    expect(
      unpaidImmediateRegistrationCanDefer({
        registrationStatus: 'awaiting_payment',
        invoiceStatus: 'awaiting_payment',
        invoiceDeferred: 1,
      }),
    ).toBe(false);
    expect(
      unpaidImmediateRegistrationCanDefer({
        registrationStatus: 'awaiting_placement',
        invoiceStatus: 'deferred',
        invoiceDeferred: 1,
      }),
    ).toBe(false);
    expect(
      unpaidImmediateRegistrationCanDefer({
        registrationStatus: 'paid',
        invoiceStatus: 'paid',
        invoiceDeferred: 0,
      }),
    ).toBe(false);
  });
});

describe('staffCanRequestDeferredPayment', () => {
  test('allows awaiting placement and staff review', () => {
    expect(staffCanRequestDeferredPayment('awaiting_placement')).toBe(true);
    expect(staffCanRequestDeferredPayment('awaiting_staff_review')).toBe(true);
    expect(staffCanRequestDeferredPayment('awaiting_payment')).toBe(false);
    expect(staffCanRequestDeferredPayment('paid')).toBe(false);
  });
});
