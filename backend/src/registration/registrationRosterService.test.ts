import { describe, expect, test } from 'bun:test';
import { guaranteedPlacementsFromEvaluation, registrationStatusCommitsRoster } from './registrationRosterService.js';
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
});
