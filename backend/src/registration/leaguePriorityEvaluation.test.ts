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
import {
  labelPriorityEntries,
  leagueHasTemporaryFillVacancy,
  leagueHasVacancies,
  leaguePriorityGuaranteeLabelText,
  omitLeaveBehindDecisionsForListedLeagues,
  omitLeaveBehindSelectionsForListedLeagues,
  playInDraftJoinsIncompleteTeam,
  type PriorityLabelCandidate,
} from './leaguePriorityRules.js';
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

function playInEntryContext(
  guaranteed: boolean,
  committedOtherMemberIds: number[] = [],
  extras: Partial<PlayInEntryContext> = {},
): PlayInEntryContext {
  return { onExistingTeam: false, committedOtherMemberIds, guaranteed, ...extras };
}

function committedTeam(
  teamId: number,
  memberIds: number[],
): PlayInEntryContext['committedOtherMemberTeams'] {
  const members = memberIds.map((memberId) => ({
    memberId,
    memberName: `Member ${memberId}`,
    pendingName: null,
  }));
  const team = { id: teamId, name: null, members };
  return memberIds.map((memberId) => ({ memberId, team }));
}

describe('play-in join of incomplete teams', () => {
  test('covers every account-linked member and still has an open slot', () => {
    expect(
      playInDraftJoinsIncompleteTeam({
        teamSize: 4,
        teamMemberCount: 3,
        teamMemberIds: [21, 22, 23],
        draftMemberIds: [20, 21, 22, 23],
      }),
    ).toBe(true);
  });

  test('rejects a full team even when the draft names every member', () => {
    expect(
      playInDraftJoinsIncompleteTeam({
        teamSize: 4,
        teamMemberCount: 4,
        teamMemberIds: [21, 22, 23, 24],
        draftMemberIds: [20, 21, 22, 23, 24],
      }),
    ).toBe(false);
  });

  test('rejects a draft that omits an existing teammate', () => {
    expect(
      playInDraftJoinsIncompleteTeam({
        teamSize: 4,
        teamMemberCount: 3,
        teamMemberIds: [21, 22, 23],
        draftMemberIds: [20, 21],
      }),
    ).toBe(false);
  });
});

