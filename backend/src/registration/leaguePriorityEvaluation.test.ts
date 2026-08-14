import { describe, expect, test } from 'bun:test';
import {
  clampPriorityOrder,
  evaluateLeaguePriorities,
  guaranteeBudget,
  hasReturnRight,
  isPriorityOrderClamped,
  shouldCollectBasicIceFallback,
  validateLeaguePriorities,
  waitlistedPriorityEntries,
} from './leaguePriorityEvaluation.js';
import { labelPriorityEntries, type PriorityLabelCandidate } from './leaguePriorityRules.js';
import { league, priority, registrationContext, selection } from './registrationTestFixtures.js';
import type { LeagueConfig, PlayInEntryContext, RegistrationContext } from './registrationContext.js';

/**
 * Builds a context whose leagues are exactly the ones given, each with a prior
 * league the registrant played, so return rights are the default and each test
 * only has to state its own deviation.
 */
function contextWithLeagues(
  leagues: LeagueConfig[],
  overrides: Partial<RegistrationContext> = {},
): RegistrationContext {
  const leagueMap: Record<number, LeagueConfig> = {};
  const participatedLeagueIds: number[] = [];
  for (const config of leagues) {
    leagueMap[config.id] = config;
    if (config.predecessorLeagueId != null) {
      leagueMap[config.predecessorLeagueId] = league({
        id: config.predecessorLeagueId,
        name: `Prior ${config.name}`,
        sessionId: 9,
        predecessorLeagueId: null,
        successorLeagueId: config.id,
      });
      participatedLeagueIds.push(config.predecessorLeagueId);
    }
  }
  return registrationContext({
    leagues: leagueMap,
    participatedLeagueIds,
    priorities: leagues.map((config, index) => priority({ leagueId: config.id, priorityRank: index + 1 })),
    desiredLeagueCount: leagues.length,
    ...overrides,
  });
}

function standard(id: number, overrides: Partial<LeagueConfig> = {}): LeagueConfig {
  return league({
    id,
    name: `League ${id}`,
    predecessorLeagueId: id + 1000,
    registrationFeeMinor: 30000,
    ...overrides,
  });
}

function labelsFor(context: RegistrationContext): string[] {
  return evaluateLeaguePriorities(context).entries.map((entry) => entry.label);
}

function playInEntryContext(guaranteed: boolean, committedOtherMemberIds: number[] = []): PlayInEntryContext {
  return { onExistingTeam: false, committedOtherMemberIds, guaranteed };
}

