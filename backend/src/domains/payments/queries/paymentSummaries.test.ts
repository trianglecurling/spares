import { describe, expect, test } from 'bun:test';
import { groupPaymentActivityByRegistration } from './paymentSummaries.js';

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
