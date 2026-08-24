import { describe, expect, test } from 'bun:test';
import { buildPublicLeagueTypeText, type PublicLeagueFormationInput } from './publicLeagueDisplay.js';

function league(overrides: Partial<PublicLeagueFormationInput> = {}): PublicLeagueFormationInput {
  return {
    format: 'teams',
    leagueType: 'standard',
    teamFormation: 'coordinator',
    allowsDropIns: false,
    isPlayInBased: false,
    minAge: null,
    maxAge: null,
    maxExperienceYears: null,
    ...overrides,
  };
}

describe('buildPublicLeagueTypeText', () => {
  test('includes team formation for standard team leagues', () => {
    expect(buildPublicLeagueTypeText(league())).toBe('Open teams. Teams formed by coordinator.');
    expect(buildPublicLeagueTypeText(league({ teamFormation: 'skips_draft' }))).toBe(
      "Open teams. Teams formed by skips' draft."
    );
    expect(buildPublicLeagueTypeText(league({ leagueType: 'bring_your_own_team' }))).toBe(
      'Open teams. Build your own team.'
    );
  });

  test('omits team formation for instructional programs', () => {
    expect(buildPublicLeagueTypeText(league({ format: 'instructional' }))).toBe('Instructional program.');
    expect(
      buildPublicLeagueTypeText(league({ format: 'instructional', teamFormation: 'skips_draft' }))
    ).toBe('Instructional program.');
    expect(
      buildPublicLeagueTypeText(league({ format: 'instructional', leagueType: 'bring_your_own_team' }))
    ).toBe('Instructional program.');
  });

  test('keeps age and experience constraints for instructional programs', () => {
    expect(
      buildPublicLeagueTypeText(
        league({
          format: 'instructional',
          minAge: 18,
          maxExperienceYears: 2,
        })
      )
    ).toBe('Instructional program. Ages 18 and up. Curlers under 2 years of experience only.');
  });
});