describe('guarantee labeling', () => {
  test('a return right in the top two spots is a guaranteed return', () => {
    const context = contextWithLeagues([standard(1), standard(2)]);
    expect(labelsFor(context)).toEqual(['guaranteed_return', 'guaranteed_return']);
  });

  test('an unused guarantee is spent further down the list as a fallback', () => {
    // Rank 1 has no return right, so only one of the two protected claims is
    // spent in the first pass and the leftover reaches rank 3.
    const context = contextWithLeagues([
      standard(1, { predecessorLeagueId: null }),
      standard(2),
      standard(3),
    ]);
    expect(labelsFor(context)).toEqual(['waitlisted', 'guaranteed_return', 'guaranteed_fallback']);
  });

  test('both guarantees claimed at the top leaves extra leagues subject to availability', () => {
    const context = contextWithLeagues([standard(1), standard(2), standard(3)]);
    expect(labelsFor(context)).toEqual(['guaranteed_return', 'guaranteed_return', 'subject_to_availability']);
  });

  test('a league without a return right and without a waitlist is subject to availability', () => {
    const context = contextWithLeagues([
      standard(1, { predecessorLeagueId: null, allowsWaitlist: false }),
    ]);
    expect(labelsFor(context)).toEqual(['subject_to_availability']);
    expect(evaluateLeaguePriorities(context).guaranteedCount).toBe(0);
    expect(evaluateLeaguePriorities(context).confirmedLeagueFeeMinor).toBe(30000);
    expect(validateLeaguePriorities(context).deferralReasonCodes).toEqual([]);
  });

  test('a play-in league never receives a fallback guarantee', () => {
    const playIn = standard(3, {
      isPlayInBased: true,
      leagueType: 'bring_your_own_team',
      format: 'doubles',
      allowsWaitlist: false,
    });
    const context = contextWithLeagues([standard(1, { predecessorLeagueId: null }), standard(2), playIn], {
      priorities: [
        priority({ leagueId: 1, priorityRank: 1 }),
        priority({ leagueId: 2, priorityRank: 2 }),
        priority({
          leagueId: 3,
          priorityRank: 3,
          teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }],
        }),
      ],
      playInEntry: { 3: playInEntryContext(true) },
    });
    expect(labelsFor(context)).toEqual(['waitlisted', 'guaranteed_return', 'subject_to_availability']);
  });

  test('a play-in league in the top two is guaranteed when its team clears the bar', () => {
    const playIn = standard(1, {
      isPlayInBased: true,
      leagueType: 'bring_your_own_team',
      format: 'doubles',
      allowsWaitlist: false,
    });
    const context = contextWithLeagues([playIn], {
      priorities: [
        priority({
          leagueId: 1,
          priorityRank: 1,
          teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }],
        }),
      ],
      playInEntry: { 1: playInEntryContext(true) },
    });
    expect(labelsFor(context)).toEqual(['guaranteed_return']);
  });

  test('a play-in league with an incomplete team awaits roster entry', () => {
    const playIn = standard(1, {
      isPlayInBased: true,
      leagueType: 'bring_your_own_team',
      format: 'doubles',
      allowsWaitlist: false,
    });
    const context = contextWithLeagues([playIn], {
      priorities: [priority({ leagueId: 1, priorityRank: 1, teamRosterPlacements: [{ memberId: 20 }] })],
      playInEntry: { 1: playInEntryContext(true) },
    });
    expect(labelsFor(context)).toEqual(['awaiting_roster_entry']);
    expect(evaluateLeaguePriorities(context).guaranteedCount).toBe(0);
  });

  test('a play-in league whose team misses the bar is not guaranteed', () => {
    const playIn = standard(1, {
      isPlayInBased: true,
      leagueType: 'bring_your_own_team',
      format: 'doubles',
      allowsWaitlist: false,
    });
    const context = contextWithLeagues([playIn], {
      priorities: [
        priority({
          leagueId: 1,
          priorityRank: 1,
          teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }],
        }),
      ],
      playInEntry: { 1: playInEntryContext(false) },
    });
    expect(labelsFor(context)).toEqual(['subject_to_availability']);
  });

  test('a bring-your-own-team league is not guaranteed until its roster is full', () => {
    const byot = standard(1, { leagueType: 'bring_your_own_team', format: 'doubles' });
    const context = contextWithLeagues([byot], {
      priorities: [priority({ leagueId: 1, priorityRank: 1 })],
      returnEligibleMemberIdsByLeagueId: { 1: [20, 21] },
    });
    // Still a return right — just waiting on the declared team, not a waitlist.
    expect(labelsFor(context)).toEqual(['awaiting_roster_entry']);
    expect(evaluateLeaguePriorities(context).guaranteedCount).toBe(0);

    const withRoster = contextWithLeagues([byot], {
      priorities: [
        priority({ leagueId: 1, priorityRank: 1, teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }] }),
      ],
      returnEligibleMemberIdsByLeagueId: { 1: [20, 21] },
    });
    expect(labelsFor(withRoster)).toEqual(['guaranteed_return']);
  });

  test('a bring-your-own-team league is waitlisted when any teammate is not returning', () => {
    const byot = standard(1, { leagueType: 'bring_your_own_team', format: 'doubles' });
    const context = contextWithLeagues([byot], {
      priorities: [
        priority({ leagueId: 1, priorityRank: 1, teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }] }),
      ],
      // Only the registrant returns; teammate 21 is new.
      returnEligibleMemberIdsByLeagueId: { 1: [20] },
    });
    expect(labelsFor(context)).toEqual(['waitlisted']);
    expect(evaluateLeaguePriorities(context).guaranteedCount).toBe(0);
  });

  test('a free-text teammate name prevents a BYOT guaranteed return', () => {
    const byot = standard(1, { leagueType: 'bring_your_own_team', format: 'doubles' });
    const context = contextWithLeagues([byot], {
      priorities: [
        priority({
          leagueId: 1,
          priorityRank: 1,
          teamRosterPlacements: [{ memberId: 20 }],
          byotTeammateText: 'New Partner',
        }),
      ],
      returnEligibleMemberIdsByLeagueId: { 1: [20] },
    });
    expect(labelsFor(context)).toEqual(['waitlisted']);
  });

  test('return rights only apply during priority registration', () => {
    const context = contextWithLeagues([standard(1)], { registrationState: 'open' });
    expect(hasReturnRight(context, context.priorities[0]!)).toBe(false);
    expect(labelsFor(context)).toEqual(['waitlisted']);
  });

  test('a sabbatical right substitutes for prior participation', () => {
    const context = contextWithLeagues([standard(1)], {
      participatedLeagueIds: [],
      existingSabbaticals: [
        {
          id: 1,
          status: 'active',
          currentLeagueId: 1001,
          originalLeagueId: 1001,
          firstSabbaticalLeagueId: 1001,
          firstSabbaticalStartDate: '2026-01-15',
        },
      ],
    });
    expect(labelsFor(context)).toEqual(['guaranteed_return']);
  });
});

