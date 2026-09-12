import { describe, expect, test } from 'bun:test';
import { canTransitionPaymentOrderStatus } from './paymentService.js';

describe('payment order status transitions', () => {
  test('a failed checkout can recover to pending or succeeded after a later charge', () => {
    expect(canTransitionPaymentOrderStatus('failed', 'succeeded')).toBe(true);
    expect(canTransitionPaymentOrderStatus('failed', 'pending')).toBe(true);
  });

  test('failed remains unable to jump to refund states', () => {
    expect(canTransitionPaymentOrderStatus('failed', 'refunded')).toBe(false);
    expect(canTransitionPaymentOrderStatus('failed', 'failed')).toBe(false);
  });

  test('pending can still succeed or fail', () => {
    expect(canTransitionPaymentOrderStatus('pending', 'succeeded')).toBe(true);
    expect(canTransitionPaymentOrderStatus('pending', 'failed')).toBe(true);
  });
});
