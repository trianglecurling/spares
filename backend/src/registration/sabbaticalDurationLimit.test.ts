import { describe, expect, test } from 'bun:test';
import { evaluateSabbaticalDurationLimit, canExtendSabbaticalIntoLeague } from './sabbaticalDurationLimit.js';
import { league } from './registrationTestFixtures.js';

describe('sabbaticalDurationLimit', () => {
  const sabbatical = {
    firstSabbaticalStartDate: '2026-10-01',
    staffOverride: false,
  };

  test('allows extension when the league ends before the cutoff anniversary', () => {
    const evaluation = evaluateSabbaticalDurationLimit({
      sabbatical,
      league: league({ lastDayOfPlay: '2029-09-30' }),
      durationLimitYears: 3,
    });
    expect(evaluation.cutoffDate).toBe('2029-10-01');
    expect(evaluation.exceeded).toBe(false);

    expect(
      canExtendSabbaticalIntoLeague({
        sabbatical,
        league: league({ lastDayOfPlay: '2029-09-30' }),
        durationLimitYears: 3,
      }).allowed,
    ).toBe(true);
  });

  test('blocks extension when the league ends on the cutoff anniversary', () => {
    const evaluation = evaluateSabbaticalDurationLimit({
      sabbatical,
      league: league({ lastDayOfPlay: '2029-10-01' }),
      durationLimitYears: 3,
    });
    expect(evaluation.exceeded).toBe(true);
    expect(
      canExtendSabbaticalIntoLeague({
        sabbatical,
        league: league({ lastDayOfPlay: '2029-10-01' }),
        durationLimitYears: 3,
      }).allowed,
    ).toBe(false);
  });

  test('blocks extension when the league ends after the cutoff anniversary', () => {
    expect(
      canExtendSabbaticalIntoLeague({
        sabbatical,
        league: league({ lastDayOfPlay: '2030-03-15' }),
        durationLimitYears: 3,
      }).allowed,
    ).toBe(false);
  });

  test('allows extension past the cutoff when staff override applies', () => {
    const result = canExtendSabbaticalIntoLeague({
      sabbatical: { ...sabbatical, staffOverride: true },
      league: league({ lastDayOfPlay: '2029-10-01' }),
      durationLimitYears: 3,
    });
    expect(result.allowed).toBe(true);
    expect(result.requiresStaffReview).toBe(false);
  });
});
