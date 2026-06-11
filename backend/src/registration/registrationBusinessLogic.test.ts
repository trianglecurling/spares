import { describe, expect, test } from 'bun:test';
import { ageOnLeagueStart, calculateClubExperienceYears, totalExperienceYears } from './registrationAgeExperience.js';
import { evaluateRegistrationDraft } from './evaluateRegistrationDraft.js';
import { calculateRegistrationFees } from './registrationFeeCalculator.js';
import { validateLeagueEligibility, validateSpareOnlyEligibility, validateWaitlistEligibility } from './registrationEligibility.js';
import { evaluateWaitlistCleanup, validateRegistrationSelections } from './registrationLeagueSelections.js';
import { decideRegistrationPayment } from './registrationPaymentDecision.js';
import { evaluateGuaranteedReturnEligibility, evaluateSabbaticalEligibility } from './registrationReturningRights.js';
import { league, registrationContext, selection } from './registrationTestFixtures.js';

function expectReason(result: { reasonCodes: string[] }, reasonCode: string): void {
  expect(result.reasonCodes).toContain(reasonCode);
}

describe('registration business logic', () => {
  test('closed registration blocks registration', () => {
    const context = registrationContext({ registrationState: 'closed' });
    const result = validateRegistrationSelections(context);
    expect(result.allowed).toBe(false);
    expectReason(result, 'registration_closed');
  });

  test('open registration allows non-guaranteed registration but blocks guaranteed return and sabbatical', () => {
    const openLeague = league();
    const nonGuaranteed = registrationContext({
      registrationState: 'open',
      leagues: { [openLeague.id]: openLeague },
      selections: [selection({ selectionType: 'return_subject_to_availability' })],
    });
    expect(validateRegistrationSelections(nonGuaranteed).allowed).toBe(true);

    const protectedClaim = registrationContext({ registrationState: 'open' });
    const result = validateRegistrationSelections(protectedClaim);
    expect(result.allowed).toBe(false);
    expectReason(result, 'not_priority_registration');
  });

  test('priority registration allows guaranteed return', () => {
    const result = validateRegistrationSelections(registrationContext());
    expect(result.allowed).toBe(true);
  });

  test('social membership has no ice privileges', () => {
    const context = registrationContext({ membershipOption: 'social' });
    const result = validateRegistrationSelections(context);
    expect(result.allowed).toBe(false);
    expectReason(result, 'social_membership_no_ice');
  });

  test('social membership is not discounted', () => {
    const context = registrationContext({
      membershipOption: 'social',
      selections: [],
      discountClaims: {
        student: { claimed: true, institution: 'NC State' },
        reciprocal: { claimed: true, clubName: 'Other Curling Club' },
        winterOnly: { claimed: true },
      },
      isFirstSessionOfSeason: false,
    });
    const fees = calculateRegistrationFees(context);
    expect(fees.totalDueMinor).toBe(4000);
    expect(fees.discountLineItems).toHaveLength(0);
  });

  test('social-to-regular upgrade gets no credit and no discounts', () => {
    const context = registrationContext({
      selections: [],
      isSocialToRegularUpgrade: true,
      discountClaims: { student: { claimed: true, institution: 'UNC' } },
    });
    const fees = calculateRegistrationFees(context);
    expect(fees.totalDueMinor).toBe(10000);
    expect(fees.discountLineItems).toHaveLength(0);
  });

  test('regular membership plus spare-only charges both fees', () => {
    const context = registrationContext({
      membershipOption: 'regular_spare_only',
      selections: [selection({ selectionType: 'spare_only', leagueId: null })],
    });
    const fees = calculateRegistrationFees(context);
    expect(fees.lineItems.map((item) => item.lineType)).toEqual(['regular_membership_fee', 'spare_only_fee']);
    expect(fees.totalDueMinor).toBe(12500);
    expect(validateSpareOnlyEligibility(context).eligible).toBe(true);
  });

  test('league play with only fee-0 leagues silently charges the basic ice fee', () => {
    const freeLeague = league({ id: 200, name: 'Daytime League', registrationFeeMinor: 0, predecessorLeagueId: null });
    const context = registrationContext({
      membershipOption: 'regular',
      leagues: { [freeLeague.id]: freeLeague },
      participatedLeagueIds: [],
      selections: [selection({ selectionType: 'waitlist_add', leagueId: freeLeague.id })],
    });
    const fees = calculateRegistrationFees(context);
    expect(fees.lineItems.map((item) => item.lineType)).toContain('spare_only_fee');
  });

  test('basic ice daytime leagues register directly without waitlists', () => {
    const daytimeLeague = league({
      id: 201,
      name: 'Tuesday Daytime',
      registrationFeeMinor: 0,
      allowsWaitlist: false,
      predecessorLeagueId: null,
    });
    const context = registrationContext({
      membershipOption: 'regular_spare_only',
      leagues: { [daytimeLeague.id]: daytimeLeague },
      selections: [selection({ selectionType: 'instructional_join', leagueId: daytimeLeague.id })],
    });
    expect(validateRegistrationSelections(context).allowed).toBe(true);
    expect(evaluateRegistrationDraft(context).paymentDecision.outcome).toBe('immediate_payment');
  });

  test('basic ice daytime leagues reject stale waitlist fulfillment preferences', () => {
    const daytimeLeague = league({
      id: 202,
      name: 'Wednesday Daytime',
      registrationFeeMinor: 0,
      allowsWaitlist: false,
      predecessorLeagueId: null,
    });
    const context = registrationContext({
      membershipOption: 'regular_spare_only',
      leagues: { [daytimeLeague.id]: daytimeLeague },
      selections: [selection({ selectionType: 'instructional_join', leagueId: daytimeLeague.id })],
      desiredAddWaitlistLeagueCount: 2,
    });
    expect(validateRegistrationSelections(context).blockingErrors.map((error) => error.code)).toContain(
      'waitlist_fulfillment_not_applicable',
    );
  });

  test('instructional join does not count toward the first two league limit', () => {
    const instructionalLeague = league({
      id: 210,
      name: 'Instructional',
      format: 'instructional',
      allowsWaitlist: false,
      predecessorLeagueId: null,
      minExperienceYears: 0,
    });
    const leagueA = league({ id: 211, predecessorLeagueId: 90 });
    const leagueB = league({ id: 212, predecessorLeagueId: 91 });
    const context = registrationContext({
      leagues: {
        [instructionalLeague.id]: instructionalLeague,
        [leagueA.id]: leagueA,
        [leagueB.id]: leagueB,
        91: league({ id: 91, predecessorLeagueId: null }),
      },
      participatedLeagueIds: [90, 91],
      selections: [
        selection({ selectionType: 'guaranteed_return', leagueId: leagueA.id }),
        selection({ selectionType: 'guaranteed_return', leagueId: leagueB.id }),
        selection({ selectionType: 'instructional_join', leagueId: instructionalLeague.id }),
      ],
    });
    expect(validateRegistrationSelections(context).allowed).toBe(true);
  });

  test('league play with a paid league does not charge the basic ice fee', () => {
    const context = registrationContext({
      membershipOption: 'regular',
      selections: [selection({ selectionType: 'guaranteed_return', leagueId: 100 })],
    });
    const fees = calculateRegistrationFees(context);
    expect(fees.lineItems.map((item) => item.lineType)).not.toContain('spare_only_fee');
  });

  test('social membership cannot include spare-only basic ice privileges', () => {
    const result = validateSpareOnlyEligibility(registrationContext({ membershipOption: 'social', selections: [] }));
    expect(result.eligible).toBe(false);
    expectReason(result, 'spare_only_requires_regular_membership');
  });

  test('student discount requires institution and auto-applies with institution', () => {
    const invalid = calculateRegistrationFees(
      registrationContext({ selections: [], discountClaims: { student: { claimed: true } } })
    );
    expect(invalid.blockingErrors.map((error) => error.code)).toContain('student_discount_requires_institution');

    const valid = calculateRegistrationFees(
      registrationContext({ selections: [], discountClaims: { student: { claimed: true, institution: 'Duke' } } })
    );
    expect(valid.discountLineItems[0]?.lineType).toBe('student_discount');
    expect(valid.totalDueMinor).toBe(9000);
  });

  test('reciprocal discount requires club and auto-applies with club', () => {
    const invalid = calculateRegistrationFees(
      registrationContext({ selections: [], discountClaims: { reciprocal: { claimed: true } } })
    );
    expect(invalid.blockingErrors.map((error) => error.code)).toContain('reciprocal_discount_requires_club');

    const valid = calculateRegistrationFees(
      registrationContext({ selections: [], discountClaims: { reciprocal: { claimed: true, clubName: 'Charlotte' } } })
    );
    expect(valid.discountLineItems[0]?.lineType).toBe('reciprocal_discount');
    expect(valid.totalDueMinor).toBe(9000);
  });

  test('winter-only discount applies after the first session and not during the first session', () => {
    const winter = calculateRegistrationFees(registrationContext({ selections: [], isFirstSessionOfSeason: false }));
    expect(winter.discountLineItems[0]?.lineType).toBe('winter_only_discount');
    expect(winter.totalDueMinor).toBe(7500);

    const fall = calculateRegistrationFees(registrationContext({ selections: [], isFirstSessionOfSeason: true }));
    expect(fall.discountLineItems).toHaveLength(0);
    expect(fall.totalDueMinor).toBe(10000);
  });

  test('winter-only discount applies after any first session and only to regular membership dues', () => {
    const thirdSession = calculateRegistrationFees(
      registrationContext({
        membershipOption: 'regular_spare_only',
        selections: [],
        isFirstSessionOfSeason: false,
      })
    );
    expect(thirdSession.discountLineItems[0]?.lineType).toBe('winter_only_discount');
    expect(thirdSession.discountLineItems[0]?.amountMinor).toBe(-2500);
    expect(thirdSession.totalDueMinor).toBe(10000);

    const social = calculateRegistrationFees(
      registrationContext({
        membershipOption: 'social',
        selections: [],
        isFirstSessionOfSeason: false,
      })
    );
    expect(social.discountLineItems).toHaveLength(0);
    expect(social.totalDueMinor).toBe(4000);
  });

  test('dollar discounts apply before percentage discounts', () => {
    const context = registrationContext({
      selections: [],
      discountClaims: {
        student: { claimed: true, institution: 'Wake Tech' },
        reciprocal: { claimed: true, clubName: 'Other Club' },
      },
    });
    const fees = calculateRegistrationFees(context);
    expect(fees.discountTotalMinor).toBe(1900);
    expect(fees.totalDueMinor).toBe(8100);
  });

  test('sabbatical fee is not discounted and sabbatical-fill discount equals the sabbatical fee', () => {
    const tempFillLeague = league({ registrationFeeMinor: 12000 });
    const fees = calculateRegistrationFees(
      registrationContext({
        leagues: { [tempFillLeague.id]: tempFillLeague },
        selections: [
          selection({ selectionType: 'return_subject_to_availability', isTemporarySabbaticalFill: true }),
          selection({ selectionType: 'sabbatical' }),
        ],
        discountClaims: { student: { claimed: true, institution: 'NCSU' } },
      })
    );
    expect(fees.lineItems.find((item) => item.lineType === 'sabbatical_fee')?.discountEligible).toBe(false);
    expect(fees.discountLineItems.find((item) => item.lineType === 'sabbatical_fill_discount')?.amountMinor).toBe(-5000);
  });

  test('age eligibility uses the first day of league and blocks under or over age', () => {
    const juniorLeague = league({ minAge: 18, firstDayOfPlay: '2026-09-15' });
    expect(ageOnLeagueStart('2008-09-15', juniorLeague)).toBe(18);

    const under = validateLeagueEligibility(
      registrationContext({ registrant: { memberId: 20, hasUserAccount: true, isReturningMember: true, dateOfBirth: '2008-09-16' } }),
      juniorLeague
    );
    expectReason(under, 'under_minimum_age');

    const over = validateLeagueEligibility(
      registrationContext({ registrant: { memberId: 20, hasUserAccount: true, isReturningMember: true, dateOfBirth: '1990-01-01' } }),
      league({ maxAge: 17 })
    );
    expectReason(over, 'over_maximum_age');
  });

  test('none or minimal experience is allowed for instructional and blocked from experienced leagues', () => {
    const instructional = validateLeagueEligibility(
      registrationContext({
        experience: {
          type: 'none_or_minimal',
          baselineOtherClubExperienceYears: 0,
          baselineClubExperienceYears: 0,
          completedSessions: [],
        },
      }),
      league({ format: 'instructional', minExperienceYears: 0 })
    );
    expect(instructional.eligible).toBe(true);

    const experienced = validateLeagueEligibility(
      registrationContext({
        experience: {
          type: 'none_or_minimal',
          baselineOtherClubExperienceYears: 0,
          baselineClubExperienceYears: 0,
          completedSessions: [],
        },
      }),
      league({ format: 'teams', minExperienceYears: 1 })
    );
    expectReason(experienced, 'insufficient_experience');
  });

  test('blank league age and experience constraints stored as zero are ignored for eligibility', () => {
    const context = registrationContext({
      registrant: { memberId: 20, hasUserAccount: true, isReturningMember: true, dateOfBirth: '1990-01-01' },
      experience: {
        type: 'specified_years',
        selfReportedYears: 4,
        baselineOtherClubExperienceYears: 0,
        baselineClubExperienceYears: 0,
        completedSessions: [],
      },
    });

    expect(validateLeagueEligibility(context, league({ minAge: 0, maxAge: 0 })).eligible).toBe(true);
    expect(validateLeagueEligibility(context, league({ minExperienceYears: 0, maxExperienceYears: 0 })).eligible).toBe(true);
    expect(validateLeagueEligibility(context, league({ maxAge: 17 })).eligible).toBe(false);
    expect(validateLeagueEligibility(context, league({ maxExperienceYears: 2 })).eligible).toBe(false);
  });

  test('total experience combines baselines, self-report, and computed club sessions', () => {
    expect(
      totalExperienceYears({
        experienceType: 'known_existing',
        baselines: { baselineOtherClubExperienceYears: 2, baselineClubExperienceYears: 1.5 },
        completedSessions: [{ leagueId: 1, seasonKey: '2025-26' }],
      })
    ).toBe(4.5);
    expect(
      totalExperienceYears({
        experienceType: 'specified_years',
        selfReportedYears: 3,
        baselines: { baselineOtherClubExperienceYears: 0, baselineClubExperienceYears: 0 },
        completedSessions: [],
      })
    ).toBe(3);
  });

  test('session experience accrues as one year per season regardless of session count', () => {
    expect(
      calculateClubExperienceYears([
        { leagueId: 1, seasonKey: '2025-26' },
        { leagueId: 2, seasonKey: '2025-26' },
        { leagueId: 3, seasonKey: '2025-26' },
        { leagueId: 4, seasonKey: '2026-27' },
      ])
    ).toBe(2);
  });

  test('returning member can select two guaranteed leagues but not three protected claims', () => {
    const leagueA = league({ id: 100, predecessorLeagueId: 90 });
    const leagueB = league({ id: 101, predecessorLeagueId: 91 });
    const leagueC = league({ id: 102, predecessorLeagueId: 92 });
    const two = registrationContext({
      leagues: { 100: leagueA, 101: leagueB, 102: leagueC },
      participatedLeagueIds: [90, 91, 92],
      selections: [
        selection({ leagueId: 100, selectionType: 'guaranteed_return' }),
        selection({ leagueId: 101, selectionType: 'sabbatical' }),
      ],
    });
    expect(validateRegistrationSelections(two).allowed).toBe(true);

    const three = { ...two, selections: [...two.selections, selection({ leagueId: 102, selectionType: 'guaranteed_return' })] };
    const result = validateRegistrationSelections(three);
    expect(result.allowed).toBe(false);
    expectReason(result, 'protected_claim_limit_exceeded');
  });

  test('returning member with one return and one sabbatical may join an ADD waitlist', () => {
    const leagueA = league({ id: 100, predecessorLeagueId: 90 });
    const leagueB = league({ id: 101, predecessorLeagueId: 91 });
    const waitlistLeague = league({ id: 200 });
    const context = registrationContext({
      leagues: { 100: leagueA, 101: leagueB, 200: waitlistLeague },
      participatedLeagueIds: [90, 91],
      selections: [
        selection({ leagueId: 100, selectionType: 'guaranteed_return' }),
        selection({ leagueId: 101, selectionType: 'sabbatical' }),
        selection({ leagueId: 200, selectionType: 'waitlist_add', rank: 1 }),
      ],
    });
    expect(validateRegistrationSelections(context).allowed).toBe(true);
  });

  test('guaranteed return is unavailable outside priority and skipped predecessor loses guarantee', () => {
    const open = evaluateGuaranteedReturnEligibility(registrationContext({ registrationState: 'open' }), league());
    expectReason(open, 'not_priority_registration');

    const skipped = evaluateGuaranteedReturnEligibility(
      registrationContext({ participatedLeagueIds: [80] }),
      league({ predecessorLeagueId: 90 })
    );
    expectReason(skipped, 'guaranteed_return_requires_predecessor_participation');
  });

  test('sabbatical requires return eligibility and counts toward protected claim limit', () => {
    const noReturn = evaluateSabbaticalEligibility(registrationContext({ participatedLeagueIds: [] }), league());
    expectReason(noReturn, 'sabbatical_requires_return_right');

    const context = registrationContext({
      participatedLeagueIds: [90, 91, 92],
      leagues: {
        100: league({ id: 100, predecessorLeagueId: 90 }),
        101: league({ id: 101, predecessorLeagueId: 91 }),
        102: league({ id: 102, predecessorLeagueId: 92 }),
      },
      selections: [
        selection({ leagueId: 100, selectionType: 'guaranteed_return' }),
        selection({ leagueId: 101, selectionType: 'sabbatical' }),
        selection({ leagueId: 102, selectionType: 'guaranteed_return' }),
      ],
    });
    expectReason(validateRegistrationSelections(context), 'protected_claim_limit_exceeded');
  });

  test('sabbatical-only does not require regular membership', () => {
    const context = registrationContext({
      membershipOption: 'none',
      selections: [selection({ selectionType: 'sabbatical' })],
    });
    const fees = calculateRegistrationFees(context);
    expect(fees.lineItems.map((item) => item.lineType)).toEqual(['sabbatical_fee']);
    expect(fees.totalDueMinor).toBe(5000);
  });

  test('sabbatical is unavailable for BYOT and temporary fill spots', () => {
    expectReason(evaluateSabbaticalEligibility(registrationContext(), league({ leagueType: 'bring_your_own_team' })), 'byot_no_sabbatical');
    expectReason(evaluateSabbaticalEligibility(registrationContext(), league(), { isTemporarySabbaticalFill: true }), 'sabbatical_not_for_temporary_fill');
  });

  test('sabbatical duration is allowed before limit and blocked at or after limit unless overridden', () => {
    const context = registrationContext({
      participatedLeagueIds: [],
      existingSabbaticals: [
        {
          id: 1,
          originalLeagueId: 90,
          currentLeagueId: 90,
          firstSabbaticalLeagueId: 90,
          firstSabbaticalStartDate: '2026-10-01',
          status: 'active',
        },
      ],
    });
    expect(evaluateSabbaticalEligibility(context, league({ lastDayOfPlay: '2029-09-30' })).eligible).toBe(true);
    expectReason(evaluateSabbaticalEligibility(context, league({ lastDayOfPlay: '2029-10-01' })), 'sabbatical_duration_limit_exceeded');
    expect(evaluateSabbaticalEligibility({ ...context, staffOverrideSabbaticalDuration: true }, league({ lastDayOfPlay: '2029-10-01' })).requiresStaffReview).toBe(true);
  });

  test('non-member with an account can join a waitlist but ineligible people cannot', () => {
    const context = registrationContext({ membershipOption: 'none', activeLeagueIds: [], selections: [] });
    expect(validateWaitlistEligibility(context, league()).eligible).toBe(true);

    const tooYoung = validateWaitlistEligibility(
      registrationContext({
        membershipOption: 'none',
        selections: [],
        registrant: { memberId: 20, hasUserAccount: true, isReturningMember: false, dateOfBirth: '2020-01-01' },
      }),
      league({ minAge: 18 })
    );
    expectReason(tooYoung, 'under_minimum_age');
  });

  test('ADD waitlists are allowed with zero or one league, unlimited, and blocked with two leagues', () => {
    const friday = league({ id: 51 });
    const thursday = league({ id: 52 });
    const addFriday = selection({ selectionType: 'waitlist_add', leagueId: friday.id, rank: 1 });
    const addThursday = selection({ selectionType: 'waitlist_add', leagueId: thursday.id, rank: 2 });
    const twoAddWaitlists = validateRegistrationSelections(
      registrationContext({
        activeLeagueIds: [],
        leagues: { [friday.id]: friday, [thursday.id]: thursday },
        selections: [addFriday, addThursday],
        desiredAddWaitlistLeagueCount: 1,
      }),
    );
    expect(twoAddWaitlists.allowed).toBe(true);

    const addSelection = selection({ selectionType: 'waitlist_add' });
    expect(validateRegistrationSelections(registrationContext({ activeLeagueIds: [1], selections: [addSelection] })).allowed).toBe(true);
    const blocked = validateRegistrationSelections(registrationContext({ activeLeagueIds: [1, 2], selections: [addSelection] }));
    expectReason(blocked, 'add_waitlist_requires_zero_or_one_leagues');

    const twoReturns = validateRegistrationSelections(
      registrationContext({
        activeLeagueIds: [],
        leagues: {
          100: league({ id: 100 }),
          101: league({ id: 101 }),
          200: league({ id: 200 }),
        },
        selections: [
          selection({ leagueId: 100, selectionType: 'guaranteed_return' }),
          selection({ leagueId: 101, selectionType: 'guaranteed_return' }),
          selection({ leagueId: 200, selectionType: 'waitlist_add', rank: 1 }),
        ],
      }),
    );
    expectReason(twoReturns, 'add_waitlist_requires_zero_or_one_leagues');
  });

  test('REPLACE waitlist requires replaced league and is limited to two', () => {
    expectReason(
      validateRegistrationSelections(registrationContext({ selections: [selection({ selectionType: 'waitlist_replace' })] })),
      'replace_waitlist_requires_replaced_league'
    );
    expectReason(
      validateRegistrationSelections(
        registrationContext({
          activeLeagueIds: [2],
          selections: [selection({ selectionType: 'waitlist_replace', replacesLeagueId: 1 })],
        })
      ),
      'replace_waitlist_replacement_not_held'
    );
    expect(
      validateRegistrationSelections(
        registrationContext({
          activeLeagueIds: [1],
          selections: [selection({ selectionType: 'waitlist_replace', replacesLeagueId: 1 })],
        })
      ).allowed
    ).toBe(true);

    const context = registrationContext({
      existingWaitlistEntries: [
        { waitlistId: 10, leagueId: 10, entryType: 'replace', replacesLeagueId: 1, status: 'active' },
        { waitlistId: 11, leagueId: 11, entryType: 'replace', replacesLeagueId: 2, status: 'active' },
      ],
      selections: [selection({ selectionType: 'waitlist_replace', replacesLeagueId: 1 })],
    });
    expectReason(validateRegistrationSelections(context), 'replace_waitlist_limit_exceeded');
  });

  test('selection league must belong to the registration session and drops are accepted as structured choices', () => {
    expectReason(
      validateRegistrationSelections(
        registrationContext({
          leagues: { 100: league({ sessionId: 999 }) },
          selections: [selection({ selectionType: 'waitlist_add' })],
        })
      ),
      'league_not_in_registration_session'
    );

    expect(validateRegistrationSelections(registrationContext({ selections: [selection({ selectionType: 'drop' })] })).allowed).toBe(true);
  });

  test('reaching two leagues requires ADD cleanup', () => {
    const result = evaluateWaitlistCleanup(
      registrationContext({
        activeLeagueIds: [1, 2],
        existingWaitlistEntries: [{ waitlistId: 100, leagueId: 100, entryType: 'add', status: 'active' }],
      })
    );
    expectReason(result, 'add_waitlist_cleanup_required');
  });

  test('existing waitlist entries are keyed by waitlist, not league row', () => {
    const context = registrationContext({
      leagues: {
        200: league({ id: 200, sessionId: 10, waitlistId: 50, allowsWaitlist: true }),
        201: league({ id: 201, sessionId: 9, waitlistId: 50, allowsWaitlist: true }),
      },
      existingWaitlistEntries: [
        {
          waitlistId: 50,
          leagueId: 201,
          entryType: 'add',
          status: 'active',
        },
      ],
      selections: [selection({ selectionType: 'waitlist_add', leagueId: 200 })],
    });
    expect(validateRegistrationSelections(context).allowed).toBe(true);
  });

  test('third-league interest preserves ranking, has no limit, defers payment, and blocks BYOT', () => {
    const standardA = league({ id: 100, name: 'A' });
    const standardB = league({ id: 101, name: 'B' });
    const byot = league({ id: 102, name: 'BYOT', leagueType: 'bring_your_own_team' });
    const context = registrationContext({
      leagues: { 100: standardA, 101: standardB, 102: byot },
      selections: [
        selection({ selectionType: 'third_league_interest', leagueId: 101, rank: 2 }),
        selection({ selectionType: 'third_league_interest', leagueId: 100, rank: 1 }),
      ],
    });
    const result = validateRegistrationSelections(context);
    expect(result.rankedThirdLeagueInterest.map((item) => item.leagueId)).toEqual([100, 101]);
    expectReason(result, 'third_league_interest_defers_payment');

    const blocked = validateRegistrationSelections({
      ...context,
      selections: [selection({ selectionType: 'third_league_interest', leagueId: 102 })],
    });
    expectReason(blocked, 'byot_cannot_be_third_league');
  });

  test('skipped predecessor session loses guaranteed return rights', () => {
    const fall2026 = league({ predecessorLeagueId: 95 });
    const context = registrationContext({
      participatedLeagueIds: [90],
      leagues: { [fall2026.id]: fall2026 },
      selections: [selection({ selectionType: 'guaranteed_return', leagueId: fall2026.id })],
    });
    expectReason(validateRegistrationSelections(context), 'guaranteed_return_requires_predecessor_participation');
  });

  test('new members can request BYOT with teammates, BYOT cannot be third, and BYOT waitlists require a full roster', () => {
    const byot = league({ leagueType: 'bring_your_own_team', capacityType: 'team', allowsWaitlist: true, allowsSabbatical: false });
    const context = registrationContext({
      registrant: { memberId: 20, hasUserAccount: true, isReturningMember: false, dateOfBirth: '1990-01-01' },
      leagues: { [byot.id]: byot },
      selections: [selection({ selectionType: 'byot_request', byotTeammateText: 'A, B, C' })],
    });
    expect(validateRegistrationSelections(context).allowed).toBe(true);
    expectReason(validateRegistrationSelections({ ...context, selections: [selection({ selectionType: 'byot_request' })] }), 'byot_requires_teammates');
    expectReason(validateRegistrationSelections({ ...context, activeLeagueIds: [1, 2] }), 'byot_cannot_be_third_league');
    expectReason(
      validateRegistrationSelections({ ...context, selections: [selection({ selectionType: 'waitlist_add', byotTeammateText: 'A, B' })] }),
      'byot_waitlist_requires_full_roster'
    );
    expect(
      validateRegistrationSelections({
        ...context,
        selections: [selection({ selectionType: 'waitlist_add', byotTeammateText: 'A, B, C, D' })],
      }).allowed
    ).toBe(true);

    expect(
      validateRegistrationSelections({
        ...context,
        selections: [
          selection({
            selectionType: 'waitlist_add',
            teamRosterPlacements: [
              { memberId: 20, entryType: 'add' },
              { memberId: 21, entryType: 'add' },
              { memberId: 22, entryType: 'add' },
            ],
            byotTeammateText: 'Pending Teammate',
          }),
        ],
      }).allowed
    ).toBe(true);

    const playInLeague = league({
      leagueType: 'bring_your_own_team',
      capacityType: 'team',
      allowsWaitlist: false,
      allowsSabbatical: false,
      isPlayInBased: true,
    });
    const playInContext = registrationContext({
      registrant: { memberId: 20, hasUserAccount: true, isReturningMember: false, dateOfBirth: '1990-01-01' },
      leagues: { [playInLeague.id]: playInLeague },
      selections: [
        selection({
          leagueId: playInLeague.id,
          selectionType: 'play_in_request',
          teamRosterPlacements: [
            { memberId: 20, entryType: 'add' },
            { memberId: 21, entryType: 'add' },
            { memberId: 22, entryType: 'add' },
          ],
          byotTeammateText: 'Pending Teammate',
        }),
      ],
    });
    expect(validateRegistrationSelections(playInContext).allowed).toBe(true);

    expect(
      validateRegistrationSelections({
        ...playInContext,
        selections: [
          selection({
            leagueId: playInLeague.id,
            selectionType: 'play_in_request',
            byotTeammateText: 'Amy\nBob\nCara',
          }),
        ],
      }).allowed,
    ).toBe(true);
  });

  test('Junior Recreational blocks other leagues and spare-only', () => {
    const withLeague = validateRegistrationSelections(
      registrationContext({ membershipOption: 'junior_recreational', selections: [selection({ selectionType: 'return_subject_to_availability' })] })
    );
    expectReason(withLeague, 'junior_recreational_exclusive');

    const withSpareOnly = validateRegistrationSelections(
      registrationContext({ membershipOption: 'junior_recreational', selections: [selection({ selectionType: 'spare_only', leagueId: null })] })
    );
    expectReason(withSpareOnly, 'junior_recreational_exclusive');
  });

  test('Junior Recreational payment timing and JAC normal league fees are supported', () => {
    const junior = evaluateRegistrationDraft(registrationContext({ membershipOption: 'junior_recreational', selections: [] }));
    expect(junior.paymentDecision.outcome).toBe('immediate_payment');

    const assisted = evaluateRegistrationDraft(
      registrationContext({
        membershipOption: 'junior_recreational',
        selections: [],
        juniorAssistance: { requestedPercent: 50, status: 'pending' },
      })
    );
    expect(assisted.paymentDecision.outcome).toBe('deferred_payment');
    expectReason(assisted.paymentDecision, 'junior_financial_assistance_requires_review');

    const jacFees = calculateRegistrationFees(registrationContext({ selections: [selection({ selectionType: 'return_subject_to_availability' })] }));
    expect(jacFees.lineItems.map((item) => item.lineType)).toEqual(['regular_membership_fee']);
  });

  test('play-in ADD defers payment and same-fee REPLACE allows immediate payment', () => {
    const playInLeague = league({
      id: 110,
      isPlayInBased: true,
      allowsWaitlist: false,
      registrationFeeMinor: 30000,
    });
    const heldLeague = league({
      id: 111,
      name: 'Monday League',
      registrationFeeMinor: 30000,
    });
    const higherFeeLeague = league({
      id: 112,
      name: 'Wednesday League',
      registrationFeeMinor: 35000,
    });

    const addDraft = evaluateRegistrationDraft(
      registrationContext({
        leagues: { [playInLeague.id]: playInLeague },
        selections: [selection({ leagueId: playInLeague.id, selectionType: 'play_in_request' })],
      }),
    );
    expect(addDraft.paymentDecision.outcome).toBe('deferred_payment');
    expectReason(addDraft.paymentDecision, 'play_in_placement_pending');

    const sameFeeReplaceDraft = evaluateRegistrationDraft(
      registrationContext({
        leagues: { [playInLeague.id]: playInLeague, [heldLeague.id]: heldLeague },
        activeLeagueIds: [heldLeague.id],
        selections: [
          selection({
            leagueId: playInLeague.id,
            selectionType: 'play_in_request',
            replacesLeagueId: heldLeague.id,
          }),
        ],
      }),
    );
    expect(sameFeeReplaceDraft.paymentDecision.outcome).toBe('immediate_payment');

    const diffFeeReplaceDraft = evaluateRegistrationDraft(
      registrationContext({
        leagues: { [playInLeague.id]: playInLeague, [higherFeeLeague.id]: higherFeeLeague },
        activeLeagueIds: [higherFeeLeague.id],
        selections: [
          selection({
            leagueId: playInLeague.id,
            selectionType: 'play_in_request',
            replacesLeagueId: higherFeeLeague.id,
          }),
        ],
      }),
    );
    expect(diffFeeReplaceDraft.paymentDecision.outcome).toBe('deferred_payment');
    expectReason(diffFeeReplaceDraft.paymentDecision, 'play_in_placement_pending');
  });

  test('payment decision covers guaranteed, waitlist-only, non-guaranteed, sabbatical, and BYOT cases', () => {
    expect(evaluateRegistrationDraft(registrationContext()).paymentDecision.outcome).toBe('immediate_payment');

    const waitlistOnly = registrationContext({ membershipOption: 'none', selections: [selection({ selectionType: 'waitlist_add' })] });
    expect(evaluateRegistrationDraft(waitlistOnly).paymentDecision.outcome).toBe('no_payment_required');

    const nonGuaranteed = evaluateRegistrationDraft(
      registrationContext({ selections: [selection({ selectionType: 'return_subject_to_availability' })] })
    );
    expect(nonGuaranteed.paymentDecision.outcome).toBe('deferred_payment');
    expectReason(nonGuaranteed.paymentDecision, 'third_league_interest_defers_payment');

    expect(
      evaluateRegistrationDraft(registrationContext({ membershipOption: 'none', selections: [selection({ selectionType: 'sabbatical' })] }))
        .paymentDecision.outcome
    ).toBe('immediate_payment');

    const sabbaticalPlusWaitlist = evaluateRegistrationDraft(
      registrationContext({
        selections: [selection({ selectionType: 'sabbatical' }), selection({ selectionType: 'waitlist_add' })],
      })
    );
    expect(sabbaticalPlusWaitlist.paymentDecision.outcome).toBe('deferred_payment');
    expect(sabbaticalPlusWaitlist.paymentDecision.deferralReasons.length).toBeGreaterThan(0);

    const byotLeague = league({ leagueType: 'bring_your_own_team', capacityType: 'team', allowsWaitlist: false, allowsSabbatical: false });
    expect(
      evaluateRegistrationDraft(
        registrationContext({
          leagues: { [byotLeague.id]: byotLeague },
          selections: [selection({ selectionType: 'byot_request', byotTeammateText: 'A, B, C' })],
        })
      ).paymentDecision.outcome
    ).toBe('immediate_payment');
  });

  test('fee totals never go negative and discountable subtotals are separated', () => {
    const hugeDiscount = registrationContext({
      selections: [],
      discountClaims: { student: { claimed: true, institution: 'School' } },
      discountSettings: {
        student: { amountType: 'dollar', amountValue: 999999 },
        reciprocal: { amountType: 'dollar', amountValue: 0 },
        winterOnly: { amountType: 'dollar', amountValue: 0 },
      },
    });
    expect(calculateRegistrationFees(hugeDiscount).totalDueMinor).toBe(0);

    const mixed = calculateRegistrationFees(
      registrationContext({ selections: [selection({ selectionType: 'sabbatical' })], discountClaims: { student: { claimed: true, institution: 'School' } } })
    );
    expect(mixed.discountEligibleSubtotalMinor).toBe(10000);
    expect(mixed.nonDiscountableSubtotalMinor).toBe(5000);
  });

  test('payment decision can be called directly with returned fee totals', () => {
    const context = registrationContext({ selections: [] });
    const feePreview = calculateRegistrationFees(context);
    const decision = decideRegistrationPayment({ context, feePreview });
    expect(decision.totalDueMinor).toBe(10000);
    expect(decision.createStripeCheckoutNow).toBe(true);
  });

  test('multiple ADD waitlists require fulfillment count and priority ranks', () => {
    const friday = league({ id: 41, name: 'Friday' });
    const thursday = league({ id: 42, name: 'Thursday' });
    const context = registrationContext({
      activeLeagueIds: [],
      leagues: { [friday.id]: friday, [thursday.id]: thursday },
      selections: [
        selection({ selectionType: 'waitlist_add', leagueId: friday.id, rank: 1 }),
        selection({ selectionType: 'waitlist_add', leagueId: thursday.id, rank: 2 }),
      ],
      desiredAddWaitlistLeagueCount: null,
    });
    const missingCount = validateRegistrationSelections(context);
    expect(missingCount.allowed).toBe(false);
    expectReason(missingCount, 'waitlist_fulfillment_count_required');

    const valid = validateRegistrationSelections({
      ...context,
      desiredAddWaitlistLeagueCount: 1,
    });
    expect(valid.allowed).toBe(true);
  });

  test('Membership-only and basic ice curling registrations require immediate payment', () => {
    const regularOnly = evaluateRegistrationDraft(registrationContext({ selections: [] }));
    expect(regularOnly.paymentDecision.outcome).toBe('immediate_payment');
    expect(regularOnly.feePreview.lineItems.map((item) => item.lineType)).toEqual(['regular_membership_fee']);

    const socialOnly = evaluateRegistrationDraft(registrationContext({ membershipOption: 'social', selections: [] }));
    expect(socialOnly.paymentDecision.outcome).toBe('immediate_payment');
    expect(socialOnly.feePreview.lineItems.map((item) => item.lineType)).toEqual(['social_membership_fee']);

    const regularWithBasicIce = evaluateRegistrationDraft(
      registrationContext({ membershipOption: 'regular_spare_only', selections: [] })
    );
    expect(regularWithBasicIce.paymentDecision.outcome).toBe('immediate_payment');
    expect(regularWithBasicIce.feePreview.lineItems.map((item) => item.lineType)).toEqual([
      'regular_membership_fee',
      'spare_only_fee',
    ]);
  });
});