describe('guarantee budget', () => {
  test('wanting one league caps guarantees at one', () => {
    const context = contextWithLeagues([standard(1), standard(2)], { desiredLeagueCount: 1 });
    expect(guaranteeBudget(context)).toBe(1);
    expect(labelsFor(context)).toEqual(['guaranteed_return', 'superfluous']);
  });

  test('a sabbatical does not consume a guaranteed return spot', () => {
    const context = contextWithLeagues([standard(1), standard(2)], {
      selections: [selection({ selectionType: 'sabbatical', leagueId: 1002 })],
      desiredLeagueCount: 2,
    });
    expect(guaranteeBudget(context)).toBe(2);
    expect(evaluateLeaguePriorities(context).guaranteedCount).toBe(2);
  });

  test('two sabbaticals still leave the full guarantee budget', () => {
    const context = contextWithLeagues([standard(1), standard(2)], {
      selections: [
        selection({ selectionType: 'sabbatical', leagueId: 1001 }),
        selection({ selectionType: 'sabbatical', leagueId: 1002 }),
      ],
    });
    expect(guaranteeBudget(context)).toBe(2);
    expect(labelsFor(context)).toEqual(['guaranteed_return', 'guaranteed_return']);
  });
});

describe('fee range', () => {
  test('the floor is the guaranteed leagues and the ceiling adds the most expensive remaining ones', () => {
    const candidates: PriorityLabelCandidate[] = [
      {
        leagueId: 1,
        priorityRank: 1,
        hasReturnRight: true,
        rosterComplete: true,
        rosterAllReturning: true,
        feeMinor: 30000,
        allowsWaitlist: true,
        isPlayInBased: false,
      },
      {
        leagueId: 2,
        priorityRank: 2,
        hasReturnRight: false,
        rosterComplete: true,
        rosterAllReturning: true,
        feeMinor: 0,
        allowsWaitlist: true,
        isPlayInBased: false,
      },
      {
        leagueId: 3,
        priorityRank: 3,
        hasReturnRight: false,
        rosterComplete: true,
        rosterAllReturning: true,
        feeMinor: 45000,
        allowsWaitlist: true,
        isPlayInBased: false,
      },
    ];
    const result = labelPriorityEntries({ candidates, desiredLeagueCount: 2 });
    expect(result.confirmedLeagueFeeMinor).toBe(30000);
    // The $0 daytime league is ranked higher, but the ceiling has to assume the
    // more expensive league is the one that comes through.
    expect(result.maximumLeagueFeeMinor).toBe(75000);
  });

  test('a fully guaranteed list quotes a single amount', () => {
    const context = contextWithLeagues([standard(1), standard(2)], { desiredLeagueCount: 2 });
    const evaluation = evaluateLeaguePriorities(context);
    expect(evaluation.confirmedLeagueFeeMinor).toBe(60000);
    expect(evaluation.maximumLeagueFeeMinor).toBe(60000);
  });

  test('a subject-to-availability league is on the floor, not the ceiling', () => {
    const context = contextWithLeagues(
      [standard(1, { predecessorLeagueId: null, allowsWaitlist: false })],
      { desiredLeagueCount: 1 },
    );
    const evaluation = evaluateLeaguePriorities(context);
    expect(evaluation.confirmedLeagueFeeMinor).toBe(30000);
    expect(evaluation.maximumLeagueFeeMinor).toBe(30000);
  });

  test('a guaranteed league plus a subject-to-availability league quotes a single amount', () => {
    const context = contextWithLeagues(
      [
        standard(1),
        standard(2, { predecessorLeagueId: null, allowsWaitlist: false }),
      ],
      { desiredLeagueCount: 2 },
    );
    const evaluation = evaluateLeaguePriorities(context);
    expect(labelsFor(context)).toEqual(['guaranteed_return', 'subject_to_availability']);
    expect(evaluation.confirmedLeagueFeeMinor).toBe(60000);
    expect(evaluation.maximumLeagueFeeMinor).toBe(60000);
  });
});

