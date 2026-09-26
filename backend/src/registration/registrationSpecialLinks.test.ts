import { describe, expect, test } from 'bun:test';
import {
  applySpecialLinkOverlayToWindowState,
  emailsMatchForSpecialLink,
  filterLeaguesForSpecialLink,
  parseAllowedLeagueIds,
  serializeAllowedLeagueIds,
  specialLinkAllowsIcePrivileges,
  specialLinkAllowsMembershipOption,
  type RegistrationSpecialLinkConstraints,
} from './registrationSpecialLinks.js';

function constraints(
  overrides: Partial<RegistrationSpecialLinkConstraints> = {},
): RegistrationSpecialLinkConstraints {
  return {
    id: 1,
    seasonId: 10,
    sessionId: 20,
    email: 'invitee@example.com',
    allowLeagueRegistration: true,
    allowedLeagueIds: [1, 2],
    ...overrides,
  };
}

describe('registration special links', () => {
  test('parses allowed league ids from json text or arrays', () => {
    expect(parseAllowedLeagueIds('[1,2,2,3]')).toEqual([1, 2, 3]);
    expect(parseAllowedLeagueIds([4, 5])).toEqual([4, 5]);
    expect(parseAllowedLeagueIds(null)).toBeNull();
    expect(serializeAllowedLeagueIds([2, 2, 7])).toEqual([2, 7]);
  });

  test('closed registration becomes open for a matching special link', () => {
    expect(
      applySpecialLinkOverlayToWindowState('closed', constraints(), { seasonId: 10, sessionId: 20 }),
    ).toBe('open');
    expect(
      applySpecialLinkOverlayToWindowState('closed', constraints(), { seasonId: 11, sessionId: 20 }),
    ).toBe('closed');
    expect(
      applySpecialLinkOverlayToWindowState('priority', constraints(), { seasonId: 10, sessionId: 20 }),
    ).toBe('priority');
  });

  test('locks the invite email', () => {
    expect(emailsMatchForSpecialLink('Invitee@example.com', 'invitee@example.com')).toBe(true);
    expect(emailsMatchForSpecialLink('invitee@example.com', 'other@example.com')).toBe(false);
  });

  test('restricts membership and ice options when leagues are off', () => {
    const noLeagues = constraints({ allowLeagueRegistration: false, allowedLeagueIds: null });
    expect(specialLinkAllowsMembershipOption(noLeagues, 'regular')).toBe(true);
    expect(specialLinkAllowsMembershipOption(noLeagues, 'regular_spare_only')).toBe(true);
    expect(specialLinkAllowsMembershipOption(noLeagues, 'social')).toBe(true);
    expect(specialLinkAllowsMembershipOption(noLeagues, 'junior_recreational')).toBe(false);
    expect(specialLinkAllowsIcePrivileges(noLeagues, 'basic_ice')).toBe(true);
    expect(specialLinkAllowsIcePrivileges(noLeagues, 'none')).toBe(true);
    expect(specialLinkAllowsIcePrivileges(noLeagues, 'league_play')).toBe(false);
  });

  test('filters the league catalog to allowed leagues', () => {
    const leagues = {
      1: { id: 1 },
      2: { id: 2 },
      3: { id: 3 },
    };
    expect(filterLeaguesForSpecialLink(leagues, constraints({ allowedLeagueIds: [2, 3] }))).toEqual({
      2: { id: 2 },
      3: { id: 3 },
    });
    expect(filterLeaguesForSpecialLink(leagues, constraints({ allowLeagueRegistration: false }))).toEqual({});
  });
});
