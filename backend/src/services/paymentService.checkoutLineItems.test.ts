import { describe, expect, test } from 'bun:test';
import {
  eventRegistrationCheckoutQuantity,
  toProviderCheckoutLineItem,
} from './paymentService.js';

describe('eventRegistrationCheckoutQuantity', () => {
  test('uses explicit checkoutQuantity', () => {
    expect(eventRegistrationCheckoutQuantity({ checkoutQuantity: 3, groupSize: 5 })).toBe(3);
  });

  test('uses group size for a full registration checkout', () => {
    expect(eventRegistrationCheckoutQuantity({ groupSize: 3 })).toBe(3);
  });

  test('uses the added people for a group-size balance payment', () => {
    expect(
      eventRegistrationCheckoutQuantity({
        paymentKind: 'event_registration_balance',
        previousGroupSize: 1,
        groupSize: 3,
      })
    ).toBe(2);
  });

  test('defaults to one person', () => {
    expect(eventRegistrationCheckoutQuantity({})).toBe(1);
    expect(eventRegistrationCheckoutQuantity({ groupSize: 0 })).toBe(1);
  });
});

describe('toProviderCheckoutLineItem', () => {
  test('splits a group registration line into unit price and quantity', () => {
    expect(
      toProviderCheckoutLineItem({
        description: 'Curling Event',
        amountMinor: 12000,
        quantity: 3,
      })
    ).toEqual({
      description: 'Curling Event',
      quantity: 3,
      unitAmountMinor: 4000,
    });
  });

  test('keeps a single line when the total does not divide evenly', () => {
    expect(
      toProviderCheckoutLineItem({
        description: 'Curling Event',
        amountMinor: 10001,
        quantity: 3,
      })
    ).toEqual({
      description: 'Curling Event',
      quantity: 1,
      unitAmountMinor: 10001,
    });
  });

  test('defaults quantity to 1', () => {
    expect(
      toProviderCheckoutLineItem({
        description: 'Donation',
        amountMinor: 5000,
      })
    ).toEqual({
      description: 'Donation',
      quantity: 1,
      unitAmountMinor: 5000,
    });
  });
});
