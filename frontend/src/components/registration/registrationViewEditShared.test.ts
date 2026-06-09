import { describe, expect, test } from 'bun:test';
import {
  calculateEstimatedTotalRange,
  filterDirectLeagueRequestEligibleLeagues,
  isDirectLeagueRequestLeague,
  isThirdLeagueInterestEligibleLeague,
  maxPossibleLeagueCount,
  nextLeagueFlowStepAfterLeagueRequests,
  nextLeagueFlowStepAfterPriorLeagueSelection,
  nextLeagueFlowStepAfterSelections,
  nextLeagueFlowStepAfterThirdLeagueInterest,
  previousLeagueFlowStepBeforeBasicIceFallback,
  previousLeagueFlowStepBeforeSummary,
  shouldCollectBasicIceFallback,
  shouldCollectThirdLeagueInterest,
  shouldShowEstimatedTotalRange,
  stripThirdLeagueInterestSelections,
  type LeagueCatalogItem,
  type RegistrationSelectionInput,
} from './registrationViewEditShared';

function selection(
  overrides: Partial<RegistrationSelectionInput> & Pick<RegistrationSelectionInput, 'selectionType'>,
): RegistrationSelectionInput {
  return {
    leagueId: 1,
    ...overrides,
  };
}

describe('shouldCollectThirdLeagueInterest', () => {
  test('shows when two guaranteed return leagues are selected', () => {
    expect(
      shouldCollectThirdLeagueInterest(
        [selection({ selectionType: 'guaranteed_return', leagueId: 1 }), selection({ selectionType: 'guaranteed_return', leagueId: 2 })],
        null,
      ),
    ).toBe(true);
  });

  test('shows when one guaranteed return and one ADD waitlist are selected', () => {
    expect(
      shouldCollectThirdLeagueInterest(
        [selection({ selectionType: 'guaranteed_return', leagueId: 1 }), selection({ selectionType: 'waitlist_add', leagueId: 2 })],
        null,
      ),
    ).toBe(true);
  });

  test('shows when two ADD waitlists are selected and the registrant wants two leagues', () => {
    expect(
      shouldCollectThirdLeagueInterest(
        [selection({ selectionType: 'waitlist_add', leagueId: 1 }), selection({ selectionType: 'waitlist_add', leagueId: 2 })],
        2,
      ),
    ).toBe(true);
  });

  test('hides when only one guaranteed return is selected', () => {
    expect(shouldCollectThirdLeagueInterest([selection({ selectionType: 'guaranteed_return', leagueId: 1 })], null)).toBe(false);
  });

  test('hides when two ADD waitlists are selected but the registrant wants one league', () => {
    expect(
      shouldCollectThirdLeagueInterest(
        [selection({ selectionType: 'waitlist_add', leagueId: 1 }), selection({ selectionType: 'waitlist_add', leagueId: 2 })],
        1,
      ),
    ).toBe(false);
  });

  test('hides when only one ADD waitlist is selected', () => {
    expect(shouldCollectThirdLeagueInterest([selection({ selectionType: 'waitlist_add', leagueId: 1 })], null)).toBe(false);
  });
});

describe('shouldCollectBasicIceFallback', () => {
  test('shows when the registrant has no guaranteed return leagues', () => {
    expect(
      shouldCollectBasicIceFallback([selection({ selectionType: 'waitlist_add', leagueId: 1 })], false),
    ).toBe(true);
  });

  test('hides when the registrant has a guaranteed return league', () => {
    expect(
      shouldCollectBasicIceFallback([selection({ selectionType: 'guaranteed_return', leagueId: 1 })], false),
    ).toBe(false);
  });

  test('hides when the registrant already chose basic ice privileges', () => {
    expect(shouldCollectBasicIceFallback([selection({ selectionType: 'waitlist_add', leagueId: 1 })], true)).toBe(false);
  });
});