describe('bring-your-own-team ordering', () => {
  const leagues = {
    1: standard(1),
    2: standard(2, { leagueType: 'bring_your_own_team', format: 'doubles' }),
    3: standard(3),
  };

  test('clamping lifts every team league above the standard ones', () => {
    const clamped = clampPriorityOrder(
      [
        priority({ leagueId: 1, priorityRank: 1 }),
        priority({ leagueId: 2, priorityRank: 2 }),
        priority({ leagueId: 3, priorityRank: 3 }),
      ],
      leagues,
    );
    expect(clamped.map((entry) => entry.leagueId)).toEqual([2, 1, 3]);
    expect(clamped.map((entry) => entry.priorityRank)).toEqual([1, 2, 3]);
  });

  test('clamping preserves relative order within each block', () => {
    const clamped = clampPriorityOrder(
      [
        priority({ leagueId: 3, priorityRank: 1 }),
        priority({ leagueId: 1, priorityRank: 2 }),
        priority({ leagueId: 2, priorityRank: 3 }),
      ],
      leagues,
    );
    expect(clamped.map((entry) => entry.leagueId)).toEqual([2, 3, 1]);
  });

  test('an order that already satisfies the clamp is reported as clamped', () => {
    expect(
      isPriorityOrderClamped(
        [priority({ leagueId: 2, priorityRank: 1 }), priority({ leagueId: 1, priorityRank: 2 })],
        leagues,
      ),
    ).toBe(true);
    expect(
      isPriorityOrderClamped(
        [priority({ leagueId: 1, priorityRank: 1 }), priority({ leagueId: 2, priorityRank: 2 })],
        leagues,
      ),
    ).toBe(false);
  });
});

