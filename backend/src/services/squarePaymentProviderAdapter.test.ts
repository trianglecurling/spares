import { describe, expect, test } from 'bun:test';
import { isSquareOrderFullyPaid, planSquareOrderCompletion } from './squarePaymentProviderAdapter.js';

describe('isSquareOrderFullyPaid', () => {
  test('requires zero net amount due and at least one tender', () => {
    expect(
      isSquareOrderFullyPaid({
        netAmountDueMoney: { amount: 0, currency: 'USD' },
        tenders: [{ id: 'tender-1' }],
      })
    ).toBe(true);
  });

  test('rejects unpaid and empty-tender orders', () => {
    expect(
      isSquareOrderFullyPaid({
        netAmountDueMoney: { amount: 2500, currency: 'USD' },
        tenders: [{ id: 'tender-1' }],
      })
    ).toBe(false);
    expect(
      isSquareOrderFullyPaid({
        netAmountDueMoney: { amount: 0, currency: 'USD' },
        tenders: [],
      })
    ).toBe(false);
    expect(isSquareOrderFullyPaid(null)).toBe(false);
  });
});

describe('planSquareOrderCompletion', () => {
  test('skips orders that Square already completed or canceled', () => {
    expect(
      planSquareOrderCompletion({
        id: 'order-1',
        state: 'COMPLETED',
        version: 3,
        netAmountDueMoney: { amount: 0 },
        tenders: [{ id: 'tender-1' }],
      })
    ).toEqual({ action: 'already_completed', orderId: 'order-1' });

    expect(
      planSquareOrderCompletion({
        id: 'order-2',
        state: 'CANCELED',
        version: 2,
        netAmountDueMoney: { amount: 0 },
        tenders: [{ id: 'tender-1' }],
      })
    ).toEqual({ action: 'skip', reason: 'canceled', orderId: 'order-2' });
  });

  test('skips orders that are not fully paid', () => {
    expect(
      planSquareOrderCompletion({
        id: 'order-3',
        state: 'OPEN',
        version: 1,
        netAmountDueMoney: { amount: 1000 },
        tenders: [],
      })
    ).toEqual({ action: 'skip', reason: 'not_fully_paid', orderId: 'order-3' });
  });

  test('completes open paid orders and any unfinished fulfillments', () => {
    expect(
      planSquareOrderCompletion({
        id: 'order-4',
        state: 'OPEN',
        version: 4,
        locationId: 'LOC_1',
        netAmountDueMoney: { amount: 0 },
        tenders: [{ paymentId: 'pay-1' }],
        fulfillments: [
          { uid: 'f-open', state: 'PROPOSED' },
          { uid: 'f-done', state: 'COMPLETED' },
          { uid: 'f-canceled', state: 'CANCELED' },
        ],
      })
    ).toEqual({
      action: 'complete',
      orderId: 'order-4',
      version: 4,
      locationId: 'LOC_1',
      fulfillments: [{ uid: 'f-open', state: 'COMPLETED' }],
    });
  });

  test('completes a paid order with no fulfillments', () => {
    expect(
      planSquareOrderCompletion({
        id: 'order-5',
        state: 'OPEN',
        version: 2,
        net_amount_due_money: { amount: 0 },
        tenders: [{ payment_id: 'pay-2' }],
      })
    ).toEqual({
      action: 'complete',
      orderId: 'order-5',
      version: 2,
      locationId: null,
      fulfillments: [],
    });
  });
});