describe('league flow navigation helpers', () => {
  test('routes to league requests before waitlists when direct requests exist', () => {
    expect(nextLeagueFlowStepAfterPriorLeagueSelection({ hasDirectLeagueRequests: true })).toBe(
      '/registration/league-requests',
    );
    expect(nextLeagueFlowStepAfterPriorLeagueSelection({ hasDirectLeagueRequests: false })).toBe(
      '/registration/league-selection',
    );
  });

  test('routes from league requests to waitlists before later league steps', () => {
    expect(nextLeagueFlowStepAfterLeagueRequests()).toBe('/registration/league-selection');
  });

  test('routes to basic ice fallback when third-league interest does not apply', () => {
    expect(
      nextLeagueFlowStepAfterSelections({
        selections: [selection({ selectionType: 'waitlist_add', leagueId: 1 })],
        desiredAddWaitlistLeagueCount: null,
        isBasicIceLeagueSelection: false,
      }),
    ).toBe('/registration/basic-ice-fallback');
  });

  test('routes from waitlists to third-league interest before basic ice fallback when both apply', () => {
    expect(
      nextLeagueFlowStepAfterSelections({
        selections: [
          selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
          selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
        ],
        desiredAddWaitlistLeagueCount: null,
        isBasicIceLeagueSelection: false,
      }),
    ).toBe('/registration/third-league-interest');
  });

  test('routes from third-league interest to league summary when basic ice fallback does not apply', () => {
    expect(
      nextLeagueFlowStepAfterThirdLeagueInterest({
        selections: [
          selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
          selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
        ],
        isBasicIceLeagueSelection: false,
      }),
    ).toBe('/registration/league-summary');
  });

  test('routes from third-league interest to basic ice fallback when there are no guaranteed returns', () => {
    expect(
      nextLeagueFlowStepAfterThirdLeagueInterest({
        selections: [
          selection({ selectionType: 'waitlist_add', leagueId: 1 }),
          selection({ selectionType: 'waitlist_add', leagueId: 2 }),
        ],
        isBasicIceLeagueSelection: false,
      }),
    ).toBe('/registration/basic-ice-fallback');
  });

  test('routes back from summary to basic ice fallback when that step applies', () => {
    expect(
      previousLeagueFlowStepBeforeSummary({
        selections: [selection({ selectionType: 'waitlist_add', leagueId: 1 })],
        desiredAddWaitlistLeagueCount: null,
        isBasicIceLeagueSelection: false,
      }),
    ).toBe('/registration/basic-ice-fallback');
  });

  test('routes back from basic ice fallback to third-league interest when that step applies', () => {
    expect(
      previousLeagueFlowStepBeforeBasicIceFallback({
        selections: [
          selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
          selection({ selectionType: 'waitlist_add', leagueId: 2 }),
        ],
        desiredAddWaitlistLeagueCount: null,
      }),
    ).toBe('/registration/third-league-interest');
  });
});

describe('isDirectLeagueRequestLeague', () => {
  const baseLeague: LeagueCatalogItem = {
    id: 1,
    name: 'Example',
    leagueType: 'standard',
    format: 'teams',
    registrationFeeMinor: 10000,
    allowsWaitlist: true,
    allowsSabbatical: true,
    isPlayInBased: false,
  };

  test('includes play-in and non-waitlist leagues', () => {
    expect(isDirectLeagueRequestLeague({ ...baseLeague, isPlayInBased: true })).toBe(true);
    expect(isDirectLeagueRequestLeague({ ...baseLeague, allowsWaitlist: false })).toBe(true);
    expect(
      isDirectLeagueRequestLeague({
        ...baseLeague,
        leagueType: 'bring_your_own_team',
        allowsWaitlist: false,
      }),
    ).toBe(true);
  });

  test('excludes waitlisted standard leagues', () => {
    expect(isDirectLeagueRequestLeague(baseLeague)).toBe(false);
  });
});

describe('isThirdLeagueInterestEligibleLeague', () => {
  const standardLeague: LeagueCatalogItem = {
    id: 1,
    name: 'Tuesday Evening',
    leagueType: 'standard',
    format: 'teams',
    registrationFeeMinor: 10000,
    allowsWaitlist: true,
    allowsSabbatical: true,
    isPlayInBased: false,
    minExperienceYears: 2,
    maxExperienceYears: null,
    minAge: null,
    maxAge: null,
  };

  const eligibilityInput = {
    dateOfBirth: '1990-01-01',
    experienceType: 'specified_years' as const,
    experienceSelfReportedYears: 4,
    membershipOption: 'regular' as const,
  };

  test('allows eligible standard leagues and blocks BYOT, instructional, and experience mismatches', () => {
    expect(isThirdLeagueInterestEligibleLeague(standardLeague, eligibilityInput)).toBe(true);
    expect(
      isThirdLeagueInterestEligibleLeague(
        { ...standardLeague, leagueType: 'bring_your_own_team' },
        eligibilityInput,
      ),
    ).toBe(false);
    expect(
      isThirdLeagueInterestEligibleLeague({ ...standardLeague, format: 'instructional' }, eligibilityInput),
    ).toBe(false);
    expect(
      isThirdLeagueInterestEligibleLeague(
        { ...standardLeague, minExperienceYears: 6 },
        eligibilityInput,
      ),
    ).toBe(false);
    expect(
      isThirdLeagueInterestEligibleLeague(
        { ...standardLeague, maxExperienceYears: 2 },
        eligibilityInput,
      ),
    ).toBe(false);
  });
});

