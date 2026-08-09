import { describe, expect, test } from 'bun:test';
import {
  applyPriorReturnCheckboxLeagueIds,
  calculateEstimatedTotalRange,
  countProtectedClaimSelections,
  filterDirectLeagueRequestEligibleLeagues,
  hasPlayInWithTwoGuaranteedReturns,
  isDirectLeagueRequestLeague,
  isThirdLeagueInterestEligibleLeague,
  maxPossibleLeagueCount,
  nextLeagueFlowStepAfterLeagueRequests,
  nextLeagueFlowStepAfterPriorLeagueSelection,
  nextLeagueFlowStepAfterSelections,
  nextLeagueFlowStepAfterThirdLeagueInterest,
  previousLeagueFlowStepBeforeBasicIceFallback,
  previousLeagueFlowStepBeforeSummary,
  priorLeagueChoiceValue,
  hasGuaranteedPlayInSelection,
  isConfirmedLeagueForStatusView,
  isPendingPlayInForStatusView,
  playInUnguaranteedStatusDetail,
  shouldCollectBasicIceFallback,
  shouldCollectThirdLeagueInterest,
  shouldShowEstimatedTotalRange,
  firstOptionalByotRosterValidationMessage,
  migrateStrictThirdLeagueInterest,
  setStrictThirdLeagueInterestEnabled,
  setThirdLeagueInterestSelections,
  syncThirdLeagueInterestRostersFromSiblingSelections,
  stripThirdLeagueInterestSelections,
  updateByotRosterMembers,
  withoutInvalidPlayInPriorSelections,
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

  test('hides when the registrant has a guaranteed play-in league', () => {
    expect(
      shouldCollectBasicIceFallback(
        [selection({ selectionType: 'play_in_request', leagueId: 1 })],
        false,
        true,
      ),
    ).toBe(false);
  });

  test('hides when the registrant already chose basic ice privileges', () => {
    expect(shouldCollectBasicIceFallback([selection({ selectionType: 'waitlist_add', leagueId: 1 })], true)).toBe(false);
  });
});

describe('hasGuaranteedPlayInSelection', () => {
  test('detects a guaranteed play-in request from play-in entry summaries', () => {
    expect(
      hasGuaranteedPlayInSelection([selection({ selectionType: 'play_in_request', leagueId: 10 })], {
        10: { guaranteed: true },
      }),
    ).toBe(true);
  });

  test('ignores non-guaranteed play-in and unrelated selections', () => {
    expect(
      hasGuaranteedPlayInSelection([selection({ selectionType: 'play_in_request', leagueId: 10 })], {
        10: { guaranteed: false },
      }),
    ).toBe(false);
    expect(
      hasGuaranteedPlayInSelection([selection({ selectionType: 'waitlist_add', leagueId: 10 })], {
        10: { guaranteed: true },
      }),
    ).toBe(false);
  });
});

describe('registration status play-in section split', () => {
  test('puts guaranteed and placed play-ins under confirmed leagues', () => {
    const guaranteed = { selectionType: 'play_in_request', status: 'pending', leagueId: 10 };
    const placed = { selectionType: 'play_in_request', status: 'placed', leagueId: 11 };
    expect(isConfirmedLeagueForStatusView(guaranteed, { 10: { guaranteed: true } })).toBe(true);
    expect(isPendingPlayInForStatusView(guaranteed, { 10: { guaranteed: true } })).toBe(false);
    expect(isConfirmedLeagueForStatusView(placed, { 11: { guaranteed: false } })).toBe(true);
    expect(isPendingPlayInForStatusView(placed, {})).toBe(false);
  });

  test('keeps non-guaranteed play-ins under league play-ins', () => {
    const pending = { selectionType: 'play_in_request', status: 'pending', leagueId: 10 };
    expect(isConfirmedLeagueForStatusView(pending, { 10: { guaranteed: false } })).toBe(false);
    expect(isPendingPlayInForStatusView(pending, { 10: { guaranteed: false } })).toBe(true);
    expect(isPendingPlayInForStatusView(pending, {})).toBe(true);
  });

  test('describes why a play-in is not yet confirmed', () => {
    expect(playInUnguaranteedStatusDetail(null)).toContain('roster is incomplete');
    expect(
      playInUnguaranteedStatusDetail({ teamTotalPoints: 12, meetsReturningRule: false }),
    ).toContain('returning members');
    expect(
      playInUnguaranteedStatusDetail({ teamTotalPoints: 12, meetsReturningRule: true }),
    ).toContain('points');
  });
});