describe('league vacancies', () => {
  test('a league has vacancies only when the waitlist is shorter than open spots', () => {
    expect(leagueHasVacancies({ openSpotCount: 4, activeWaitlistEntryCount: 3 })).toBe(true);
    expect(leagueHasVacancies({ openSpotCount: 4, activeWaitlistEntryCount: 4 })).toBe(false);
    expect(leagueHasVacancies({ openSpotCount: 0, activeWaitlistEntryCount: 0 })).toBe(false);
    expect(leagueHasVacancies({})).toBe(false);
  });

  test('a league has a temporary fill vacancy when at least one sabbatical spot is unfilled', () => {
    expect(leagueHasTemporaryFillVacancy({ temporarySabbaticalFillVacancyCount: 1 })).toBe(true);
    expect(leagueHasTemporaryFillVacancy({ temporarySabbaticalFillVacancyCount: 0 })).toBe(false);
    expect(leagueHasTemporaryFillVacancy({})).toBe(false);
  });
});

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
    expect(evaluateLeaguePriorities(context).confirmedLeagueFeeMinor).toBe(0);
    expect(evaluateLeaguePriorities(context).maximumLeagueFeeMinor).toBe(30000);
    expect(validateLeaguePriorities(context).deferralReasonCodes).toContain('non_guaranteed_league_defers_payment');
  });

  test('an instructional program with remaining space is available and billed now', () => {
    const context = contextWithLeagues([
      standard(1, {
        format: 'instructional',
        predecessorLeagueId: null,
        allowsWaitlist: false,
        openSpotCount: 12,
        activeWaitlistEntryCount: 0,
      }),
    ]);
    expect(labelsFor(context)).toEqual(['available']);
    expect(evaluateLeaguePriorities(context).confirmedLeagueFeeMinor).toBe(30000);
    expect(validateLeaguePriorities(context).deferralReasonCodes).toEqual([]);
  });

  test('a full instructional program is subject to availability and defers payment', () => {
    const context = contextWithLeagues([
      standard(1, {
        format: 'instructional',
        predecessorLeagueId: null,
        allowsWaitlist: false,
        openSpotCount: 0,
        activeWaitlistEntryCount: 0,
      }),
    ]);
    expect(labelsFor(context)).toEqual(['subject_to_availability']);
    expect(evaluateLeaguePriorities(context).confirmedLeagueFeeMinor).toBe(0);
    expect(validateLeaguePriorities(context).deferralReasonCodes).toContain('non_guaranteed_league_defers_payment');
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
    expect(leaguePriorityGuaranteeLabelText('guaranteed_return', playIn)).toBe('Guaranteed entry');
    expect(leaguePriorityGuaranteeLabelText('guaranteed_return')).toBe('Guaranteed return');
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

  test('an incomplete play-in roster does not make later leagues superfluous', () => {
    const playIn = standard(1, {
      isPlayInBased: true,
      leagueType: 'bring_your_own_team',
      format: 'teams',
      allowsWaitlist: false,
    });
    const context = contextWithLeagues([playIn, standard(2)], {
      priorities: [
        priority({
          leagueId: 1,
          priorityRank: 1,
          teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }],
        }),
        priority({ leagueId: 2, priorityRank: 2 }),
      ],
      desiredLeagueCount: 1,
      playInEntry: { 1: playInEntryContext(true) },
    });
    expect(labelsFor(context)).toEqual(['awaiting_roster_entry', 'guaranteed_return']);
    expect(evaluateLeaguePriorities(context).guaranteedCount).toBe(1);
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

    const withBackup = contextWithLeagues([byot, standard(2)], {
      priorities: [
        priority({ leagueId: 1, priorityRank: 1 }),
        priority({ leagueId: 2, priorityRank: 2 }),
      ],
      desiredLeagueCount: 1,
      returnEligibleMemberIdsByLeagueId: { 1: [20, 21] },
    });
    expect(labelsFor(withBackup)).toEqual(['awaiting_roster_entry', 'guaranteed_return']);

    const withRoster = contextWithLeagues([byot], {
      priorities: [
        priority({ leagueId: 1, priorityRank: 1, teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }] }),
      ],
      returnEligibleMemberIdsByLeagueId: { 1: [20, 21] },
    });
    expect(labelsFor(withRoster)).toEqual(['guaranteed_return']);
  });

  test('a registrant listed on a returning doubles pair is guaranteed even with an empty local roster', () => {
    const byot = standard(1, { leagueType: 'bring_your_own_team', format: 'doubles' });
    const context = contextWithLeagues([byot], {
      priorities: [priority({ leagueId: 1, priorityRank: 1 })],
      returnEligibleMemberIdsByLeagueId: { 1: [20, 21] },
      byotEntry: {
        1: {
          onExistingTeam: true,
          existingTeamMemberIds: [20, 21],
          committedOtherMemberIds: [],
        },
      },
    });
    expect(labelsFor(context)).toEqual(['guaranteed_return']);
    expect(evaluateLeaguePriorities(context).guaranteedCount).toBe(1);
  });

  test('a listed doubles teammate with the partner as free-text is still guaranteed from the existing pair', () => {
    const byot = standard(1, { leagueType: 'bring_your_own_team', format: 'doubles' });
    const context = contextWithLeagues([byot], {
      priorities: [
        priority({
          leagueId: 1,
          priorityRank: 1,
          teamRosterPlacements: [],
          byotTeammateText: 'Mike Hartman',
        }),
      ],
      returnEligibleMemberIdsByLeagueId: { 1: [20, 21] },
      byotEntry: {
        1: {
          onExistingTeam: true,
          existingTeamMemberIds: [20, 21],
          committedOtherMemberIds: [],
        },
      },
    });
    expect(labelsFor(context)).toEqual(['guaranteed_return']);
  });

  test('a listed doubles teammate is waitlisted when the existing pair is not all returning', () => {
    const byot = standard(1, { leagueType: 'bring_your_own_team', format: 'doubles' });
    const context = contextWithLeagues([byot], {
      priorities: [priority({ leagueId: 1, priorityRank: 1 })],
      returnEligibleMemberIdsByLeagueId: { 1: [20] },
      byotEntry: {
        1: {
          onExistingTeam: true,
          existingTeamMemberIds: [20, 21],
          committedOtherMemberIds: [],
        },
      },
    });
    expect(labelsFor(context)).toEqual(['waitlisted']);
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
    expect(labelsFor(context)).toEqual(['subject_to_availability']);
  });

  test('open registration labels vacant leagues subject to availability instead of available', () => {
    const context = contextWithLeagues(
      [
        standard(1, { openSpotCount: 4, activeWaitlistEntryCount: 1 }),
        standard(2, { openSpotCount: 2, activeWaitlistEntryCount: 0 }),
      ],
      { registrationState: 'open', desiredLeagueCount: 2 },
    );
    expect(labelsFor(context)).toEqual(['subject_to_availability', 'subject_to_availability']);
    expect(evaluateLeaguePriorities(context).guaranteedCount).toBe(0);
    expect(evaluateLeaguePriorities(context).confirmedLeagueFeeMinor).toBe(0);
    expect(validateLeaguePriorities(context).deferralReasonCodes).toContain('non_guaranteed_league_defers_payment');
  });

  test('open registration does not waitlist a league when waitlist length meets open spots', () => {
    const context = contextWithLeagues(
      [standard(1, { openSpotCount: 3, activeWaitlistEntryCount: 3 })],
      { registrationState: 'open', desiredLeagueCount: 1 },
    );
    expect(labelsFor(context)).toEqual(['subject_to_availability']);
  });

  test('open registration marks every vacant league subject to availability', () => {
    const vacant = { openSpotCount: 5, activeWaitlistEntryCount: 0 };
    const context = contextWithLeagues(
      [standard(1, vacant), standard(2, vacant), standard(3, vacant)],
      { registrationState: 'open', desiredLeagueCount: 3 },
    );
    expect(labelsFor(context)).toEqual([
      'subject_to_availability',
      'subject_to_availability',
      'subject_to_availability',
    ]);
    expect(evaluateLeaguePriorities(context).confirmedLeagueFeeMinor).toBe(0);
    expect(evaluateLeaguePriorities(context).maximumLeagueFeeMinor).toBe(90000);
    expect(validateLeaguePriorities(context).deferralReasonCodes).toContain('non_guaranteed_league_defers_payment');
  });

  test('open registration labels a vacant instructional program subject to availability even as a third choice', () => {
    const vacant = { openSpotCount: 5, activeWaitlistEntryCount: 0 };
    const context = contextWithLeagues(
      [
        standard(1, vacant),
        standard(2, vacant),
        standard(3, { ...vacant, format: 'instructional', predecessorLeagueId: null, allowsWaitlist: false }),
      ],
      { registrationState: 'open', desiredLeagueCount: 3 },
    );
    expect(labelsFor(context)).toEqual([
      'subject_to_availability',
      'subject_to_availability',
      'subject_to_availability',
    ]);
    expect(evaluateLeaguePriorities(context).confirmedLeagueFeeMinor).toBe(0);
  });

  test('open registration does not place a sabbatical-fill vacancy from the priority list', () => {
    const context = contextWithLeagues(
      [
        standard(1, {
          openSpotCount: 0,
          activeWaitlistEntryCount: 4,
          temporarySabbaticalFillVacancyCount: 1,
        }),
      ],
      { registrationState: 'open', desiredLeagueCount: 1 },
    );
    expect(labelsFor(context)).toEqual(['subject_to_availability']);
    expect(evaluateLeaguePriorities(context).confirmedLeagueFeeMinor).toBe(0);
  });

  test('an instructional program with only a sabbatical-fill vacancy stays subject to availability', () => {
    const context = contextWithLeagues(
      [
        standard(1, {
          format: 'instructional',
          predecessorLeagueId: null,
          allowsWaitlist: false,
          openSpotCount: 0,
          activeWaitlistEntryCount: 0,
          temporarySabbaticalFillVacancyCount: 1,
        }),
      ],
      { registrationState: 'open', desiredLeagueCount: 1 },
    );
    expect(labelsFor(context)).toEqual(['subject_to_availability']);
    expect(evaluateLeaguePriorities(context).confirmedLeagueFeeMinor).toBe(0);
  });

  test('open registration does not treat a permanent vacancy as available', () => {
    const context = contextWithLeagues(
      [
        standard(1, {
          openSpotCount: 2,
          activeWaitlistEntryCount: 0,
          temporarySabbaticalFillVacancyCount: 1,
        }),
      ],
      { registrationState: 'open', desiredLeagueCount: 1 },
    );
    expect(labelsFor(context)).toEqual(['subject_to_availability']);
  });

  test('open registration keeps extra vacant leagues as backups when only two are wanted', () => {
    const vacant = { openSpotCount: 5, activeWaitlistEntryCount: 0 };
    const context = contextWithLeagues(
      [standard(1, vacant), standard(2, vacant), standard(3, vacant)],
      { registrationState: 'open', desiredLeagueCount: 2 },
    );
    expect(labelsFor(context)).toEqual([
      'subject_to_availability',
      'subject_to_availability',
      'subject_to_availability',
    ]);
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

  test('a subject-to-availability league is on the ceiling, not the floor', () => {
    const context = contextWithLeagues(
      [standard(1, { predecessorLeagueId: null, allowsWaitlist: false })],
      { desiredLeagueCount: 1 },
    );
    const evaluation = evaluateLeaguePriorities(context);
    expect(evaluation.confirmedLeagueFeeMinor).toBe(0);
    expect(evaluation.maximumLeagueFeeMinor).toBe(30000);
  });

  test('a guaranteed league plus a subject-to-availability league quotes a range', () => {
    const context = contextWithLeagues(
      [
        standard(1),
        standard(2, { predecessorLeagueId: null, allowsWaitlist: false }),
      ],
      { desiredLeagueCount: 2 },
    );
    const evaluation = evaluateLeaguePriorities(context);
    expect(labelsFor(context)).toEqual(['guaranteed_return', 'subject_to_availability']);
    expect(evaluation.confirmedLeagueFeeMinor).toBe(30000);
    expect(evaluation.maximumLeagueFeeMinor).toBe(60000);
    expect(validateLeaguePriorities(context).deferralReasonCodes).toContain('non_guaranteed_league_defers_payment');
  });

  test('two guaranteed returns plus a third subject-to-availability league defers payment', () => {
    const context = contextWithLeagues(
      [
        standard(1),
        standard(2),
        standard(3, { predecessorLeagueId: null, allowsWaitlist: false }),
      ],
      { desiredLeagueCount: 3 },
    );
    const evaluation = evaluateLeaguePriorities(context);
    expect(labelsFor(context)).toEqual(['guaranteed_return', 'guaranteed_return', 'subject_to_availability']);
    expect(evaluation.confirmedLeagueFeeMinor).toBe(60000);
    expect(evaluation.maximumLeagueFeeMinor).toBe(90000);
    expect(validateLeaguePriorities(context).deferralReasonCodes).toContain('non_guaranteed_league_defers_payment');
  });
});

