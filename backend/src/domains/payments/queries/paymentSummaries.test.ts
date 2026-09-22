import { describe, expect, test } from 'bun:test';
import {
  groupPaymentActivityByRegistration,
  mapCanceledSiblingPaymentsToLiveRegistrations,
  remapPaymentOrderSubjectToRequestedRegistrations,
} from './paymentSummaries.js';

describe('mapCanceledSiblingPaymentsToLiveRegistrations', () => {
  test('credits a canceled payment onto the unique live registration in the same session', () => {
    const mapped = mapCanceledSiblingPaymentsToLiveRegistrations({
      requestedRegistrations: [
        { id: 20, curlerMemberId: 7, sessionId: 3, status: 'awaiting_payment' },
      ],
      canceledSiblings: [{ id: 10, curlerMemberId: 7, sessionId: 3, cancelledAt: '2026-08-23T14:51:11Z' }],
    });
    expect(mapped.get(10)).toBe(20);
  });

  test('only credits the most recently canceled sibling, not earlier test checkouts', () => {
    const mapped = mapCanceledSiblingPaymentsToLiveRegistrations({
      requestedRegistrations: [
        { id: 20, curlerMemberId: 7, sessionId: 3, status: 'confirmed' },
      ],
      canceledSiblings: [
        { id: 10, curlerMemberId: 7, sessionId: 3, cancelledAt: '2026-06-06T15:40:55Z' },
        { id: 16, curlerMemberId: 7, sessionId: 3, cancelledAt: '2026-08-23T14:51:11Z' },
      ],
    });
    expect(mapped.get(16)).toBe(20);
    expect(mapped.has(10)).toBe(false);
  });

  test('does not credit when two live registrations share the curler and session', () => {
    const mapped = mapCanceledSiblingPaymentsToLiveRegistrations({
      requestedRegistrations: [
        { id: 20, curlerMemberId: 7, sessionId: 3, status: 'confirmed' },
        { id: 21, curlerMemberId: 7, sessionId: 3, status: 'awaiting_payment' },
      ],
      canceledSiblings: [{ id: 10, curlerMemberId: 7, sessionId: 3 }],
    });
    expect(mapped.has(10)).toBe(false);
  });

  test('does not credit a different curler or session', () => {
    const mapped = mapCanceledSiblingPaymentsToLiveRegistrations({
      requestedRegistrations: [
        { id: 20, curlerMemberId: 7, sessionId: 3, status: 'confirmed' },
      ],
      canceledSiblings: [
        { id: 10, curlerMemberId: 8, sessionId: 3 },
        { id: 11, curlerMemberId: 7, sessionId: 4 },
      ],
    });
    expect(mapped.size).toBe(0);
  });
});

describe('remapPaymentOrderSubjectToRequestedRegistrations', () => {
  test('keeps a direct live link and adds the remapped canceled sibling', () => {
    expect(
      remapPaymentOrderSubjectToRequestedRegistrations({
        subjectId: 10,
        requestedIds: new Set([20]),
        canceledToLive: new Map([[10, 20]]),
      }),
    ).toEqual([20]);
  });

  test('still shows activity on the canceled registration itself', () => {
    expect(
      remapPaymentOrderSubjectToRequestedRegistrations({
        subjectId: 10,
        requestedIds: new Set([10]),
        canceledToLive: new Map([[10, 20]]),
      }),
    ).toEqual([10]);
  });
});

describe('groupPaymentActivityByRegistration', () => {
  test('assigns subject and invoice-linked orders to the matching registration only', () => {
    const grouped = groupPaymentActivityByRegistration({
      registrationIds: [10, 20],
      subjectOrders: [{ id: 1, subjectId: 10 }],
      invoiceLinks: [{ paymentOrderId: 2, registrationId: 20 }],
      orders: [
        {
          id: 1,
          order_token: 'tok-1',
          provider: 'square',
          amount_minor: 10000,
          currency: 'usd',
          status: 'succeeded',
          provider_order_id: 'sq-1',
          metadata: {},
          completed_at: '2026-09-01T12:00:00.000Z',
          created_at: '2026-09-01T11:00:00.000Z',
        },
        {
          id: 2,
          order_token: 'tok-2',
          provider: 'square',
          amount_minor: 5000,
          currency: 'usd',
          status: 'succeeded',
          provider_order_id: 'sq-2',
          metadata: { paymentKind: 'registration_balance' },
          completed_at: '2026-09-02T12:00:00.000Z',
          created_at: '2026-09-02T11:00:00.000Z',
        },
      ],
      refunds: [
        {
          id: 9,
          payment_order_id: 1,
          provider: 'square',
          amount_minor: 2000,
          currency: 'usd',
          status: 'succeeded',
          reason: 'Overpaid',
          provider_refund_id: 'rf-1',
          processed_at: '2026-09-03T12:00:00.000Z',
          created_at: '2026-09-03T11:00:00.000Z',
        },
      ],
    });

    expect(grouped.get(10)?.map((item) => item.id)).toEqual(['refund:9', 'payment:1']);
    expect(grouped.get(20)?.map((item) => item.id)).toEqual(['payment:2']);
    expect(grouped.get(20)?.[0]?.label).toBe('Additional payment');
    expect(grouped.get(10)?.find((item) => item.kind === 'refund')?.label).toBe('Overpaid');
  });

  test('dedupes the same order linked by both subject and invoice', () => {
    const grouped = groupPaymentActivityByRegistration({
      registrationIds: [10],
      subjectOrders: [{ id: 1, subjectId: 10 }],
      invoiceLinks: [{ paymentOrderId: 1, registrationId: 10 }],
      orders: [
        {
          id: 1,
          order_token: 'tok-1',
          provider: 'square',
          amount_minor: 10000,
          currency: 'usd',
          status: 'succeeded',
          provider_order_id: 'sq-1',
          metadata: {},
          completed_at: null,
          created_at: '2026-09-01T11:00:00.000Z',
        },
      ],
      refunds: [],
    });

    expect(grouped.get(10)?.map((item) => item.id)).toEqual(['payment:1']);
  });
});
