import { describe, expect, test } from 'bun:test';
import { replacementNameTagFeeIsPaid, selectNameTagOrders } from './registrationNameTags.js';
import type { NameTagRegistrationDetails } from './registrationNameTags.js';

function line(lineType: string, amountMinor: number) {
  return { description: lineType, amountMinor, lineType };
}

function details(overrides: Partial<NameTagRegistrationDetails> = {}): NameTagRegistrationDetails {
  return {
    returningMemberAnswer: 0,
    nameTagReplacementQuantity: null,
    nameTagName: 'Alex',
    nameTagIncludePronouns: 1,
    preferredPronouns: 'They/Them',
    firstName: 'Alexandra',
    lastName: 'Ng',
    ...overrides,
  };
}

describe('replacementNameTagFeeIsPaid', () => {
  test('is unpaid when nothing has been collected', () => {
    expect(
      replacementNameTagFeeIsPaid({
        chargeLines: [line('regular_membership_fee', 10000), line('replacement_name_tag_fee', 1500)],
        discountLines: [],
        paidMinor: 0,
      }),
    ).toBe(false);
  });

  test('stays unpaid when payments cover membership but not the name tag', () => {
    expect(
      replacementNameTagFeeIsPaid({
        chargeLines: [line('regular_membership_fee', 10000), line('replacement_name_tag_fee', 1500)],
        discountLines: [],
        paidMinor: 10000,
      }),
    ).toBe(false);
  });

  test('is paid once membership and the name tag are covered', () => {
    expect(
      replacementNameTagFeeIsPaid({
        chargeLines: [line('regular_membership_fee', 10000), line('replacement_name_tag_fee', 1500)],
        discountLines: [],
        paidMinor: 11500,
      }),
    ).toBe(true);
  });

  test('stays paid when a later league fee is still unpaid', () => {
    expect(
      replacementNameTagFeeIsPaid({
        chargeLines: [
          line('regular_membership_fee', 10000),
          line('league_fee', 8000),
          line('replacement_name_tag_fee', 1500),
        ],
        discountLines: [],
        paidMinor: 11500,
      }),
    ).toBe(true);
  });

  test('applies membership discounts before deciding the name tag is covered', () => {
    expect(
      replacementNameTagFeeIsPaid({
        chargeLines: [line('regular_membership_fee', 10000), line('replacement_name_tag_fee', 1500)],
        discountLines: [line('student_discount', -2000)],
        paidMinor: 9500,
      }),
    ).toBe(true);
    expect(
      replacementNameTagFeeIsPaid({
        chargeLines: [line('regular_membership_fee', 10000), line('replacement_name_tag_fee', 1500)],
        discountLines: [line('student_discount', -2000)],
        paidMinor: 9499,
      }),
    ).toBe(false);
  });

  test('is unpaid when there is no replacement charge', () => {
    expect(
      replacementNameTagFeeIsPaid({
        chargeLines: [line('regular_membership_fee', 10000)],
        discountLines: [],
        paidMinor: 10000,
      }),
    ).toBe(false);
  });
});

describe('selectNameTagOrders', () => {
  test('includes every new member and only paid returning replacements', () => {
    const detailsByRegistrationId = new Map<number, NameTagRegistrationDetails>([
      [1, details()],
      [
        2,
        details({
          returningMemberAnswer: 1,
          nameTagReplacementQuantity: 2,
          nameTagName: 'Sam',
          nameTagIncludePronouns: 0,
          preferredPronouns: 'He/Him',
          firstName: 'Samuel',
          lastName: 'Lee',
        }),
      ],
      [
        3,
        details({
          returningMemberAnswer: 1,
          nameTagReplacementQuantity: 1,
          nameTagName: 'Pat',
          nameTagIncludePronouns: 1,
          preferredPronouns: 'She/Her',
        }),
      ],
      [
        4,
        details({
          returningMemberAnswer: 1,
          nameTagReplacementQuantity: 0,
          nameTagName: 'No Tag',
        }),
      ],
    ]);

    const orders = selectNameTagOrders({
      rows: [
        {
          registrationId: 1,
          curlerId: 10,
          curlerName: 'Alexandra Ng',
          owedLines: [],
          owedDiscountLines: [],
          paidMinor: 0,
        },
        {
          registrationId: 2,
          curlerId: 11,
          curlerName: 'Samuel Lee',
          owedLines: [line('replacement_name_tag_fee', 3000)],
          owedDiscountLines: [],
          paidMinor: 3000,
        },
        {
          registrationId: 3,
          curlerId: 12,
          curlerName: 'Pat Kim',
          owedLines: [line('regular_membership_fee', 10000), line('replacement_name_tag_fee', 1500)],
          owedDiscountLines: [],
          paidMinor: 10000,
        },
        {
          registrationId: 4,
          curlerId: 13,
          curlerName: 'No Tag',
          owedLines: [],
          owedDiscountLines: [],
          paidMinor: 0,
        },
      ],
      detailsByRegistrationId,
    });

    expect(orders).toEqual([
      {
        registrationId: 1,
        curlerId: 10,
        curlerName: 'Alexandra Ng',
        nameTagName: 'Alex',
        includePronouns: true,
        pronouns: 'They/Them',
        quantity: 1,
        kind: 'new_member',
      },
      {
        registrationId: 2,
        curlerId: 11,
        curlerName: 'Samuel Lee',
        nameTagName: 'Sam',
        includePronouns: false,
        pronouns: null,
        quantity: 2,
        kind: 'paid_replacement',
      },
    ]);
  });

  test('falls back to the legal name and omits pronouns when they were declined', () => {
    const orders = selectNameTagOrders({
      rows: [
        {
          registrationId: 8,
          curlerId: 20,
          curlerName: 'Jordan Blake',
          owedLines: [],
          owedDiscountLines: [],
          paidMinor: 0,
        },
      ],
      detailsByRegistrationId: new Map([
        [
          8,
          details({
            nameTagName: '  ',
            nameTagIncludePronouns: 1,
            preferredPronouns: 'Prefer not to say',
            firstName: 'Jordan',
            lastName: 'Blake',
          }),
        ],
      ]),
    });

    expect(orders).toEqual([
      {
        registrationId: 8,
        curlerId: 20,
        curlerName: 'Jordan Blake',
        nameTagName: 'Jordan Blake',
        includePronouns: false,
        pronouns: null,
        quantity: 1,
        kind: 'new_member',
      },
    ]);
  });
});