describe('validation', () => {
  function expectBlocked(context: RegistrationContext, code: string) {
    const result = validateLeaguePriorities(context);
    expect(result.allowed).toBe(false);
    expect(result.blockingErrors.map((error) => String(error.code))).toContain(code);
  }

  test('a list shorter than the desired count is rejected', () => {
    expectBlocked(
      contextWithLeagues([standard(1)], { desiredLeagueCount: 3 }),
      'priority_list_too_short',
    );
  });

  test('a desired count outside 1 to 5 is rejected', () => {
    expectBlocked(
      contextWithLeagues([standard(1)], { desiredLeagueCount: 9 }),
      'desired_league_count_out_of_range',
    );
  });

  test('a list with a league twice is rejected', () => {
    expectBlocked(
      contextWithLeagues([standard(1), standard(2)], {
        priorities: [priority({ leagueId: 1, priorityRank: 1 }), priority({ leagueId: 1, priorityRank: 2 })],
      }),
      'priority_list_duplicate_league',
    );
  });

  test('ranks with a gap are rejected', () => {
    expectBlocked(
      contextWithLeagues([standard(1), standard(2)], {
        priorities: [priority({ leagueId: 1, priorityRank: 1 }), priority({ leagueId: 2, priorityRank: 3 })],
      }),
      'priority_rank_not_contiguous',
    );
  });

  test('a team league ranked below a standard league is rejected', () => {
    expectBlocked(
      contextWithLeagues([standard(1), standard(2, { leagueType: 'bring_your_own_team', format: 'doubles' })], {
        priorities: [
          priority({ leagueId: 1, priorityRank: 1 }),
          priority({
            leagueId: 2,
            priorityRank: 2,
            teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }],
          }),
        ],
      }),
      'byot_must_outrank_standard_leagues',
    );
  });

  test('a team league with an incomplete roster is rejected', () => {
    expectBlocked(
      contextWithLeagues([standard(1, { leagueType: 'bring_your_own_team', format: 'teams' })], {
        priorities: [
          priority({ leagueId: 1, priorityRank: 1, teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }] }),
        ],
      }),
      'byot_requires_full_roster',
    );
  });

  test('a play-in league with an empty roster asks for at least one person', () => {
    const context = contextWithLeagues(
      [standard(1, { isPlayInBased: true, leagueType: 'bring_your_own_team', format: 'teams', name: 'Tuesday League' })],
      {
        priorities: [priority({ leagueId: 1, priorityRank: 1 })],
        playInEntry: { 1: playInEntryContext(false) },
      },
    );
    const result = validateLeaguePriorities(context);
    expect(result.allowed).toBe(false);
    expect(result.blockingErrors.map((error) => String(error.code))).toContain(
      'byot_play_in_requires_minimum_roster',
    );
    expect(result.blockingErrors.map((error) => error.message)).toContain(
      'Include at least one person on your Tuesday League roster.',
    );
  });

  test('a play-in league with fewer than two players is rejected', () => {
    const context = contextWithLeagues(
      [standard(1, { isPlayInBased: true, leagueType: 'bring_your_own_team', format: 'teams', name: 'Tuesday League' })],
      {
        priorities: [priority({ leagueId: 1, priorityRank: 1, teamRosterPlacements: [{ memberId: 20 }] })],
        playInEntry: { 1: playInEntryContext(false) },
      },
    );
    const result = validateLeaguePriorities(context);
    expect(result.allowed).toBe(false);
    expect(result.blockingErrors.map((error) => String(error.code))).toContain(
      'byot_play_in_requires_minimum_roster',
    );
    expect(result.blockingErrors.map((error) => error.message)).toContain(
      'Tuesday League needs at least 2 players on the team to enter.',
    );
  });

  test('a play-in league accepts a partial team of two and fills the rest later', () => {
    const context = contextWithLeagues([
      standard(1, { isPlayInBased: true, leagueType: 'bring_your_own_team', format: 'teams' }),
    ], {
      priorities: [
        priority({ leagueId: 1, priorityRank: 1, teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }] }),
      ],
      playInEntry: { 1: playInEntryContext(false) },
    });
    expect(validateLeaguePriorities(context).allowed).toBe(true);
  });

  test('a teammate already on another declared team is rejected', () => {
    expectBlocked(
      contextWithLeagues([
        standard(1, { isPlayInBased: true, leagueType: 'bring_your_own_team', format: 'doubles' }),
      ], {
        priorities: [
          priority({ leagueId: 1, priorityRank: 1, teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }] }),
        ],
        playInEntry: { 1: playInEntryContext(false, [21]) },
      }),
      'play_in_teammate_already_committed',
    );
  });

  test('a prior league that is neither listed nor answered blocks submission', () => {
    expectBlocked(
      contextWithLeagues([standard(1), standard(2)], {
        priorities: [priority({ leagueId: 1, priorityRank: 1 })],
        desiredLeagueCount: 1,
      }),
      'prior_league_decision_required',
    );
  });

  test('a dropped prior league satisfies the decision requirement', () => {
    const context = contextWithLeagues([standard(1), standard(2)], {
      priorities: [priority({ leagueId: 1, priorityRank: 1 })],
      selections: [selection({ selectionType: 'drop', leagueId: 2 })],
      desiredLeagueCount: 1,
    });
    expect(validateLeaguePriorities(context).allowed).toBe(true);
  });

  test('a league on sabbatical cannot also be on the priority list', () => {
    expectBlocked(
      contextWithLeagues([standard(1)], {
        selections: [selection({ selectionType: 'sabbatical', leagueId: 1 })],
      }),
      'sabbatical_league_on_priority_list',
    );
  });

  test('more than two sabbatical selections are rejected', () => {
    expectBlocked(
      contextWithLeagues([standard(1), standard(2), standard(3)], {
        priorities: [],
        desiredLeagueCount: null,
        selections: [
          selection({ selectionType: 'sabbatical', leagueId: 1 }),
          selection({ selectionType: 'sabbatical', leagueId: 2 }),
          selection({ selectionType: 'sabbatical', leagueId: 3 }),
        ],
      }),
      'sabbatical_limit_exceeded',
    );
  });

  test('two sabbaticals and a drop with an empty priority list are allowed', () => {
    const context = contextWithLeagues([standard(1), standard(2), standard(3)], {
      membershipOption: 'none',
      priorities: [],
      desiredLeagueCount: null,
      selections: [
        selection({ selectionType: 'sabbatical', leagueId: 1 }),
        selection({ selectionType: 'sabbatical', leagueId: 2 }),
        selection({ selectionType: 'drop', leagueId: 3 }),
      ],
    });
    expect(validateLeaguePriorities(context).allowed).toBe(true);
  });

  test('sabbatical-only registration cannot keep a priority list', () => {
    expectBlocked(
      contextWithLeagues([standard(1), standard(2)], {
        membershipOption: 'none',
        priorities: [priority({ leagueId: 2, priorityRank: 1 })],
        desiredLeagueCount: 1,
        selections: [selection({ selectionType: 'sabbatical', leagueId: 1 })],
      }),
      'sabbatical_only_no_priority_list',
    );
  });

  test('social membership can take sabbaticals without a priority list', () => {
    const context = contextWithLeagues([standard(1), standard(2)], {
      membershipOption: 'social',
      priorities: [],
      desiredLeagueCount: null,
      selections: [
        selection({ selectionType: 'sabbatical', leagueId: 1 }),
        selection({ selectionType: 'drop', leagueId: 2 }),
      ],
    });
    expect(validateLeaguePriorities(context).allowed).toBe(true);
  });

  test('social membership can skip play by dropping prior-session leagues', () => {
    const context = contextWithLeagues([standard(1)], {
      membershipOption: 'social',
      priorities: [],
      desiredLeagueCount: null,
      selections: [selection({ selectionType: 'drop', leagueId: 1 })],
    });
    expect(validateLeaguePriorities(context).allowed).toBe(true);
  });

  test('social membership cannot keep a priority list', () => {
    expectBlocked(
      contextWithLeagues([standard(1), standard(2)], {
        membershipOption: 'social',
        priorities: [priority({ leagueId: 2, priorityRank: 1 })],
        desiredLeagueCount: 1,
        selections: [selection({ selectionType: 'sabbatical', leagueId: 1 })],
      }),
      'sabbatical_only_no_priority_list',
    );
  });
});

