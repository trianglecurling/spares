import { describe, expect, test } from 'bun:test';
import { memberWaitlistExperienceEvaluation } from './memberWaitlistJoinService.js';
import { league, registrationContext } from './registrationTestFixtures.js';

describe('memberWaitlistExperienceEvaluation', () => {
  test('returns no warning when experience meets the league requirement', () => {
    const result = memberWaitlistExperienceEvaluation(
      registrationContext({
        experience: {
          type: 'specified_years',
          selfReportedYears: 2,
          baselineOtherClubExperienceYears: 0,
          baselineClubExperienceYears: 0,
          completedSessions: [],
        },
      }),
      league({ minExperienceYears: 1 }),
    );
    expect(result.blockingExperienceErrors).toHaveLength(0);
    expect(result.experienceWarning).toBeNull();
  });

  test('returns a warning instead of blocking when within two years of the requirement', () => {
    const result = memberWaitlistExperienceEvaluation(
      registrationContext({
        experience: {
          type: 'none_or_minimal',
          selfReportedYears: null,
          baselineOtherClubExperienceYears: 0,
          baselineClubExperienceYears: 0,
          completedSessions: [],
        },
      }),
      league({ minExperienceYears: 1 }),
    );
    expect(result.blockingExperienceErrors).toHaveLength(0);
    expect(result.experienceWarning).toBe(
      'This league requires 1 year of experience. In order to be accepted from this waitlist, you must satisfy this requirement by the time your entry is available.',
    );
  });

  test('blocks join when more than two years short of the requirement', () => {
    const result = memberWaitlistExperienceEvaluation(
      registrationContext({
        experience: {
          type: 'none_or_minimal',
          selfReportedYears: null,
          baselineOtherClubExperienceYears: 0,
          baselineClubExperienceYears: 0,
          completedSessions: [],
        },
      }),
      league({ minExperienceYears: 4 }),
    );
    expect(result.blockingExperienceErrors).toHaveLength(1);
    expect(result.experienceWarning).toBeNull();
  });
});
