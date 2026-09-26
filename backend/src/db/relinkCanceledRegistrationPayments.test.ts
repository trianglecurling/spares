import { describe, expect, test } from 'bun:test';
import { planCanceledPaymentRelinks } from './relinkCanceledRegistrationPayments.js';

describe('planCanceledPaymentRelinks', () => {
  test('moves a succeeded order from a canceled registration to the live sibling', () => {
    expect(
      planCanceledPaymentRelinks({
        orders: [{ id: 99, subjectId: 10 }],
        canceledRegistrations: [{ id: 10, curlerMemberId: 7, sessionId: 3 }],
        liveRegistrations: [{ id: 20, curlerMemberId: 7, sessionId: 3, status: 'awaiting_payment' }],
      }),
    ).toEqual([{ orderId: 99, fromRegistrationId: 10, toRegistrationId: 20 }]);
  });

  test('skips orders that are not on a canceled registration', () => {
    expect(
      planCanceledPaymentRelinks({
        orders: [{ id: 99, subjectId: 20 }],
        canceledRegistrations: [{ id: 10, curlerMemberId: 7, sessionId: 3 }],
        liveRegistrations: [{ id: 20, curlerMemberId: 7, sessionId: 3, status: 'confirmed' }],
      }),
    ).toEqual([]);
  });

  test('only relinks the most recently canceled sibling payment', () => {
    expect(
      planCanceledPaymentRelinks({
        orders: [
          { id: 28, subjectId: 10 },
          { id: 100, subjectId: 16 },
        ],
        canceledRegistrations: [
          { id: 10, curlerMemberId: 7, sessionId: 3, cancelledAt: '2026-06-06T15:40:55Z' },
          { id: 16, curlerMemberId: 7, sessionId: 3, cancelledAt: '2026-08-23T14:51:11Z' },
        ],
        liveRegistrations: [{ id: 20, curlerMemberId: 7, sessionId: 3, status: 'confirmed' }],
      }),
    ).toEqual([{ orderId: 100, fromRegistrationId: 16, toRegistrationId: 20 }]);
  });

  test('does not relink an older checkout after the latest payment already moved', () => {
    expect(
      planCanceledPaymentRelinks({
        orders: [{ id: 44, subjectId: 118 }],
        canceledRegistrations: [
          { id: 118, curlerMemberId: 7, sessionId: 3, cancelledAt: '2026-06-12T12:46:15Z' },
          { id: 136, curlerMemberId: 7, sessionId: 3, cancelledAt: '2026-08-23T14:51:11Z' },
        ],
        liveRegistrations: [{ id: 371, curlerMemberId: 7, sessionId: 3, status: 'confirmed' }],
      }),
    ).toEqual([]);
  });
});
