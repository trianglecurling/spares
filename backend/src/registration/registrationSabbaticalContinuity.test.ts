import { describe, expect, test } from 'bun:test';
import {
  listContinuingSabbaticalSummaries,
  listLeaguesRequiringPriorSessionDecision,
  validateContinuingSabbaticalDecisions,
} from './registrationSabbaticalContinuity.js';
import { league, registrationContext, selection } from './registrationTestFixtures.js';

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
    });

    const errors = validateContinuingSabbaticalDecisions(context);
    expect(errors.map((error) => error.code)).toContain('continuing_sabbatical_decision_required');
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
        registrationContext({ ...base, selections: [selection({ leagueId: 100, selectionType: 'drop' })] }),
      ),
    ).toEqual([]);
    expect(
      validateContinuingSabbaticalDecisions(
        registrationContext({ ...base, selections: [selection({ leagueId: 100, selectionType: 'guaranteed_return' })] }),
      ),
    ).toEqual([]);
  });
});
