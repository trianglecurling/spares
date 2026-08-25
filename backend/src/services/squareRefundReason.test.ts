import { describe, expect, test } from 'bun:test';
import {
  SQUARE_REFUND_REASON_MAX_LENGTH,
  buildSquareRefundReason,
  checkoutLineItemsToRefundItems,
  extractSquareOrderRefundLineItems,
  findLineItemsSummingTo,
  formatRefundMoney,
  selectRefundedLineItems,
} from './squareRefundReason.js';

const league = { name: 'Winter league', quantity: 1, amountMinor: 15000 };
const membership = { name: 'Regular membership', quantity: 1, amountMinor: 10000 };
const discount = { name: 'Early bird', quantity: 1, amountMinor: -2000 };

describe('formatRefundMoney', () => {
  test('formats USD without grouping separators', () => {
    expect(formatRefundMoney(15000, 'usd')).toBe('$150.00');
    expect(formatRefundMoney(-2000, 'USD')).toBe('-$20.00');
  });
});

describe('selectRefundedLineItems', () => {
  test('returns every item for a full refund', () => {
    expect(
      selectRefundedLineItems({
        items: [league, membership, discount],
        refundAmountMinor: 23000,
        orderAmountMinor: 23000,
      })
    ).toEqual({ items: [league, membership, discount], partial: false });
  });

  test('returns the matching line when the refund equals one item', () => {
    expect(
      selectRefundedLineItems({
        items: [league, membership],
        refundAmountMinor: 10000,
        orderAmountMinor: 25000,
      })
    ).toEqual({ items: [membership], partial: false });
  });

  test('returns a subset that sums to the refund amount', () => {
    const nameTag = { name: 'Replacement name tag', quantity: 1, amountMinor: 1200 };
    expect(
      findLineItemsSummingTo([league, membership, nameTag], 11200)
    ).toEqual([membership, nameTag]);
  });

  test('marks unmatched partial refunds so the reason can list the original items', () => {
    expect(
      selectRefundedLineItems({
        items: [league, membership],
        refundAmountMinor: 4500,
        orderAmountMinor: 25000,
      })
    ).toEqual({ items: [league, membership], partial: true });
  });
});

describe('extractSquareOrderRefundLineItems', () => {
  test('reads Square line items and discounts', () => {
    expect(
      extractSquareOrderRefundLineItems({
        lineItems: [
          {
            name: 'Winter league',
            quantity: '1',
            totalMoney: { amount: 15000, currency: 'USD' },
          },
        ],
        discounts: [
          {
            name: 'Early bird',
            amountMoney: { amount: 2000, currency: 'USD' },
          },
        ],
      })
    ).toEqual([
      { name: 'Winter league', quantity: 1, amountMinor: 15000 },
      { name: 'Early bird', quantity: 1, amountMinor: -2000 },
    ]);
  });

  test('keeps Square quantity and line total for a group registration', () => {
    expect(
      extractSquareOrderRefundLineItems({
        lineItems: [
          {
            name: 'Curling Event',
            quantity: '3',
            basePriceMoney: { amount: 4000, currency: 'USD' },
            totalMoney: { amount: 12000, currency: 'USD' },
          },
        ],
      })
    ).toEqual([{ name: 'Curling Event', quantity: 3, amountMinor: 12000 }]);
  });
});

describe('buildSquareRefundReason', () => {
  test('includes name, quantity, and cost in a Zap-friendly list', () => {
    expect(
      buildSquareRefundReason({
        items: [league, membership],
        refundAmountMinor: 25000,
        orderAmountMinor: 25000,
        currency: 'usd',
      })
    ).toBe('Winter league x1 $150.00; Regular membership x1 $100.00');
  });

  test('prefixes unmatched partial refunds with the refunded amount', () => {
    expect(
      buildSquareRefundReason({
        items: [league, membership],
        refundAmountMinor: 4500,
        orderAmountMinor: 25000,
        currency: 'usd',
      })
    ).toBe('$45.00 of: Winter league x1 $150.00; Regular membership x1 $100.00');
  });

  test('appends the staff reason when it still fits', () => {
    expect(
      buildSquareRefundReason({
        items: [membership],
        refundAmountMinor: 10000,
        orderAmountMinor: 10000,
        currency: 'usd',
        staffReason: 'Event registration canceled',
      })
    ).toBe('Regular membership x1 $100.00 — Event registration canceled');
  });

  test('stays within Square reason length when many items are refunded', () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      name: `Very long registration line item number ${index + 1} for league play`,
      quantity: 1,
      amountMinor: 15000,
    }));
    const reason = buildSquareRefundReason({
      items,
      refundAmountMinor: 120000,
      orderAmountMinor: 120000,
      currency: 'usd',
    });
    expect(reason).toBeTruthy();
    expect(reason!.length).toBeLessThanOrEqual(SQUARE_REFUND_REASON_MAX_LENGTH);
    expect(reason).toContain('x1 $150.00');
  });

  test('falls back to checkout line items and staff reason when Square has no products', () => {
    expect(
      buildSquareRefundReason({
        items: checkoutLineItemsToRefundItems([
          { description: 'Donation to Triangle Curling Club', amountMinor: 5000 },
        ]),
        refundAmountMinor: 5000,
        orderAmountMinor: 5000,
        currency: 'usd',
        staffReason: 'Requested by donor',
      })
    ).toBe('Donation to Triangle Curling Club x1 $50.00 — Requested by donor');
  });

  test('preserves group registration quantity on checkout fallback items', () => {
    expect(
      checkoutLineItemsToRefundItems([
        { description: 'Curling Event', amountMinor: 12000, quantity: 3 },
      ])
    ).toEqual([{ name: 'Curling Event', quantity: 3, amountMinor: 12000 }]);
  });
});