describe('applyPriorReturnCheckboxLeagueIds', () => {
  test('marks unchecked leagues as drop when fewer than two returns are selected', () => {
    const next = applyPriorReturnCheckboxLeagueIds(
      [
        selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
        selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
        selection({ selectionType: 'drop', leagueId: 3 }),
      ],
      [1, 2, 3],
      new Set(),
      [1],
    );
    expect(next).toEqual([
      selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
      selection({ selectionType: 'drop', leagueId: 2 }),
      selection({ selectionType: 'drop', leagueId: 3 }),
    ]);
  });

  test('clears a demoted return so the follow-up dropdown is required', () => {
    const next = applyPriorReturnCheckboxLeagueIds(
      [
        selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
        selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
        selection({ selectionType: 'drop', leagueId: 3 }),
      ],
      [1, 2, 3],
      new Set(),
      [1, 3],
    );
    expect(next).toEqual([
      selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
      selection({ selectionType: 'guaranteed_return', leagueId: 3 }),
    ]);
  });

  test('preserves an existing subject-to-availability follow-up choice', () => {
    const next = applyPriorReturnCheckboxLeagueIds(
      [
        selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
        selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
        selection({ selectionType: 'third_league_interest', leagueId: 3, rank: 1 }),
      ],
      [1, 2, 3],
      new Set(),
      [1, 2],
    );
    expect(next).toEqual([
      selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
      selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
      selection({ selectionType: 'third_league_interest', leagueId: 3, rank: 1 }),
    ]);
  });

  test('checks play-in leagues as play_in_request without consuming guaranteed return slots', () => {
    const next = applyPriorReturnCheckboxLeagueIds(
      [],
      [1, 2, 3, 10],
      new Set([10]),
      [1, 2, 10],
    );
    expect(next).toEqual([
      selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
      selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
      selection({ selectionType: 'play_in_request', leagueId: 10 }),
    ]);
  });

  test('caps guaranteed returns at two while allowing additional play-in checks', () => {
    const next = applyPriorReturnCheckboxLeagueIds(
      [],
      [1, 2, 3, 10],
      new Set([10]),
      [1, 2, 3, 10],
    );
    expect(next).toEqual([
      selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
      selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
      selection({ selectionType: 'play_in_request', leagueId: 10 }),
    ]);
  });

  test('drops unchecked play-in leagues without requiring a follow-up choice', () => {
    const next = applyPriorReturnCheckboxLeagueIds(
      [selection({ selectionType: 'play_in_request', leagueId: 10 })],
      [1, 2, 10],
      new Set([10]),
      [1, 2],
    );
    expect(next).toEqual([
      selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
      selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
      selection({ selectionType: 'drop', leagueId: 10 }),
    ]);
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

  test('skips basic ice fallback when a play-in selection is guaranteed', () => {
    expect(
      nextLeagueFlowStepAfterSelections({
        selections: [selection({ selectionType: 'play_in_request', leagueId: 1 })],
        desiredAddWaitlistLeagueCount: null,
        isBasicIceLeagueSelection: false,
        hasGuaranteedPlayInEntry: true,
      }),
    ).toBe('/registration/league-summary');
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

  test('includes play-in and non-waitlist standard leagues', () => {
    expect(isDirectLeagueRequestLeague({ ...baseLeague, isPlayInBased: true })).toBe(true);
    expect(isDirectLeagueRequestLeague({ ...baseLeague, allowsWaitlist: false })).toBe(true);
    expect(
      isDirectLeagueRequestLeague({
        ...baseLeague,
        leagueType: 'bring_your_own_team',
        isPlayInBased: true,
        allowsWaitlist: false,
      }),
    ).toBe(true);
  });

  test('excludes waitlisted standard leagues and non-play-in bring-your-own-team leagues', () => {
    expect(isDirectLeagueRequestLeague(baseLeague)).toBe(false);
    expect(
      isDirectLeagueRequestLeague({
        ...baseLeague,
        leagueType: 'bring_your_own_team',
        allowsWaitlist: false,
      }),
    ).toBe(false);
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

  test('allows eligible standard and BYOT leagues and blocks play-in, instructional, and experience mismatches', () => {
    expect(isThirdLeagueInterestEligibleLeague(standardLeague, eligibilityInput)).toBe(true);
    expect(
      isThirdLeagueInterestEligibleLeague(
        { ...standardLeague, leagueType: 'bring_your_own_team', format: 'doubles' },
        eligibilityInput,
      ),
    ).toBe(true);
    expect(
      isThirdLeagueInterestEligibleLeague(
        { ...standardLeague, leagueType: 'bring_your_own_team', isPlayInBased: true },
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

  test('keeps play-in prior leagues available on league requests', () => {
    const leagues: LeagueCatalogItem[] = [
      {
        id: 1,
        name: 'Tuesday competitive',
        leagueType: 'bring_your_own_team',
        format: 'teams',
        registrationFeeMinor: 10000,
        allowsWaitlist: false,
        allowsSabbatical: false,
        isPlayInBased: true,
      },
      {
        id: 2,
        name: 'Monday',
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
        new Set([1, 2]),
      ).map((league) => league.id),
    ).toEqual([1]);
  });

  test('sorts competitive leagues ahead of other direct requests', () => {
    const leagues: LeagueCatalogItem[] = [
      {
        id: 2,
        name: 'Instructional',
        leagueType: 'standard',
        format: 'instructional',
        registrationFeeMinor: 5000,
        allowsWaitlist: false,
        allowsSabbatical: false,
        isPlayInBased: false,
      },
      {
        id: 1,
        name: 'Tuesday competitive',
        leagueType: 'bring_your_own_team',
        format: 'teams',
        registrationFeeMinor: 10000,
        allowsWaitlist: false,
        allowsSabbatical: false,
        isPlayInBased: true,
      },
    ];

    expect(
      filterDirectLeagueRequestEligibleLeagues(
        leagues,
        { experienceType: 'specified_years', experienceSelfReportedYears: 5, dateOfBirth: '1990-01-01' },
        new Set(),
      ).map((league) => league.id),
    ).toEqual([1, 2]);
  });
});

describe('protected claim counting', () => {
  test('does not count play-in requests toward protected claims', () => {
    expect(
      countProtectedClaimSelections([
        selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
        selection({ selectionType: 'play_in_request', leagueId: 2 }),
        selection({ selectionType: 'drop', leagueId: 3 }),
      ]),
    ).toBe(1);
  });

  test('detects play-in with two guaranteed returns', () => {
    expect(
      hasPlayInWithTwoGuaranteedReturns([
        selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
        selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
        selection({ selectionType: 'play_in_request', leagueId: 3 }),
      ]),
    ).toBe(true);
    expect(
      hasPlayInWithTwoGuaranteedReturns([
        selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
        selection({ selectionType: 'play_in_request', leagueId: 3 }),
      ]),
    ).toBe(false);
  });
});

describe('priorLeagueChoiceValue', () => {
  test('hides invalid guaranteed_return for play-in leagues', () => {
    expect(
      priorLeagueChoiceValue(selection({ selectionType: 'guaranteed_return', leagueId: 1 }), {
        isPlayInBased: true,
      }),
    ).toBeNull();
    expect(
      priorLeagueChoiceValue(selection({ selectionType: 'play_in_request', leagueId: 1 }), {
        isPlayInBased: true,
      }),
    ).toBe('play_in_request');
  });

  test('keeps guaranteed_return for regular prior leagues', () => {
    expect(
      priorLeagueChoiceValue(selection({ selectionType: 'guaranteed_return', leagueId: 1 }), {
        isPlayInBased: false,
      }),
    ).toBe('guaranteed_return');
  });
});

describe('withoutInvalidPlayInPriorSelections', () => {
  test('removes guaranteed_return from play-in leagues and leaves valid choices', () => {
    expect(
      withoutInvalidPlayInPriorSelections(
        [
          selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
          selection({ selectionType: 'drop', leagueId: 1 }),
          selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
        ],
        [
          { id: 1, isPlayInBased: true },
          { id: 2, isPlayInBased: false },
        ],
      ),
    ).toEqual([
      selection({ selectionType: 'drop', leagueId: 1 }),
      selection({ selectionType: 'guaranteed_return', leagueId: 2 }),
    ]);
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

describe('updateByotRosterMembers for play-in', () => {
  test('preserves play-in replacesLeagueId when the roster is updated', () => {
    const selections: RegistrationSelectionInput[] = [
      selection({
        selectionType: 'play_in_request',
        leagueId: 10,
        replacesLeagueId: 1,
        teamRosterPlacements: [
          { memberId: 100, entryType: 'add', replacesLeagueId: null },
        ],
      }),
    ];
    const next = updateByotRosterMembers(
      selections,
      10,
      [101, 102],
      new Map([
        [101, 'Teammate One'],
        [102, 'Teammate Two'],
      ]),
      { id: 100, name: 'Registrant' },
      new Map(),
    );
    expect(next[0]?.replacesLeagueId).toBe(1);
    expect(next[0]?.teamRosterPlacements?.find((placement) => placement.memberId === 100)).toEqual({
      memberId: 100,
      entryType: 'replace',
      replacesLeagueId: 1,
    });
  });
});

describe('strict third-league interest helpers', () => {
  test('setStrictThirdLeagueInterestEnabled does not strip return_subject_to_availability', () => {
    const current: RegistrationSelectionInput[] = [
      selection({ selectionType: 'return_subject_to_availability', leagueId: 5 }),
      selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
    ];
    const enabled = setStrictThirdLeagueInterestEnabled(current, 1, true);
    expect(enabled).toEqual([
      selection({ selectionType: 'return_subject_to_availability', leagueId: 5 }),
      selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
      { selectionType: 'third_league_interest', leagueId: 1, rank: 1 },
    ]);
    const disabled = setStrictThirdLeagueInterestEnabled(enabled, 1, false);
    expect(disabled).toEqual([
      selection({ selectionType: 'return_subject_to_availability', leagueId: 5 }),
      selection({ selectionType: 'guaranteed_return', leagueId: 1 }),
    ]);
  });

  test('setStrictThirdLeagueInterestEnabled copies roster from guaranteed return', () => {
    const current: RegistrationSelectionInput[] = [
      selection({
        selectionType: 'guaranteed_return',
        leagueId: 1,
        byotTeammateText: 'Partner Name',
        teamRosterPlacements: [
          { memberId: 100, entryType: 'add', replacesLeagueId: null },
          { memberId: 101, entryType: 'add', replacesLeagueId: null },
        ],
      }),
    ];
    expect(setStrictThirdLeagueInterestEnabled(current, 1, true)).toEqual([
      selection({
        selectionType: 'guaranteed_return',
        leagueId: 1,
        byotTeammateText: 'Partner Name',
        teamRosterPlacements: [
          { memberId: 100, entryType: 'add', replacesLeagueId: null },
          { memberId: 101, entryType: 'add', replacesLeagueId: null },
        ],
      }),
      {
        selectionType: 'third_league_interest',
        leagueId: 1,
        rank: 1,
        byotTeammateText: 'Partner Name',
        teamRosterPlacements: [
          { memberId: 100, entryType: 'add', replacesLeagueId: null },
          { memberId: 101, entryType: 'add', replacesLeagueId: null },
        ],
      },
    ]);
  });

  test('syncThirdLeagueInterestRostersFromSiblingSelections fills empty interest from return', () => {
    const current: RegistrationSelectionInput[] = [
      selection({
        selectionType: 'guaranteed_return',
        leagueId: 1,
        byotTeammateText: 'Partner Name',
        teamRosterPlacements: [{ memberId: 100, entryType: 'add', replacesLeagueId: null }],
      }),
      selection({ selectionType: 'third_league_interest', leagueId: 1, rank: 1 }),
    ];
    expect(syncThirdLeagueInterestRostersFromSiblingSelections(current)).toEqual([
      selection({
        selectionType: 'guaranteed_return',
        leagueId: 1,
        byotTeammateText: 'Partner Name',
        teamRosterPlacements: [{ memberId: 100, entryType: 'add', replacesLeagueId: null }],
      }),
      {
        selectionType: 'third_league_interest',
        leagueId: 1,
        rank: 1,
        byotTeammateText: 'Partner Name',
        teamRosterPlacements: [{ memberId: 100, entryType: 'add', replacesLeagueId: null }],
      },
    ]);
  });

  test('migrateStrictThirdLeagueInterest moves interest with the replace target', () => {
    const current: RegistrationSelectionInput[] = [
      selection({ selectionType: 'third_league_interest', leagueId: 1, rank: 1 }),
      selection({ selectionType: 'return_subject_to_availability', leagueId: 5 }),
    ];
    expect(migrateStrictThirdLeagueInterest(current, 1, 2)).toEqual([
      selection({ selectionType: 'return_subject_to_availability', leagueId: 5 }),
      { selectionType: 'third_league_interest', leagueId: 2, rank: 1 },
    ]);
  });
});

describe('third-league BYOT roster helpers', () => {
  const doublesByot: LeagueCatalogItem = {
    id: 10,
    name: 'Sunday Doubles',
    leagueType: 'bring_your_own_team',
    format: 'doubles',
    registrationFeeMinor: 5000,
    allowsWaitlist: false,
    allowsSabbatical: false,
    isPlayInBased: false,
    minExperienceYears: null,
    maxExperienceYears: null,
    minAge: null,
    maxAge: null,
  };

  test('setThirdLeagueInterestSelections preserves optional roster fields', () => {
    const current: RegistrationSelectionInput[] = [
      selection({
        selectionType: 'third_league_interest',
        leagueId: 10,
        rank: 1,
        byotTeammateText: 'Partner Name',
        teamRosterPlacements: [{ memberId: 100, entryType: 'add', replacesLeagueId: null }],
      }),
    ];
    const next = setThirdLeagueInterestSelections(current, [10, 11], new Set());
    expect(next).toEqual([
      {
        selectionType: 'third_league_interest',
        leagueId: 10,
        rank: 1,
        byotTeammateText: 'Partner Name',
        teamRosterPlacements: [{ memberId: 100, entryType: 'add', replacesLeagueId: null }],
      },
      {
        selectionType: 'third_league_interest',
        leagueId: 11,
        rank: 2,
        byotTeammateText: null,
        teamRosterPlacements: null,
      },
    ]);
  });

  test('updateByotRosterMembers keeps third_league_interest selection type', () => {
    const selections: RegistrationSelectionInput[] = [
      selection({
        selectionType: 'third_league_interest',
        leagueId: 10,
        rank: 1,
        teamRosterPlacements: [{ memberId: 100, entryType: 'add', replacesLeagueId: null }],
      }),
    ];
    const next = updateByotRosterMembers(
      selections,
      10,
      [101],
      new Map([[101, 'Partner']]),
      { id: 100, name: 'Registrant' },
      new Map(),
    );
    expect(next[0]?.selectionType).toBe('third_league_interest');
    expect(next[0]?.teamRosterPlacements?.map((placement) => placement.memberId)).toEqual([100, 101]);
  });

  test('firstOptionalByotRosterValidationMessage allows empty or partial rosters', () => {
    const empty = firstOptionalByotRosterValidationMessage(
      [selection({ selectionType: 'third_league_interest', leagueId: 10, rank: 1 })],
      [doublesByot],
      new Map(),
      { id: 100, name: 'Registrant' },
    );
    expect(empty).toBeNull();

    const partial = firstOptionalByotRosterValidationMessage(
      [
        selection({
          selectionType: 'guaranteed_return',
          leagueId: 10,
          teamRosterPlacements: [
            { memberId: 100, entryType: 'add', replacesLeagueId: null },
            { memberId: 101, entryType: 'add', replacesLeagueId: null },
          ],
        }),
      ],
      [doublesByot],
      new Map(),
      { id: 100, name: 'Registrant' },
    );
    expect(partial).toBeNull();
  });

  test('applyPriorReturnCheckboxLeagueIds preserves optional BYOT roster on guaranteed return', () => {
    const current: RegistrationSelectionInput[] = [
      selection({
        selectionType: 'guaranteed_return',
        leagueId: 10,
        byotTeammateText: 'Partner Name',
        teamRosterPlacements: [{ memberId: 100, entryType: 'add', replacesLeagueId: null }],
      }),
    ];
    const next = applyPriorReturnCheckboxLeagueIds(current, [10, 11], new Set(), [10]);
    expect(next).toEqual([
      {
        selectionType: 'guaranteed_return',
        leagueId: 10,
        byotTeammateText: 'Partner Name',
        teamRosterPlacements: [{ memberId: 100, entryType: 'add', replacesLeagueId: null }],
      },
      {
        selectionType: 'drop',
        leagueId: 11,
      },
    ]);
  });

  test('updateByotRosterMembers keeps guaranteed_return selection type', () => {
    const selections: RegistrationSelectionInput[] = [
      selection({
        selectionType: 'guaranteed_return',
        leagueId: 10,
        teamRosterPlacements: [{ memberId: 100, entryType: 'add', replacesLeagueId: null }],
      }),
    ];
    const next = updateByotRosterMembers(
      selections,
      10,
      [101],
      new Map([[101, 'Partner']]),
      { id: 100, name: 'Registrant' },
      new Map(),
    );
    expect(next[0]?.selectionType).toBe('guaranteed_return');
    expect(next[0]?.teamRosterPlacements?.map((placement) => placement.memberId)).toEqual([100, 101]);
  });
});
