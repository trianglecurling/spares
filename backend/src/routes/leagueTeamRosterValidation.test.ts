import { describe, expect, test } from 'bun:test';
import { validateLeagueTeamRoster, type LeagueTeamRosterMember } from './leagueTeamRosterValidation.js';

function member(
  memberId: number,
  role: LeagueTeamRosterMember['role'],
  flags: { isSkip?: boolean; isVice?: boolean } = {}
): LeagueTeamRosterMember {
  return { memberId, role, ...flags };
}

describe('validateLeagueTeamRoster', () => {
  test('allows a three-person teams roster without a lead', () => {
    const roster = validateLeagueTeamRoster('teams', [
      member(1, 'second'),
      member(2, 'third', { isVice: true }),
      member(3, 'fourth', { isSkip: true }),
    ]);

    expect(roster.map((entry) => entry.role)).toEqual(['second', 'third', 'fourth']);
  });

  test('allows a three-person teams roster without a second', () => {
    const roster = validateLeagueTeamRoster('teams', [
      member(1, 'lead'),
      member(2, 'third', { isVice: true }),
      member(3, 'fourth', { isSkip: true }),
    ]);

    expect(roster.map((entry) => entry.role)).toEqual(['lead', 'third', 'fourth']);
  });

  test('allows a four-person teams roster', () => {
    const roster = validateLeagueTeamRoster('teams', [
      member(1, 'lead'),
      member(2, 'second'),
      member(3, 'third', { isVice: true }),
      member(4, 'fourth', { isSkip: true }),
    ]);

    expect(roster).toHaveLength(4);
  });

  test('rejects a two-person teams roster', () => {
    expect(() =>
      validateLeagueTeamRoster('teams', [
        member(1, 'third', { isVice: true }),
        member(2, 'fourth', { isSkip: true }),
      ])
    ).toThrow('Teams rosters must have 3 or 4 players.');
  });

  test('rejects a teams roster without skip and vice', () => {
    expect(() =>
      validateLeagueTeamRoster('teams', [member(1, 'lead'), member(2, 'third'), member(3, 'fourth')])
    ).toThrow('Teams rosters must have exactly one skip.');
  });
});