describe('play-in ordering', () => {
  const leagues = {
    1: standard(1),
    2: standard(2, { leagueType: 'bring_your_own_team', format: 'doubles' }),
    3: standard(3),
    4: standard(4, { isPlayInBased: true, leagueType: 'bring_your_own_team', format: 'teams' }),
  };

  test('clamping lifts every play-in league above the others', () => {
    const clamped = clampPriorityOrder(
      [
        priority({ leagueId: 1, priorityRank: 1 }),
        priority({ leagueId: 4, priorityRank: 2 }),
        priority({ leagueId: 3, priorityRank: 3 }),
      ],
      leagues,
    );
    expect(clamped.map((entry) => entry.leagueId)).toEqual([4, 1, 3]);
    expect(clamped.map((entry) => entry.priorityRank)).toEqual([1, 2, 3]);
  });

  test('clamping does not lift a bring-your-own-team league that is not play-in based', () => {
    const clamped = clampPriorityOrder(
      [
        priority({ leagueId: 1, priorityRank: 1 }),
        priority({ leagueId: 2, priorityRank: 2 }),
        priority({ leagueId: 3, priorityRank: 3 }),
      ],
      leagues,
    );
    expect(clamped.map((entry) => entry.leagueId)).toEqual([1, 2, 3]);
  });

  test('clamping preserves relative order within each block', () => {
    const clamped = clampPriorityOrder(
      [
        priority({ leagueId: 3, priorityRank: 1 }),
        priority({ leagueId: 1, priorityRank: 2 }),
        priority({ leagueId: 4, priorityRank: 3 }),
        priority({ leagueId: 2, priorityRank: 4 }),
      ],
      leagues,
    );
    expect(clamped.map((entry) => entry.leagueId)).toEqual([4, 3, 1, 2]);
  });

  test('an order that already satisfies the clamp is reported as clamped', () => {
    expect(
      isPriorityOrderClamped(
        [priority({ leagueId: 4, priorityRank: 1 }), priority({ leagueId: 1, priorityRank: 2 })],
        leagues,
      ),
    ).toBe(true);
    expect(
      isPriorityOrderClamped(
        [priority({ leagueId: 1, priorityRank: 1 }), priority({ leagueId: 4, priorityRank: 2 })],
        leagues,
      ),
    ).toBe(false);
    expect(
      isPriorityOrderClamped(
        [priority({ leagueId: 1, priorityRank: 1 }), priority({ leagueId: 2, priorityRank: 2 })],
        leagues,
      ),
    ).toBe(true);
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

  test('a play-in league ranked below another league is rejected', () => {
    expectBlocked(
      contextWithLeagues(
        [
          standard(1),
          standard(2, { isPlayInBased: true, leagueType: 'bring_your_own_team', format: 'teams' }),
        ],
        {
          priorities: [
            priority({ leagueId: 1, priorityRank: 1 }),
            priority({
              leagueId: 2,
              priorityRank: 2,
              teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }, { memberId: 22 }],
            }),
          ],
          playInEntry: { 2: playInEntryContext(false) },
        },
      ),
      'play_in_must_outrank_other_leagues',
    );
  });

  test('a bring-your-own-team league ranked below a standard league is allowed', () => {
    const result = validateLeaguePriorities(
      contextWithLeagues(
        [standard(1), standard(2, { leagueType: 'bring_your_own_team', format: 'doubles' })],
        {
          priorities: [
            priority({ leagueId: 1, priorityRank: 1 }),
            priority({
              leagueId: 2,
              priorityRank: 2,
              teamRosterPlacements: [{ memberId: 20 }, { memberId: 21 }],
            }),
          ],
        },
      ),
    );
    expect(result.blockingErrors.map((error) => String(error.code))).not.toContain(
      'play_in_must_outrank_other_leagues',
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

  test('a doubles league the registrant was added to does not require a local roster', () => {
    const context = contextWithLeagues(
      [standard(1, { leagueType: 'bring_your_own_team', format: 'doubles', name: 'Sunday Doubles' })],
      {
        priorities: [priority({ leagueId: 1, priorityRank: 1 })],
        byotEntry: { 1: { onExistingTeam: true, committedOtherMemberIds: [] } },
      },
    );
    expect(validateLeaguePriorities(context).allowed).toBe(true);
  });

  test('a doubles league still requires a full roster when the registrant declared the team', () => {
    expectBlocked(
      contextWithLeagues([standard(1, { leagueType: 'bring_your_own_team', format: 'doubles' })], {
        priorities: [priority({ leagueId: 1, priorityRank: 1 })],
        byotEntry: { 1: { onExistingTeam: false, committedOtherMemberIds: [] } },
      }),
      'byot_requires_full_roster',
    );
  });

  test('a doubles teammate already on another declared team is rejected', () => {
    expectBlocked(
      contextWithLeagues([standard(1, { leagueType: 'bring_your_own_team', format: 'doubles' })], {
        priorities: [priority({ leagueId: 1, priorityRank: 1, teamRosterPlacements: [{ memberId: 21 }] })],
        byotEntry: { 1: { onExistingTeam: false, committedOtherMemberIds: [21] } },
      }),
      'play_in_teammate_already_committed',
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

  test('a play-in league the registrant is already on does not require a local roster', () => {
    const context = contextWithLeagues(
      [standard(1, { isPlayInBased: true, leagueType: 'bring_your_own_team', format: 'teams', name: 'Tuesday League' })],
      {
        priorities: [priority({ leagueId: 1, priorityRank: 1 })],
        playInEntry: { 1: playInEntryContext(false, [], { onExistingTeam: true }) },
      },
    );
    expect(validateLeaguePriorities(context).allowed).toBe(true);
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

  test('a teammate on a full declared team stays rejected even when the team roster is known', () => {
    const members = [21, 22, 23, 24];
    expectBlocked(
      contextWithLeagues([
        standard(1, { name: 'Tuesday League', isPlayInBased: true, leagueType: 'bring_your_own_team', format: 'teams' }),
      ], {
        priorities: [
          priority({ leagueId: 1, priorityRank: 1, teamRosterPlacements: [{ memberId: 21 }] }),
        ],
        playInEntry: {
          1: playInEntryContext(false, members, {
            teamSize: 4,
            committedOtherMemberTeams: committedTeam(9, members),
          }),
        },
      }),
      'play_in_teammate_already_committed',
    );
  });

  test('joining an incomplete declared play-in team is allowed when the draft covers that roster', () => {
    const teammates = [21, 22, 23];
    const context = contextWithLeagues(
      [standard(1, { isPlayInBased: true, leagueType: 'bring_your_own_team', format: 'teams' })],
      {
        priorities: [
          priority({
            leagueId: 1,
            priorityRank: 1,
            teamRosterPlacements: teammates.map((memberId) => ({ memberId })),
          }),
        ],
        playInEntry: {
          1: playInEntryContext(false, teammates, {
            teamSize: 4,
            committedOtherMemberTeams: committedTeam(9, teammates),
          }),
        },
      },
    );
    expect(validateLeaguePriorities(context).allowed).toBe(true);
  });

  test('joining a two-person incomplete play-in team is allowed', () => {
    const teammates = [21, 22];
    const context = contextWithLeagues(
      [standard(1, { isPlayInBased: true, leagueType: 'bring_your_own_team', format: 'teams' })],
      {
        priorities: [
          priority({
            leagueId: 1,
            priorityRank: 1,
            teamRosterPlacements: teammates.map((memberId) => ({ memberId })),
          }),
        ],
        playInEntry: {
          1: playInEntryContext(false, teammates, {
            teamSize: 4,
            committedOtherMemberTeams: committedTeam(9, teammates),
          }),
        },
      },
    );
    expect(validateLeaguePriorities(context).allowed).toBe(true);
  });

  test('naming only some members of an incomplete declared team is still rejected', () => {
    const teammates = [21, 22, 23];
    expectBlocked(
      contextWithLeagues(
        [standard(1, { isPlayInBased: true, leagueType: 'bring_your_own_team', format: 'teams' })],
        {
          priorities: [
            priority({ leagueId: 1, priorityRank: 1, teamRosterPlacements: [{ memberId: 21 }] }),
          ],
          playInEntry: {
            1: playInEntryContext(false, teammates, {
              teamSize: 4,
              committedOtherMemberTeams: committedTeam(9, teammates),
            }),
          },
        },
      ),
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

  test('Junior Recreational membership does not require a keep-or-leave for last session', () => {
    const context = contextWithLeagues(
      [standard(1, { name: 'Junior Recreational', isJuniorRecreational: true })],
      {
        membershipOption: 'junior_recreational',
        priorities: [],
        desiredLeagueCount: null,
        selections: [],
      },
    );
    expect(validateLeaguePriorities(context).allowed).toBe(true);
  });

  test('regular membership does not require a keep-or-leave for Junior Recreational', () => {
    const context = contextWithLeagues(
      [standard(1, { name: 'Junior Recreational', isJuniorRecreational: true })],
      {
        priorities: [],
        desiredLeagueCount: null,
        selections: [],
      },
    );
    expect(validateLeaguePriorities(context).allowed).toBe(true);
  });

  test('Junior Recreational membership skips keep-or-leave for other last-session leagues', () => {
    const context = contextWithLeagues([standard(1), standard(2)], {
      membershipOption: 'junior_recreational',
      priorities: [],
      desiredLeagueCount: null,
      selections: [],
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

describe('leave-behind decisions for listed leagues', () => {
  test('a drop for a league on the priority list is omitted', () => {
    expect(
      omitLeaveBehindDecisionsForListedLeagues(
        [
          { leagueId: 1, decision: 'drop' as const },
          { leagueId: 2, decision: 'drop' as const },
        ],
        [priority({ leagueId: 1, priorityRank: 1 })],
      ),
    ).toEqual([{ leagueId: 2, decision: 'drop' }]);
  });

  test('a drop selection for a listed play-in league is omitted from confirmation', () => {
    expect(
      omitLeaveBehindSelectionsForListedLeagues(
        [
          selection({ selectionType: 'drop', leagueId: 1 }),
          selection({ selectionType: 'drop', leagueId: 2 }),
        ],
        [priority({ leagueId: 1, priorityRank: 1 })],
      ).map((item) => item.leagueId),
    ).toEqual([2]);
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

  test('subject-to-availability backups are not superfluous while guaranteed spots are below the desired count', () => {
    const context = contextWithLeagues(
      [
        standard(1),
        standard(2),
        standard(3, { predecessorLeagueId: null, allowsWaitlist: false }),
        standard(4, { predecessorLeagueId: null, allowsWaitlist: false }),
      ],
      { desiredLeagueCount: 3 },
    );
    expect(labelsFor(context)).toEqual([
      'guaranteed_return',
      'guaranteed_return',
      'subject_to_availability',
      'subject_to_availability',
    ]);
    expect(validateLeaguePriorities(context).allowed).toBe(true);
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

  test('waitlists above a fallback stay waitlisted after a guaranteed return', () => {
    // Rank 1 is a prior league. Ranks 2–3 try waitlisted leagues. Rank 4 is the
    // other prior league, held as the second protected spot. The waitlists must
    // not be billed as subject to availability or they would fill the desired
    // count and mark the fallback superfluous.
    const context = contextWithLeagues(
      [
        standard(1),
        standard(2, { predecessorLeagueId: null }),
        standard(3, { predecessorLeagueId: null }),
        standard(4),
      ],
      { desiredLeagueCount: 2 },
    );
    expect(labelsFor(context)).toEqual([
      'guaranteed_return',
      'waitlisted',
      'waitlisted',
      'guaranteed_fallback',
    ]);
    expect(waitlistedPriorityEntries(evaluateLeaguePriorities(context)).map((entry) => entry.leagueId)).toEqual([
      2, 3,
    ]);
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

  test('a subject-to-availability list defers payment', () => {
    const context = contextWithLeagues(
      [
        standard(1, { predecessorLeagueId: null, allowsWaitlist: false }),
        standard(2, { predecessorLeagueId: null, allowsWaitlist: false }),
      ],
      { desiredLeagueCount: 2 },
    );
    expect(validateLeaguePriorities(context).deferralReasonCodes).toContain('non_guaranteed_league_defers_payment');
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

  test('the basic ice fallback question appears when the list has no guaranteed leagues', () => {
    expect(shouldCollectBasicIceFallback(contextWithLeagues([standard(1)]))).toBe(false);
    expect(
      shouldCollectBasicIceFallback(
        contextWithLeagues([standard(1, { predecessorLeagueId: null, allowsWaitlist: false })]),
      ),
    ).toBe(true);
    expect(
      shouldCollectBasicIceFallback(contextWithLeagues([standard(1, { predecessorLeagueId: null })])),
    ).toBe(true);
  });

  test('the basic ice fallback question is not offered to new curlers with under one year of experience', () => {
    const noGuarantees = [standard(1, { predecessorLeagueId: null })];
    expect(
      shouldCollectBasicIceFallback(
        contextWithLeagues(noGuarantees, {
          experience: {
            type: 'none_or_minimal',
            selfReportedYears: null,
            baselineOtherClubExperienceYears: 0,
            baselineClubExperienceYears: 0,
            completedSessions: [],
          },
        }),
      ),
    ).toBe(false);
    expect(
      shouldCollectBasicIceFallback(
        contextWithLeagues(noGuarantees, {
          experience: {
            type: 'specified_years',
            selfReportedYears: 0.5,
            baselineOtherClubExperienceYears: 0,
            baselineClubExperienceYears: 0,
            completedSessions: [],
          },
        }),
      ),
    ).toBe(false);
    expect(
      shouldCollectBasicIceFallback(
        contextWithLeagues(noGuarantees, {
          experience: {
            type: 'specified_years',
            selfReportedYears: 1,
            baselineOtherClubExperienceYears: 0,
            baselineClubExperienceYears: 0,
            completedSessions: [],
          },
        }),
      ),
    ).toBe(true);
  });
});