describe('derived downstream state', () => {
  test('non-guaranteed entries with a waitlist become waitlist entries until two spots are guaranteed', () => {
    const context = contextWithLeagues([
      standard(1, { predecessorLeagueId: null }),
      standard(2),
      standard(3),
    ]);
    const evaluation = evaluateLeaguePriorities(context);
    expect(waitlistedPriorityEntries(evaluation).map((entry) => entry.leagueId)).toEqual([1]);
  });

  test('extra leagues beyond two guarantees are not waitlisted', () => {
    const context = contextWithLeagues([standard(1), standard(2), standard(3), standard(4)]);
    const evaluation = evaluateLeaguePriorities(context);
    expect(waitlistedPriorityEntries(evaluation)).toEqual([]);
    expect(evaluation.entries.map((entry) => entry.label)).toEqual([
      'guaranteed_return',
      'guaranteed_return',
      'subject_to_availability',
      'subject_to_availability',
    ]);
  });

  test('leagues below an already-filled desired count are superfluous', () => {
    const context = contextWithLeagues([standard(1), standard(2), standard(3), standard(4)], {
      desiredLeagueCount: 2,
    });
    expect(labelsFor(context)).toEqual([
      'guaranteed_return',
      'guaranteed_return',
      'superfluous',
      'superfluous',
    ]);
    expect(validateLeaguePriorities(context).blockingErrors.map((error) => String(error.code))).toContain(
      'priority_list_has_superfluous_leagues',
    );
  });

  test('a switch-with-fallback list is not superfluous', () => {
    const context = contextWithLeagues([
      standard(1, { predecessorLeagueId: null }),
      standard(2),
      standard(3),
    ]);
    expect(labelsFor(context)).toEqual(['waitlisted', 'guaranteed_return', 'guaranteed_fallback']);
    expect(validateLeaguePriorities(context).allowed).toBe(true);
  });

  test('every waitlisted leftover defers payment', () => {
    const context = contextWithLeagues([
      standard(1, { predecessorLeagueId: null }),
      standard(2),
      standard(3),
    ]);
    expect(validateLeaguePriorities(context).deferralReasonCodes).toContain('waitlist_placement_pending');
  });

  test('a fully guaranteed list defers nothing', () => {
    const context = contextWithLeagues([standard(1), standard(2)], { desiredLeagueCount: 2 });
    expect(validateLeaguePriorities(context).deferralReasonCodes).toEqual([]);
  });

  test('a subject-to-availability list defers nothing', () => {
    const context = contextWithLeagues(
      [
        standard(1, { predecessorLeagueId: null, allowsWaitlist: false }),
        standard(2, { predecessorLeagueId: null, allowsWaitlist: false }),
      ],
      { desiredLeagueCount: 2 },
    );
    expect(validateLeaguePriorities(context).deferralReasonCodes).toEqual([]);
  });

  test('a play-in miss still defers payment', () => {
    const playIn = standard(1, {
      isPlayInBased: true,
      leagueType: 'bring_your_own_team',
      format: 'doubles',
      allowsWaitlist: false,
    });
    const context = contextWithLeagues([playIn], {
      priorities: [
        priority({
          leagueId: 1,
          priorityRank: 1,
          teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }],
        }),
      ],
      playInEntry: { 1: playInEntryContext(false) },
      desiredLeagueCount: 1,
    });
    expect(labelsFor(context)).toEqual(['subject_to_availability']);
    expect(validateLeaguePriorities(context).deferralReasonCodes).toContain('play_in_placement_pending');
    expect(evaluateLeaguePriorities(context).confirmedLeagueFeeMinor).toBe(0);
  });

  test('the basic ice fallback question appears only when nothing is billed as a league today', () => {
    expect(shouldCollectBasicIceFallback(contextWithLeagues([standard(1)]))).toBe(false);
    expect(
      shouldCollectBasicIceFallback(
        contextWithLeagues([standard(1, { predecessorLeagueId: null, allowsWaitlist: false })]),
      ),
    ).toBe(false);
    expect(
      shouldCollectBasicIceFallback(contextWithLeagues([standard(1, { predecessorLeagueId: null })])),
    ).toBe(true);
  });
});
