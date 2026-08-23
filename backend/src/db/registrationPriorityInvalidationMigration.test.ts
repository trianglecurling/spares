import { describe, expect, test } from 'bun:test';
import {
  inferRestoredRegistrationStatus,
  parsePaymentDecisionJson,
} from './registrationPriorityInvalidationMigration.js';

describe('inferRestoredRegistrationStatus', () => {
  test('paid invoice or succeeded order restores to confirmed', () => {
    expect(
      inferRestoredRegistrationStatus({
        invoice: { status: 'paid', deferred: 0 },
        paymentOrder: { status: 'succeeded' },
        paymentDecision: { outcome: 'immediate_payment' },
      }),
    ).toBe('confirmed');
    expect(
      inferRestoredRegistrationStatus({
        invoice: { status: 'awaiting_payment', deferred: 0 },
        paymentOrder: { status: 'succeeded' },
        paymentDecision: { outcome: 'immediate_payment' },
      }),
    ).toBe('confirmed');
  });

  test('open checkout restores to payment_started', () => {
    expect(
      inferRestoredRegistrationStatus({
        invoice: { status: 'checkout_started', deferred: 0 },
        paymentOrder: { status: 'pending' },
        paymentDecision: { outcome: 'immediate_payment' },
      }),
    ).toBe('payment_started');
  });

  test('deferred payment restores to placement or staff review', () => {
    expect(
      inferRestoredRegistrationStatus({
        invoice: { status: 'deferred', deferred: 1 },
        paymentOrder: null,
        paymentDecision: { outcome: 'deferred_payment', requiresStaffReview: false },
      }),
    ).toBe('awaiting_placement');
    expect(
      inferRestoredRegistrationStatus({
        invoice: { status: 'deferred', deferred: 1 },
        paymentOrder: null,
        paymentDecision: {
          outcome: 'deferred_payment',
          requiresStaffReview: true,
          deferralReasons: ['staff_review_required'],
        },
      }),
    ).toBe('awaiting_staff_review');
  });

  test('unpaid immediate invoice restores to awaiting_payment', () => {
    expect(
      inferRestoredRegistrationStatus({
        invoice: { status: 'awaiting_payment', deferred: 0 },
        paymentOrder: null,
        paymentDecision: { outcome: 'immediate_payment' },
      }),
    ).toBe('awaiting_payment');
  });

  test('no payment required restores to confirmed', () => {
    expect(
      inferRestoredRegistrationStatus({
        invoice: null,
        paymentOrder: null,
        paymentDecision: { outcome: 'no_payment_required' },
      }),
    ).toBe('confirmed');
  });
});

describe('parsePaymentDecisionJson', () => {
  test('reads stored decision objects and JSON strings', () => {
    expect(
      parsePaymentDecisionJson({
        outcome: 'deferred_payment',
        requiresStaffReview: true,
        deferralReasons: ['staff_review_required'],
      }),
    ).toEqual({
      outcome: 'deferred_payment',
      requiresStaffReview: true,
      deferralReasons: ['staff_review_required'],
    });
    expect(
      parsePaymentDecisionJson(
        JSON.stringify({ outcome: 'immediate_payment', requiresStaffReview: false, deferralReasons: [] }),
      ),
    ).toEqual({
      outcome: 'immediate_payment',
      requiresStaffReview: false,
      deferralReasons: [],
    });
    expect(parsePaymentDecisionJson('not-json')).toBeNull();
  });
});
