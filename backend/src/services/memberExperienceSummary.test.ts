import { describe, expect, test } from 'bun:test';
import {
  computeMemberTotalExperienceYears,
  resolveMemberExperienceType,
} from './memberExperienceSummary.js';

describe('memberExperienceSummary', () => {
  test('uses baselines and computed club seasons for known_existing members', () => {
    const experienceType = resolveMemberExperienceType({
      registrationExperienceType: null,
      completedSessionCount: 2,
      baselines: {
        baselineOtherClubExperienceYears: 3,
        baselineClubExperienceYears: 2,
      },
    });
    expect(experienceType).toBe('known_existing');

    const total = computeMemberTotalExperienceYears({
      experienceType,
      experienceSelfReportedYears: null,
      baselines: {
        baselineOtherClubExperienceYears: 3,
        baselineClubExperienceYears: 2,
      },
      completedSessions: [
        { leagueId: 1, seasonKey: '2023-2024' },
        { leagueId: 2, seasonKey: '2024-2025' },
      ],
    });
    expect(total).toBe(7);
  });

  test('uses self-reported other-club years for specified_years registrations', () => {
    const total = computeMemberTotalExperienceYears({
      experienceType: 'specified_years',
      experienceSelfReportedYears: 4.5,
      baselines: {
        baselineOtherClubExperienceYears: 9,
        baselineClubExperienceYears: 1,
      },
      completedSessions: [{ leagueId: 1, seasonKey: '2024-2025' }],
    });
    expect(total).toBe(6.5);
  });
});
