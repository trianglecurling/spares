import { describe, expect, test } from 'bun:test';
import {
  guaranteedPlacementsFromEvaluation,
  juniorRecreationalLeagueIdFromLeagues,
  registrationStatusCommitsRoster,
  rosterPlacementsForRegistration,
} from './registrationRosterService.js';
import { evaluateLeaguePriorities } from './leaguePriorityEvaluation.js';
import { league, priority, registrationContext } from './registrationTestFixtures.js';

describe('registrationRosterService', () => {
  test('registrationStatusCommitsRoster is true for submitted and unpaid statuses', () => {
    expect(registrationStatusCommitsRoster('confirmed')).toBe(true);
    expect(registrationStatusCommitsRoster('paid')).toBe(true);
    expect(registrationStatusCommitsRoster('awaiting_placement')).toBe(true);
    expect(registrationStatusCommitsRoster('awaiting_staff_review')).toBe(true);
    expect(registrationStatusCommitsRoster('awaiting_payment')).toBe(true);
    expect(registrationStatusCommitsRoster('payment_started')).toBe(true);
    expect(registrationStatusCommitsRoster('submitted')).toBe(true);
  });

  test('registrationStatusCommitsRoster is false for drafts and canceled registrations', () => {
    expect(registrationStatusCommitsRoster('shell_complete')).toBe(false);
    expect(registrationStatusCommitsRoster('cancelled')).toBe(false);
    expect(registrationStatusCommitsRoster('identity_incomplete')).toBe(false);
  });
});

describe('roster placements derived from the priority list', () => {
  test('only guaranteed entries reach the roster, tagged by how they were earned', () => {
    const context = registrationContext({
      desiredLeagueCount: 3,
      priorities: [
        priority({ leagueId: 100, priorityRank: 1 }),
        priority({ leagueId: 101, priorityRank: 2 }),
        priority({ leagueId: 102, priorityRank: 3 }),
      ],
      leagues: {
        100: league({ id: 100, predecessorLeagueId: 90 }),
        101: league({ id: 101, predecessorLeagueId: null }),
        102: league({ id: 102, predecessorLeagueId: 92 }),
        90: league({ id: 90, predecessorLeagueId: null }),
        92: league({ id: 92, predecessorLeagueId: null }),
      },
      participatedLeagueIds: [90, 92],
    });

    expect(guaranteedPlacementsFromEvaluation(evaluateLeaguePriorities(context))).toEqual([
      { leagueId: 100, placementType: 'guaranteed_return' },
      { leagueId: 102, placementType: 'guaranteed_fallback' },
    ]);
  });

  test('a list with nothing guaranteed places nobody', () => {
    const context = registrationContext({
      leagues: { 100: league({ id: 100, predecessorLeagueId: null }) },
      participatedLeagueIds: [],
    });
    expect(guaranteedPlacementsFromEvaluation(evaluateLeaguePriorities(context))).toEqual([]);
  });

  test('a billed subject-to-availability league is rostered as a new placement', () => {
    const context = registrationContext({
      desiredLeagueCount: 1,
      participatedLeagueIds: [],
      priorities: [priority({ leagueId: 50, priorityRank: 1 })],
      leagues: {
        50: league({ id: 50, predecessorLeagueId: null, allowsWaitlist: false, name: 'Junior Advanced Commitment' }),
      },
    });
    expect(rosterPlacementsForRegistration(context, evaluateLeaguePriorities(context))).toEqual([
      { leagueId: 50, placementType: 'new_placement' },
    ]);
  });

  test('a waitlisted leftover is not rostered', () => {
    const context = registrationContext({
      desiredLeagueCount: 1,
      participatedLeagueIds: [],
      priorities: [priority({ leagueId: 50, priorityRank: 1 })],
      leagues: {
        50: league({ id: 50, predecessorLeagueId: null, allowsWaitlist: true }),
      },
    });
    expect(rosterPlacementsForRegistration(context, evaluateLeaguePriorities(context))).toEqual([]);
  });

  test('a subject-to-availability backup below the desired count is not rostered', () => {
    const context = registrationContext({
      desiredLeagueCount: 1,
      participatedLeagueIds: [],
      priorities: [
        priority({ leagueId: 50, priorityRank: 1 }),
        priority({ leagueId: 51, priorityRank: 2 }),
      ],
      leagues: {
        50: league({ id: 50, predecessorLeagueId: null, allowsWaitlist: false }),
        51: league({ id: 51, predecessorLeagueId: null, allowsWaitlist: false }),
      },
    });
    expect(rosterPlacementsForRegistration(context, evaluateLeaguePriorities(context))).toEqual([
      { leagueId: 50, placementType: 'new_placement' },
    ]);
  });
});

describe('Junior Recreational roster placement', () => {
  test('uses the league marked as the Junior Recreational program', () => {
    expect(
      juniorRecreationalLeagueIdFromLeagues({
        1: league({ id: 1, name: 'Tuesday Evening' }),
        2: league({ id: 2, name: 'Youth program', isJuniorRecreational: true }),
      }),
    ).toBe(2);
    expect(juniorRecreationalLeagueIdFromLeagues({ 1: league({ id: 1 }) })).toBeNull();
  });

  test('a Junior Recreational registration is placed on the flagged program league', () => {
    const juniorLeague = league({
      id: 200,
      name: 'Youth program',
      isJuniorRecreational: true,
      predecessorLeagueId: null,
      registrationFeeMinor: 0,
    });
    const context = registrationContext({
      membershipOption: 'junior_recreational',
      priorities: [],
      desiredLeagueCount: null,
      selections: [],
      participatedLeagueIds: [],
      leagues: { 200: juniorLeague },
    });
    expect(rosterPlacementsForRegistration(context, evaluateLeaguePriorities(context))).toEqual([
      { leagueId: 200, placementType: 'new_placement' },
    ]);
  });

  test('regular membership does not place onto a Junior Recreational league', () => {
    const context = registrationContext({
      leagues: {
        200: league({ id: 200, name: 'Youth program', isJuniorRecreational: true, predecessorLeagueId: null }),
      },
      participatedLeagueIds: [],
      priorities: [],
      desiredLeagueCount: null,
    });
    expect(rosterPlacementsForRegistration(context, evaluateLeaguePriorities(context))).toEqual([]);
  });
});
