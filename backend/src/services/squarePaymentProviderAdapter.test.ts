import { describe, expect, test } from 'bun:test';
import {
  buildSquareOrderDetails,
  extractSquareWebhookOrderLookup,
  isSquareOrderFullyPaid,
  isSquareVersionMismatch,
  planSquareOrderCompletion,
} from './squarePaymentProviderAdapter.js';
import { PaymentServiceError, type CreateCheckoutInput } from './paymentService.js';

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

describe('extractSquareWebhookOrderLookup', () => {
  test('matches payment.updated using Square order id when reference_id is absent', () => {
    expect(
      extractSquareWebhookOrderLookup({
        type: 'payment.updated',
        data: {
          object: {
            payment: {
              id: 'pay-1',
              order_id: 'sq-order-99',
              status: 'COMPLETED',
            },
          },
        },
      })
    ).toEqual({
      orderId: null,
      orderToken: null,
      providerOrderId: 'sq-order-99',
      providerTransactionId: 'pay-1',
    });
  });

  test('reads order.updated payloads that wrap order_updated instead of order', () => {
    expect(
      extractSquareWebhookOrderLookup({
        type: 'order.updated',
        data: {
          object: {
            order_updated: {
              order_id: 'sq-order-77',
              state: 'OPEN',
              version: 4,
            },
          },
        },
      })
    ).toEqual({
      orderId: null,
      orderToken: null,
      providerOrderId: 'sq-order-77',
      providerTransactionId: null,
    });
  });

  test('reads refund.created order_id and refund id', () => {
    expect(
      extractSquareWebhookOrderLookup({
        type: 'refund.created',
        data: {
          object: {
            refund: {
              id: 'refund-1',
              payment_id: 'pay-1',
              order_id: 'sq-order-55',
            },
          },
        },
      })
    ).toEqual({
      orderId: null,
      orderToken: null,
      providerOrderId: 'sq-order-55',
      providerTransactionId: 'refund-1',
    });
  });

  test('accepts camelCase payment fields and order referenceId', () => {
    expect(
      extractSquareWebhookOrderLookup({
        type: 'payment.updated',
        data: {
          object: {
            payment: {
              id: 'pay-2',
              orderId: 'sq-order-camel',
              referenceId: 'order-token-1',
            },
          },
        },
      })
    ).toEqual({
      orderId: null,
      orderToken: 'order-token-1',
      providerOrderId: 'sq-order-camel',
      providerTransactionId: 'pay-2',
    });
  });
});

describe('isSquareVersionMismatch', () => {
  test('detects wrapped Square errors from callSquare', () => {
    expect(
      isSquareVersionMismatch(
        new PaymentServiceError('Square error (HTTP 409): CONFLICT VERSION_MISMATCH Version does not match', 502)
      )
    ).toBe(true);
    expect(isSquareVersionMismatch(new PaymentServiceError('Square error: NOT_FOUND', 502))).toBe(false);
    expect(isSquareVersionMismatch(new Error('network down'))).toBe(false);
  });
});

function eventCheckoutInput(overrides: Partial<CreateCheckoutInput>): CreateCheckoutInput {
  return {
    orderId: 1,
    orderToken: 'tok',
    amountMinor: 12000,
    currency: 'usd',
    subjectType: 'event_registration',
    subjectId: 10,
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    description: 'Event registration — Learn to Curl',
    ...overrides,
  };
}

describe('buildSquareOrderDetails', () => {
  test('sends group registrations as quantity at the per-person price', () => {
    expect(
      buildSquareOrderDetails(
        eventCheckoutInput({
          lineItems: [
            { description: 'Curling Event', amountMinor: 12000, quantity: 3 },
          ],
        })
      )
    ).toEqual({
      lineItems: [
        {
          name: 'Curling Event',
          quantity: '3',
          basePriceMoney: {
            amount: 4000n,
            currency: 'USD',
          },
        },
      ],
      discounts: undefined,
    });
  });

  test('keeps a single line when quantity is omitted', () => {
    expect(
      buildSquareOrderDetails(
        eventCheckoutInput({
          amountMinor: 4000,
          lineItems: [{ description: 'Curling Event', amountMinor: 4000 }],
        })
      ).lineItems
    ).toEqual([
      {
        name: 'Curling Event',
        quantity: '1',
        basePriceMoney: {
          amount: 4000n,
          currency: 'USD',
        },
      },
    ]);
  });
});
