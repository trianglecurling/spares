import { describe, expect, test } from 'bun:test';
import { ageOnLeagueStart, calculateClubExperienceYears, totalExperienceYears } from './registrationAgeExperience.js';
import { evaluateRegistrationDraft } from './evaluateRegistrationDraft.js';
import { calculateRegistrationFees } from './registrationFeeCalculator.js';
import { validateLeagueEligibility, validateSpareOnlyEligibility, validateWaitlistEligibility } from './registrationEligibility.js';
import { validateLeaguePriorities } from './leaguePriorityEvaluation.js';
import { decideRegistrationPayment } from './registrationPaymentDecision.js';
import { evaluateGuaranteedReturnEligibility, evaluateSabbaticalEligibility } from './registrationReturningRights.js';
import { league, priority, registrationContext, selection } from './registrationTestFixtures.js';

function expectReason(result: { reasonCodes: string[] }, reasonCode: string): void {
  expect(result.reasonCodes).toContain(reasonCode);
}

/** Membership-only registration: no leagues wanted, so no league fees. */
function membershipOnly(overrides: Parameters<typeof registrationContext>[0] = {}) {
  return registrationContext({ selections: [], priorities: [], desiredLeagueCount: null, ...overrides });
}

describe('registration business logic', () => {
  test('closed registration blocks registration', () => {
    const context = registrationContext({ registrationState: 'closed' });
    const result = validateLeaguePriorities(context);
    expect(result.allowed).toBe(false);
    expectReason(result, 'registration_closed');
  });

  test('open registration allows a priority list but grants no guarantees', () => {
    const context = registrationContext({ registrationState: 'open' });
    const result = validateLeaguePriorities(context);
    expect(result.allowed).toBe(true);
    expect(result.evaluation.guaranteedCount).toBe(0);
  });

  test('priority registration grants the return guarantee', () => {
    const result = validateLeaguePriorities(registrationContext());
    expect(result.allowed).toBe(true);
    expect(result.evaluation.entries[0]?.label).toBe('guaranteed_return');
  });

  test('social membership has no ice privileges', () => {
    const context = registrationContext({ membershipOption: 'social' });
    const result = validateLeaguePriorities(context);
    expect(result.allowed).toBe(false);
    expectReason(result, 'social_membership_no_ice');
  });

  test('social membership is not discounted', () => {
    const fees = calculateRegistrationFees(
      membershipOnly({
        membershipOption: 'social',
        discountClaims: {
          student: { claimed: true, institution: 'NC State' },
          reciprocal: { claimed: true, clubName: 'Other Curling Club' },
          winterOnly: { claimed: true },
        },
        isFirstSessionOfSeason: false,
      }),
    );
    expect(fees.totalDueMinor).toBe(4000);
    expect(fees.discountLineItems).toHaveLength(0);
  });

  test('lifetime membership waives all registration fees', () => {
    const fees = calculateRegistrationFees(
      registrationContext({
        registrant: {
          memberId: 20,
          hasUserAccount: true,
          isReturningMember: true,
          dateOfBirth: '1990-01-01',
          hasLifetimeMembership: true,
        },
      }),
    );
    expect(fees.totalDueMinor).toBe(0);
    expect(fees.lineItems).toHaveLength(0);
  });

  test('lifetime membership still charges replacement name tags', () => {
    const fees = calculateRegistrationFees(
      registrationContext({
        registrant: {
          memberId: 20,
          hasUserAccount: true,
          isReturningMember: true,
          dateOfBirth: '1990-01-01',
          hasLifetimeMembership: true,
        },
        nameTagReplacementQuantity: 2,
      }),
    );
    expect(fees.lineItems.map((item) => item.lineType)).toEqual(['replacement_name_tag_fee']);
    expect(fees.lineItems[0]?.description).toBe('Replacement name tag (×2)');
    expect(fees.totalDueMinor).toBe(3000);
  });

  test('replacement name tags are billed by unit price times quantity', () => {
    const fees = calculateRegistrationFees(membershipOnly({ nameTagReplacementQuantity: 3 }));
    const nameTag = fees.lineItems.find((item) => item.lineType === 'replacement_name_tag_fee');
    expect(nameTag?.amountMinor).toBe(4500);
    expect(nameTag?.description).toBe('Replacement name tag (×3)');
    expect(nameTag?.discountEligible).toBe(false);
  });

  test('social-to-regular upgrade gets no credit and no discounts', () => {
    const fees = calculateRegistrationFees(
      membershipOnly({
        isSocialToRegularUpgrade: true,
        discountClaims: { student: { claimed: true, institution: 'UNC' } },
      }),
    );
    expect(fees.totalDueMinor).toBe(10000);
    expect(fees.discountLineItems).toHaveLength(0);
  });

  test('regular membership plus spare-only charges both fees', () => {
    const context = membershipOnly({
      membershipOption: 'regular_spare_only',
      selections: [selection({ selectionType: 'spare_only', leagueId: null })],
    });
    const fees = calculateRegistrationFees(context);
    expect(fees.lineItems.map((item) => item.lineType)).toEqual(['regular_membership_fee', 'spare_only_fee']);
    expect(fees.totalDueMinor).toBe(12500);
    expect(validateSpareOnlyEligibility(context).eligible).toBe(true);
  });

  test('league play with only fee-0 leagues silently charges the basic ice fee', () => {
    const freeLeague = league({ id: 200, name: 'Daytime League', registrationFeeMinor: 0, allowsWaitlist: false });
    const fees = calculateRegistrationFees(
      registrationContext({
        membershipOption: 'regular',
        leagues: { [freeLeague.id]: freeLeague, 90: league({ id: 90, predecessorLeagueId: null }) },
        participatedLeagueIds: [90],
        priorities: [priority({ leagueId: freeLeague.id })],
      }),
    );
    expect(fees.lineItems.map((item) => item.lineType)).toContain('spare_only_fee');
  });

  test('a guaranteed daytime league is billable immediately', () => {
    const daytimeLeague = league({
      id: 201,
      name: 'Tuesday Daytime',
      registrationFeeMinor: 0,
      allowsWaitlist: false,
      minExperienceYears: 0,
    });
    const context = registrationContext({
      membershipOption: 'regular',
      leagues: { [daytimeLeague.id]: daytimeLeague, 90: league({ id: 90, predecessorLeagueId: null }) },
      priorities: [priority({ leagueId: daytimeLeague.id })],
    });
    expect(validateLeaguePriorities(context).allowed).toBe(true);
    expect(evaluateRegistrationDraft(context).paymentDecision.outcome).toBe('immediate_payment');
  });

  test('league play with a paid league does not charge the basic ice fee', () => {
    const fees = calculateRegistrationFees(registrationContext({ membershipOption: 'regular' }));
    expect(fees.lineItems.map((item) => item.lineType)).not.toContain('spare_only_fee');
  });

  test('an available instructional program is billed as a league fee', () => {
    const instructional = league({
      id: 300,
      name: 'Saturday Instructional',
      format: 'instructional',
      allowsWaitlist: false,
      predecessorLeagueId: null,
      openSpotCount: 20,
      activeWaitlistEntryCount: 0,
      registrationFeeMinor: 15000,
    });
    const fees = calculateRegistrationFees(
      registrationContext({
        membershipOption: 'regular',
        experience: {
          type: 'none_or_minimal',
          selfReportedYears: null,
          baselineOtherClubExperienceYears: 0,
          baselineClubExperienceYears: 0,
          completedSessions: [],
        },
        leagues: { [instructional.id]: instructional },
        participatedLeagueIds: [],
        priorities: [priority({ leagueId: instructional.id, priorityRank: 1 })],
        desiredLeagueCount: 1,
      }),
    );
    expect(fees.lineItems.map((item) => item.lineType)).toEqual(['regular_membership_fee', 'league_fee']);
    expect(fees.lineItems.find((item) => item.lineType === 'league_fee')?.amountMinor).toBe(15000);
    expect(fees.lineItems.find((item) => item.lineType === 'league_fee')?.relatedLeagueId).toBe(300);
  });

  test('a full instructional program is not billed until placement', () => {
    const instructional = league({
      id: 300,
      name: 'Saturday Instructional',
      format: 'instructional',
      allowsWaitlist: false,
      predecessorLeagueId: null,
      openSpotCount: 0,
      activeWaitlistEntryCount: 0,
      registrationFeeMinor: 15000,
    });
    const fees = calculateRegistrationFees(
      registrationContext({
        membershipOption: 'regular',
        experience: {
          type: 'none_or_minimal',
          selfReportedYears: null,
          baselineOtherClubExperienceYears: 0,
          baselineClubExperienceYears: 0,
          completedSessions: [],
        },
        leagues: { [instructional.id]: instructional },
        participatedLeagueIds: [],
        priorities: [priority({ leagueId: instructional.id, priorityRank: 1 })],
        desiredLeagueCount: 1,
      }),
    );
    expect(fees.lineItems.map((item) => item.lineType)).toEqual(['regular_membership_fee']);
    expect(fees.estimatedMaximumTotalDueMinor).toBeGreaterThan(fees.totalDueMinor);
  });

  test('social membership cannot include spare-only basic ice privileges', () => {
    const result = validateSpareOnlyEligibility(membershipOnly({ membershipOption: 'social' }));
    expect(result.eligible).toBe(false);
    expectReason(result, 'spare_only_requires_regular_membership');
  });

  test('student discount requires institution and auto-applies with institution', () => {
    const invalid = calculateRegistrationFees(membershipOnly({ discountClaims: { student: { claimed: true } } }));
    expect(invalid.blockingErrors.map((error) => error.code)).toContain('student_discount_requires_institution');

    const valid = calculateRegistrationFees(
      membershipOnly({ discountClaims: { student: { claimed: true, institution: 'Duke' } } }),
    );
    expect(valid.discountLineItems[0]?.lineType).toBe('student_discount');
    expect(valid.totalDueMinor).toBe(9000);
  });

  test('reciprocal discount requires club and auto-applies with club', () => {
    const invalid = calculateRegistrationFees(membershipOnly({ discountClaims: { reciprocal: { claimed: true } } }));
    expect(invalid.blockingErrors.map((error) => error.code)).toContain('reciprocal_discount_requires_club');

    const valid = calculateRegistrationFees(
      membershipOnly({ discountClaims: { reciprocal: { claimed: true, clubName: 'Charlotte' } } }),
    );
    expect(valid.discountLineItems[0]?.lineType).toBe('reciprocal_discount');
    expect(valid.totalDueMinor).toBe(9000);
  });

  test('winter-only discount applies after the first session and not during the first session', () => {
    const winter = calculateRegistrationFees(membershipOnly({ isFirstSessionOfSeason: false }));
    expect(winter.discountLineItems[0]?.lineType).toBe('winter_only_discount');
    expect(winter.totalDueMinor).toBe(7500);

    const fall = calculateRegistrationFees(membershipOnly({ isFirstSessionOfSeason: true }));
    expect(fall.discountLineItems).toHaveLength(0);
    expect(fall.totalDueMinor).toBe(10000);
  });

  test('winter-only discount applies after any first session and only to regular membership dues', () => {
    const thirdSession = calculateRegistrationFees(
      membershipOnly({ membershipOption: 'regular_spare_only', isFirstSessionOfSeason: false }),
    );
    expect(thirdSession.discountLineItems[0]?.lineType).toBe('winter_only_discount');
    expect(thirdSession.discountLineItems[0]?.amountMinor).toBe(-2500);
    expect(thirdSession.totalDueMinor).toBe(10000);

    const social = calculateRegistrationFees(
      membershipOnly({ membershipOption: 'social', isFirstSessionOfSeason: false }),
    );
    expect(social.discountLineItems).toHaveLength(0);
    expect(social.totalDueMinor).toBe(4000);
  });

  test('open registration temporary fill discounts the league by the sabbatical fee', () => {
    const fees = calculateRegistrationFees(
      registrationContext({
        registrationState: 'open',
        leagues: {
          100: league({
            id: 100,
            predecessorLeagueId: null,
            openSpotCount: 0,
            activeWaitlistEntryCount: 3,
            temporarySabbaticalFillVacancyCount: 1,
          }),
        },
        participatedLeagueIds: [],
        priorities: [priority({ leagueId: 100 })],
        desiredLeagueCount: 1,
      }),
    );
    expect(fees.lineItems.find((item) => item.lineType === 'league_fee')?.amountMinor).toBe(30000);
    expect(fees.discountLineItems.find((item) => item.lineType === 'sabbatical_fill_discount')?.amountMinor).toBe(-5000);
    expect(fees.totalDueMinor).toBe(35000);
  });

  test('dollar discounts apply to membership and not to league fees', () => {
    const fees = calculateRegistrationFees(
      registrationContext({
        discountClaims: { student: { claimed: true, institution: 'NCSU' } },
        discountSettings: {
          student: { amountType: 'dollar', amountValue: 15000 },
          reciprocal: { amountType: 'percent', amountValue: 0 },
          winterOnly: { amountType: 'dollar', amountValue: 0 },
        },
      }),
    );
    expect(fees.lineItems.find((item) => item.lineType === 'regular_membership_fee')?.amountMinor).toBe(10000);
    expect(fees.lineItems.find((item) => item.lineType === 'league_fee')?.amountMinor).toBe(30000);
    expect(fees.discountLineItems.find((item) => item.lineType === 'student_discount')?.amountMinor).toBe(-10000);
    expect(fees.discountLineItems.find((item) => item.lineType === 'student_league_discount')).toBeUndefined();
    expect(fees.totalDueMinor).toBe(30000);
  });

  test('percent student discount is sent as separate membership and league lines', () => {
    const fees = calculateRegistrationFees(
      registrationContext({
        discountClaims: { student: { claimed: true, institution: 'NCSU' } },
        discountSettings: {
          student: { amountType: 'percent', amountValue: 10 },
          reciprocal: { amountType: 'percent', amountValue: 0 },
          winterOnly: { amountType: 'dollar', amountValue: 0 },
        },
      }),
    );
    expect(fees.discountLineItems.find((item) => item.lineType === 'student_discount')?.amountMinor).toBe(-1000);
    expect(fees.discountLineItems.find((item) => item.lineType === 'student_league_discount')?.amountMinor).toBe(-3000);
    expect(fees.totalDueMinor).toBe(36000);
  });

  test('dollar discounts apply before percentage discounts', () => {
    const fees = calculateRegistrationFees(
      membershipOnly({
        discountClaims: {
          student: { claimed: true, institution: 'Wake Tech' },
          reciprocal: { claimed: true, clubName: 'Other Club' },
        },
      }),
    );
    expect(fees.discountTotalMinor).toBe(1900);
    expect(fees.totalDueMinor).toBe(8100);
  });

  test('sabbatical fee is not discounted and sabbatical-fill discount equals the sabbatical fee', () => {
    const fees = calculateRegistrationFees(
      registrationContext({
        priorities: [],
        desiredLeagueCount: null,
        selections: [selection({ selectionType: 'sabbatical', isTemporarySabbaticalFill: true })],
        discountClaims: { student: { claimed: true, institution: 'NCSU' } },
      }),
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
    const noExperience = registrationContext({
      experience: {
        type: 'none_or_minimal',
        baselineOtherClubExperienceYears: 0,
        baselineClubExperienceYears: 0,
        completedSessions: [],
      },
    });
    expect(
      validateLeagueEligibility(noExperience, league({ format: 'instructional', minExperienceYears: 0 })).eligible,
    ).toBe(true);
    expectReason(
      validateLeagueEligibility(noExperience, league({ format: 'teams', minExperienceYears: 1 })),
      'insufficient_experience',
    );
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

  test('guaranteed return is unavailable outside priority and skipped predecessor loses guarantee', () => {
    const open = evaluateGuaranteedReturnEligibility(registrationContext({ registrationState: 'open' }), league());
    expectReason(open, 'not_priority_registration');

    const skipped = evaluateGuaranteedReturnEligibility(
      registrationContext({ participatedLeagueIds: [80] }),
      league({ predecessorLeagueId: 90 })
    );
    expectReason(skipped, 'guaranteed_return_requires_predecessor_participation');
  });

  test('sabbatical requires a return right', () => {
    const noReturn = evaluateSabbaticalEligibility(registrationContext({ participatedLeagueIds: [] }), league());
    expectReason(noReturn, 'sabbatical_requires_return_right');
  });

  test('sabbatical-only does not require regular membership', () => {
    const fees = calculateRegistrationFees(
      registrationContext({
        membershipOption: 'none',
        priorities: [],
        desiredLeagueCount: null,
        selections: [selection({ selectionType: 'sabbatical' })],
      }),
    );
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
    const context = membershipOnly({ membershipOption: 'none', activeLeagueIds: [] });
    expect(validateWaitlistEligibility(context, league()).eligible).toBe(true);

    const tooYoung = validateWaitlistEligibility(
      membershipOnly({
        membershipOption: 'none',
        registrant: { memberId: 20, hasUserAccount: true, isReturningMember: false, dateOfBirth: '2020-01-01' },
      }),
      league({ minAge: 18 })
    );
    expectReason(tooYoung, 'under_minimum_age');
  });

  test('a league outside the registration session cannot be prioritized', () => {
    expectReason(
      validateLeaguePriorities(registrationContext({ leagues: { 100: league({ sessionId: 999 }) } })),
      'league_not_in_registration_session',
    );
  });

  test('skipped predecessor session loses guaranteed return rights', () => {
    const fall2026 = league({ predecessorLeagueId: 95 });
    const context = registrationContext({
      participatedLeagueIds: [90],
      leagues: { [fall2026.id]: fall2026, 90: league({ id: 90, predecessorLeagueId: null }) },
    });
    // Rank 1 is still allowed on the list, it is just not guaranteed.
    expect(validateLeaguePriorities(context).evaluation.entries[0]?.label).toBe('waitlisted');
  });

  test('Junior Recreational blocks other leagues and spare-only', () => {
    const withLeague = validateLeaguePriorities(
      registrationContext({
        membershipOption: 'junior_recreational',
        selections: [selection({ selectionType: 'junior_recreational', leagueId: null })],
      }),
    );
    expectReason(withLeague, 'junior_recreational_exclusive');

    const withSpareOnly = validateLeaguePriorities(
      membershipOnly({
        membershipOption: 'junior_recreational',
        selections: [
          selection({ selectionType: 'junior_recreational', leagueId: null }),
          selection({ selectionType: 'spare_only', leagueId: null }),
        ],
      }),
    );
    expectReason(withSpareOnly, 'junior_recreational_exclusive');
  });

  test('Junior Recreational ignores standard discounts at checkout', () => {
    const fees = calculateRegistrationFees(
      membershipOnly({
        membershipOption: 'junior_recreational',
        discountClaims: {
          student: { claimed: true, institution: 'UNC' },
          reciprocal: { claimed: true, clubName: 'Charlotte' },
        },
      }),
    );
    expect(fees.blockingErrors).toHaveLength(0);
    expect(fees.discountLineItems.filter((item) => item.lineType !== 'financial_assistance_discount')).toHaveLength(0);
    expect(fees.lineItems.map((item) => item.lineType)).toEqual(['junior_recreational_fee']);
    expect(fees.totalDueMinor).toBe(7500);
  });

  test('Junior Recreational program fee is not combined with that league’s registration fee', () => {
    const juniorLeague = league({
      id: 9,
      name: 'Junior Recreational',
      isJuniorRecreational: true,
      registrationFeeMinor: 10000,
      predecessorLeagueId: null,
    });
    const fees = calculateRegistrationFees(
      membershipOnly({
        membershipOption: 'junior_recreational',
        leagues: { 9: juniorLeague },
      }),
      { chargedLeagueIds: [9] },
    );
    expect(fees.lineItems.map((item) => item.lineType)).toEqual(['junior_recreational_fee']);
    expect(fees.totalDueMinor).toBe(7500);
  });

  test('Junior Recreational payment timing supports financial assistance review', () => {
    const junior = evaluateRegistrationDraft(membershipOnly({ membershipOption: 'junior_recreational' }));
    expect(junior.priorityValidation.allowed).toBe(true);
    expect(junior.paymentDecision.outcome).toBe('immediate_payment');

    const assisted = evaluateRegistrationDraft(
      membershipOnly({
        membershipOption: 'junior_recreational',
        juniorAssistance: { requestedPercent: 50, status: 'pending' },
      }),
    );
    expect(assisted.paymentDecision.outcome).toBe('deferred_payment');
    expectReason(assisted.paymentDecision, 'junior_financial_assistance_requires_review');
  });

  test('payment is immediate when every wanted league is guaranteed and deferred otherwise', () => {
    expect(evaluateRegistrationDraft(registrationContext()).paymentDecision.outcome).toBe('immediate_payment');

    const wantsMoreThanGuaranteed = registrationContext({
      leagues: {
        100: league({ id: 100, predecessorLeagueId: 90 }),
        101: league({ id: 101, predecessorLeagueId: null }),
        90: league({ id: 90, predecessorLeagueId: null }),
      },
      priorities: [priority({ leagueId: 100, priorityRank: 1 }), priority({ leagueId: 101, priorityRank: 2 })],
      desiredLeagueCount: 2,
    });
    const deferred = evaluateRegistrationDraft(wantsMoreThanGuaranteed);
    expect(deferred.paymentDecision.outcome).toBe('deferred_payment');
    expectReason(deferred.paymentDecision, 'waitlist_placement_pending');
  });

  test('a subject-to-availability league defers payment until placement is confirmed', () => {
    const context = registrationContext({
      leagues: { 100: league({ id: 100, predecessorLeagueId: null, allowsWaitlist: false }) },
      participatedLeagueIds: [],
      priorities: [priority({ leagueId: 100 })],
      desiredLeagueCount: 1,
    });
    const draft = evaluateRegistrationDraft(context);
    expect(draft.paymentDecision.outcome).toBe('deferred_payment');
    expectReason(draft.paymentDecision, 'non_guaranteed_league_defers_payment');
    expect(draft.feePreview.lineItems.map((item) => item.lineType)).toEqual(['regular_membership_fee']);
    expect(draft.feePreview.totalDueMinor).toBe(10000);
    expect(draft.feePreview.estimatedMaximumTotalDueMinor).toBe(40000);
  });

  test('two guaranteed returns plus a third subject-to-availability league defers payment', () => {
    const context = registrationContext({
      leagues: {
        100: league({ id: 100, predecessorLeagueId: 90 }),
        101: league({ id: 101, predecessorLeagueId: 91 }),
        102: league({ id: 102, predecessorLeagueId: null, allowsWaitlist: false }),
        90: league({ id: 90, predecessorLeagueId: null }),
        91: league({ id: 91, predecessorLeagueId: null }),
      },
      participatedLeagueIds: [90, 91],
      priorities: [
        priority({ leagueId: 100, priorityRank: 1 }),
        priority({ leagueId: 101, priorityRank: 2 }),
        priority({ leagueId: 102, priorityRank: 3 }),
      ],
      desiredLeagueCount: 3,
    });
    const draft = evaluateRegistrationDraft(context);
    expect(draft.priorityValidation.evaluation.entries.map((entry) => entry.label)).toEqual([
      'guaranteed_return',
      'guaranteed_return',
      'subject_to_availability',
    ]);
    expect(draft.paymentDecision.outcome).toBe('deferred_payment');
    expectReason(draft.paymentDecision, 'non_guaranteed_league_defers_payment');
    expect(draft.feePreview.lineItems.map((item) => item.lineType)).toEqual([
      'regular_membership_fee',
      'league_fee',
      'league_fee',
    ]);
    expect(draft.feePreview.totalDueMinor).toBe(70000);
    expect(draft.feePreview.estimatedMaximumTotalDueMinor).toBe(100000);
  });

  test('a waitlist-only registration owes nothing today but quotes what a placement would cost', () => {
    const context = registrationContext({
      membershipOption: 'none',
      leagues: { 100: league({ id: 100, predecessorLeagueId: null }) },
      participatedLeagueIds: [],
      priorities: [priority({ leagueId: 100 })],
    });
    const decision = evaluateRegistrationDraft(context).paymentDecision;
    expect(decision.outcome).toBe('deferred_payment');
    expect(decision.estimatedMinimumDueMinor).toBe(0);
    expect(decision.estimatedMaximumDueMinor).toBe(30000);
  });

  test('a registration with nothing billable requires no payment', () => {
    const context = membershipOnly({ membershipOption: 'none' });
    expect(evaluateRegistrationDraft(context).paymentDecision.outcome).toBe('no_payment_required');
  });

  test('a sabbatical alone is billed immediately', () => {
    const context = registrationContext({
      membershipOption: 'none',
      priorities: [],
      desiredLeagueCount: null,
      selections: [selection({ selectionType: 'sabbatical' })],
    });
    expect(evaluateRegistrationDraft(context).paymentDecision.outcome).toBe('immediate_payment');
  });

  test('fee totals never go negative and discountable subtotals are separated', () => {
    const hugeDiscount = membershipOnly({
      discountClaims: { student: { claimed: true, institution: 'School' } },
      discountSettings: {
        student: { amountType: 'dollar', amountValue: 999999 },
        reciprocal: { amountType: 'dollar', amountValue: 0 },
        winterOnly: { amountType: 'dollar', amountValue: 0 },
      },
    });
    expect(calculateRegistrationFees(hugeDiscount).totalDueMinor).toBe(0);

    const mixed = calculateRegistrationFees(
      membershipOnly({
        selections: [selection({ selectionType: 'sabbatical' })],
        discountClaims: { student: { claimed: true, institution: 'School' } },
      }),
    );
    expect(mixed.discountEligibleSubtotalMinor).toBe(10000);
    expect(mixed.nonDiscountableSubtotalMinor).toBe(5000);
  });

  test('payment decision can be called directly with returned fee totals', () => {
    const context = membershipOnly();
    const feePreview = calculateRegistrationFees(context);
    const decision = decideRegistrationPayment({ context, feePreview });
    expect(decision.totalDueMinor).toBe(10000);
    expect(decision.createStripeCheckoutNow).toBe(true);
  });

  test('membership-only and basic ice registrations require immediate payment', () => {
    const regularOnly = evaluateRegistrationDraft(membershipOnly());
    expect(regularOnly.paymentDecision.outcome).toBe('immediate_payment');
    expect(regularOnly.feePreview.lineItems.map((item) => item.lineType)).toEqual(['regular_membership_fee']);

    const socialOnly = evaluateRegistrationDraft(membershipOnly({ membershipOption: 'social' }));
    expect(socialOnly.paymentDecision.outcome).toBe('immediate_payment');
    expect(socialOnly.feePreview.lineItems.map((item) => item.lineType)).toEqual(['social_membership_fee']);

    const regularWithBasicIce = evaluateRegistrationDraft(membershipOnly({ membershipOption: 'regular_spare_only' }));
    expect(regularWithBasicIce.paymentDecision.outcome).toBe('immediate_payment');
    expect(regularWithBasicIce.feePreview.lineItems.map((item) => item.lineType)).toEqual([
      'regular_membership_fee',
      'spare_only_fee',
    ]);
  });
});
