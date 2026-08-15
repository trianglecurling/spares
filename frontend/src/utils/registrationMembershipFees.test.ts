import { describe, expect, test } from 'bun:test';
import {
  computeDiscountedEligibleFeeMinor,
  computeDiscountedRegularMembershipFeeMinor,
} from './registrationMembershipFees';

const percentDiscounts = {
  student: { amountType: 'percent' as const, value: 50 },
  reciprocal: { amountType: 'percent' as const, value: 10 },
};

describe('discounted fees', () => {
  test('student and reciprocal discounts stack on an eligible league fee', () => {
    expect(
      computeDiscountedEligibleFeeMinor(30000, {
        studentDiscountClaimed: true,
        reciprocalDiscountClaimed: true,
        availableDiscounts: percentDiscounts,
      }),
    ).toBe(13500);
  });

  test('ineligible league fees stay at the list price', () => {
    expect(
      computeDiscountedEligibleFeeMinor(
        30000,
        {
          studentDiscountClaimed: true,
          reciprocalDiscountClaimed: false,
          availableDiscounts: percentDiscounts,
        },
        false,
      ),
    ).toBe(30000);
  });

  test('membership helper uses the same percentage discount math', () => {
    expect(
      computeDiscountedRegularMembershipFeeMinor({
        baseRegularMinor: 40000,
        studentDiscountClaimed: true,
        reciprocalDiscountClaimed: false,
        availableDiscounts: percentDiscounts,
      }),
    ).toBe(20000);
  });

  test('dollar discounts do not reduce league fees', () => {
    expect(
      computeDiscountedEligibleFeeMinor(30000, {
        studentDiscountClaimed: true,
        reciprocalDiscountClaimed: true,
        availableDiscounts: {
          student: { amountType: 'dollar', value: 50 },
          reciprocal: { amountType: 'dollar', value: 25 },
        },
      }),
    ).toBe(30000);
  });

  test('dollar discounts still reduce membership fees', () => {
    expect(
      computeDiscountedRegularMembershipFeeMinor({
        baseRegularMinor: 40000,
        studentDiscountClaimed: true,
        reciprocalDiscountClaimed: false,
        availableDiscounts: {
          student: { amountType: 'dollar', value: 50 },
          reciprocal: { amountType: 'percent', value: 10 },
        },
      }),
    ).toBe(35000);
  });
});