describe('filterDirectLeagueRequestEligibleLeagues', () => {
  test('filters to eligible non-waitlist leagues outside prior return spots', () => {
    const leagues: LeagueCatalogItem[] = [
      {
        id: 1,
        name: 'Play-in',
        leagueType: 'standard',
        format: 'teams',
        registrationFeeMinor: 10000,
        allowsWaitlist: false,
        allowsSabbatical: true,
        isPlayInBased: true,
      },
      {
        id: 2,
        name: 'Waitlisted',
        leagueType: 'standard',
        format: 'teams',
        registrationFeeMinor: 10000,
        allowsWaitlist: true,
        allowsSabbatical: true,
        isPlayInBased: false,
      },
      {
        id: 3,
        name: 'Prior return',
        leagueType: 'standard',
        format: 'teams',
        registrationFeeMinor: 10000,
        allowsWaitlist: false,
        allowsSabbatical: true,
        isPlayInBased: false,
      },
    ];

    expect(
      filterDirectLeagueRequestEligibleLeagues(
        leagues,
        { experienceType: 'specified_years', experienceSelfReportedYears: 5, dateOfBirth: '1990-01-01' },
        new Set([3]),
      ).map((league) => league.id),
    ).toEqual([1]);
  });
});

describe('estimated total range', () => {
  const leagues = [
    { id: 1, name: 'Friday', registrationFeeMinor: 10000, leagueType: 'standard' as const, format: 'teams' as const, allowsWaitlist: true, allowsSabbatical: true },
    { id: 2, name: 'Thursday', registrationFeeMinor: 8000, leagueType: 'standard' as const, format: 'teams' as const, allowsWaitlist: true, allowsSabbatical: true },
    { id: 3, name: 'Wednesday', registrationFeeMinor: 5000, leagueType: 'standard' as const, format: 'teams' as const, allowsWaitlist: true, allowsSabbatical: true },
  ];

  test('uses deferred payment to decide when to show an estimated range', () => {
    expect(shouldShowEstimatedTotalRange('deferred_payment')).toBe(true);
    expect(shouldShowEstimatedTotalRange('immediate_payment')).toBe(false);
  });

  test('caps league count at three when third-league interest applies', () => {
    expect(
      maxPossibleLeagueCount(
        [],
        [
          selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
          selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
        ],
        null,
      ),
    ).toBe(3);
  });

  test('uses zero floor without basic ice fallback and membership plus basic ice with fallback', () => {
    const feePreview = {
      lineItems: [
        { lineType: 'regular_membership_fee', amountMinor: 10000, discountEligible: true },
      ],
      discountTotalMinor: 0,
      totalDueMinor: 10000,
    };
    const waitlistSelections = [selection({ selectionType: 'waitlist_add', leagueId: 1 })];

    expect(
      calculateEstimatedTotalRange({
        feePreview,
        leagues,
        activeLeagueIds: [],
        selections: waitlistSelections,
        desiredAddWaitlistLeagueCount: null,
        basicIceFallbackInterest: false,
      }),
    ).toEqual({ floorMinor: 0, ceilingMinor: 20000 });

    expect(
      calculateEstimatedTotalRange({
        feePreview,
        leagues,
        activeLeagueIds: [],
        selections: waitlistSelections,
        desiredAddWaitlistLeagueCount: null,
        basicIceFallbackInterest: true,
        spareOnlyIcePrivilegeFeeMinor: 2500,
      }),
    ).toEqual({ floorMinor: 12500, ceilingMinor: 20000 });
  });

  test('uses confirmed guaranteed returns for the floor and third-league cap for the ceiling', () => {
    const feePreview = {
      lineItems: [
        { lineType: 'regular_membership_fee', amountMinor: 10000, discountEligible: true },
        { lineType: 'league_fee', amountMinor: 10000, discountEligible: true },
        { lineType: 'league_fee', amountMinor: 8000, discountEligible: true },
      ],
      discountTotalMinor: 0,
      totalDueMinor: 28000,
    };
    const selections = [
      selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
      selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
      selection({ selectionType: 'waitlist_replace', leagueId: 3, replacesLeagueId: 1 }),
      selection({ selectionType: 'third_league_interest', leagueId: 3, rank: 1 }),
    ];

    expect(
      calculateEstimatedTotalRange({
        feePreview,
        leagues,
        activeLeagueIds: [],
        selections,
        desiredAddWaitlistLeagueCount: null,
        basicIceFallbackInterest: false,
      }),
    ).toEqual({ floorMinor: 28000, ceilingMinor: 33000 });
  });
});

describe('stripThirdLeagueInterestSelections', () => {
  test('removes only third-league interest selections', () => {
    expect(
      stripThirdLeagueInterestSelections([
        selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
        selection({ selectionType: 'third_league_interest', leagueId: 2, rank: 1 }),
        selection({ selectionType: 'return_subject_to_availability', leagueId: 3 }),
      ]),
    ).toEqual([
      selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
      selection({ selectionType: 'return_subject_to_availability', leagueId: 3 }),
    ]);
  });
});
