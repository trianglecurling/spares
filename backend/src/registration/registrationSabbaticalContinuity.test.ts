import { describe, expect, test } from 'bun:test';
import {
  canChooseNoMembership,
  isPriorityKeepOrLeaveLeague,
  listContinuingSabbaticalSummaries,
  listLeaguesRequiringPriorSessionDecision,
  validateContinuingSabbaticalDecisions,
} from './registrationSabbaticalContinuity.js';
import { league, priority, registrationContext, selection } from './registrationTestFixtures.js';

describe('registrationSabbaticalContinuity', () => {
  test('lists continuing sabbaticals when the member did not play the predecessor league', () => {
    const context = registrationContext({
      registrationState: 'priority',
      participatedLeagueIds: [],
      existingSabbaticals: [
        {
          id: 7,
          originalLeagueId: 90,
          currentLeagueId: 90,
          firstSabbaticalLeagueId: 90,
          firstSabbaticalStartDate: '2026-10-01',
          status: 'active',
        },
      ],
      leagues: {
        100: league({ id: 100, name: 'Thursday Early', predecessorLeagueId: 90, lastDayOfPlay: '2027-03-15' }),
      },
    });

    expect(listContinuingSabbaticalSummaries(context)).toEqual([
      expect.objectContaining({
        sabbaticalId: 7,
        leagueId: 100,
        leagueName: 'Thursday Early',
        canExtend: true,
        sabbaticalFeeMinor: 5000,
      }),
    ]);
    expect(listLeaguesRequiringPriorSessionDecision(context).map((item) => item.id)).toEqual([100]);
  });

  test('canChooseNoMembership is true when continuing sabbaticals exist', () => {
    const context = registrationContext({
      registrationState: 'priority',
      participatedLeagueIds: [],
      existingSabbaticals: [
        {
          id: 7,
          originalLeagueId: 90,
          currentLeagueId: 90,
          firstSabbaticalLeagueId: 90,
          firstSabbaticalStartDate: '2026-10-01',
          status: 'active',
        },
      ],
      leagues: {
        100: league({ id: 100, predecessorLeagueId: 90 }),
      },
    });

    expect(canChooseNoMembership(context)).toBe(true);
    expect(canChooseNoMembership(registrationContext({ registrationState: 'open' }))).toBe(false);
  });

  test('canChooseNoMembership is true with guaranteed return to a sabbatical league', () => {
    const context = registrationContext({
      registrationState: 'priority',
      participatedLeagueIds: [90],
      leagues: {
        100: league({ id: 100, predecessorLeagueId: 90, allowsSabbatical: true }),
      },
    });

    expect(canChooseNoMembership(context)).toBe(true);
  });

  test('does not duplicate participation-based prior leagues in continuing summaries', () => {
    const context = registrationContext({
      registrationState: 'priority',
      participatedLeagueIds: [90],
      existingSabbaticals: [
        {
          id: 7,
          originalLeagueId: 90,
          currentLeagueId: 90,
          firstSabbaticalLeagueId: 90,
          firstSabbaticalStartDate: '2026-10-01',
          status: 'active',
        },
      ],
      leagues: {
        100: league({ id: 100, predecessorLeagueId: 90 }),
      },
    });

    expect(listContinuingSabbaticalSummaries(context)).toEqual([]);
    expect(listLeaguesRequiringPriorSessionDecision(context).map((item) => item.id)).toEqual([100]);
  });

  test('Junior Recreational is not a priority-list keep-or-leave league', () => {
    const junior = league({ id: 100, isJuniorRecreational: true, predecessorLeagueId: 90 });
    const tuesday = league({ id: 101, predecessorLeagueId: 91 });
    expect(isPriorityKeepOrLeaveLeague(junior, [90, 91])).toBe(false);
    expect(isPriorityKeepOrLeaveLeague(tuesday, [90, 91])).toBe(true);
  });

  test('Junior Recreational membership does not require continuing sabbatical answers', () => {
    const context = registrationContext({
      registrationState: 'priority',
      membershipOption: 'junior_recreational',
      participatedLeagueIds: [],
      existingSabbaticals: [
        {
          id: 7,
          originalLeagueId: 90,
          currentLeagueId: 90,
          firstSabbaticalLeagueId: 90,
          firstSabbaticalStartDate: '2026-10-01',
          status: 'active',
        },
      ],
      leagues: {
        100: league({ id: 100, predecessorLeagueId: 90, lastDayOfPlay: '2029-10-01' }),
      },
      selections: [],
      priorities: [],
      desiredLeagueCount: null,
    });

    expect(validateContinuingSabbaticalDecisions(context)).toEqual([]);
  });

  test('requires a prior-session decision for continuing sabbaticals', () => {
    const context = registrationContext({
      registrationState: 'priority',
      participatedLeagueIds: [],
      existingSabbaticals: [
        {
          id: 7,
          originalLeagueId: 90,
          currentLeagueId: 90,
          firstSabbaticalLeagueId: 90,
          firstSabbaticalStartDate: '2026-10-01',
          status: 'active',
        },
      ],
      leagues: {
        100: league({ id: 100, predecessorLeagueId: 90, lastDayOfPlay: '2029-10-01' }),
      },
      selections: [],
      priorities: [],
      desiredLeagueCount: null,
    });

    const errors = validateContinuingSabbaticalDecisions(context);
    expect(errors.map((error) => error.code)).toContain('continuing_sabbatical_decision_required');
  });

  test('putting the league back on the priority list resolves a continuing sabbatical', () => {
    const context = registrationContext({
      registrationState: 'priority',
      participatedLeagueIds: [],
      existingSabbaticals: [
        {
          id: 7,
          originalLeagueId: 90,
          currentLeagueId: 90,
          firstSabbaticalLeagueId: 90,
          firstSabbaticalStartDate: '2026-10-01',
          status: 'active',
        },
      ],
      leagues: {
        100: league({ id: 100, predecessorLeagueId: 90, lastDayOfPlay: '2029-10-01' }),
      },
      selections: [],
    });

    expect(validateContinuingSabbaticalDecisions(context)).toEqual([]);
  });

  test('blocks extending when the duration limit is exceeded', () => {
    const context = registrationContext({
      registrationState: 'priority',
      participatedLeagueIds: [],
      existingSabbaticals: [
        {
          id: 7,
          originalLeagueId: 90,
          currentLeagueId: 90,
          firstSabbaticalLeagueId: 90,
          firstSabbaticalStartDate: '2026-10-01',
          status: 'active',
        },
      ],
      leagues: {
        100: league({ id: 100, predecessorLeagueId: 90, lastDayOfPlay: '2029-10-01' }),
      },
      selections: [selection({ leagueId: 100, selectionType: 'sabbatical' })],
    });

    const errors = validateContinuingSabbaticalDecisions(context);
    expect(errors.map((error) => error.code)).toContain('sabbatical_duration_limit_exceeded');
  });

  test('accepts drop and return decisions for continuing sabbaticals', () => {
    const base = {
      registrationState: 'priority' as const,
      participatedLeagueIds: [] as number[],
      existingSabbaticals: [
        {
          id: 7,
          originalLeagueId: 90,
          currentLeagueId: 90,
          firstSabbaticalLeagueId: 90,
          firstSabbaticalStartDate: '2026-10-01',
          status: 'active' as const,
        },
      ],
      leagues: {
        100: league({ id: 100, predecessorLeagueId: 90, lastDayOfPlay: '2027-03-15' }),
      },
    };

    expect(
      validateContinuingSabbaticalDecisions(
        registrationContext({
          ...base,
          selections: [selection({ leagueId: 100, selectionType: 'drop' })],
          priorities: [],
          desiredLeagueCount: null,
        }),
      ),
    ).toEqual([]);
    expect(
      validateContinuingSabbaticalDecisions(
        registrationContext({ ...base, selections: [], priorities: [priority({ leagueId: 100 })] }),
      ),
    ).toEqual([]);
  });
});
