import { describe, expect, test } from 'bun:test';
import type { AuthenticatedMember } from '../../../backend/src/types.ts';
import { memberCanBypassLeagueProcessingHold } from './leagueProcessing';

function member(overrides: Partial<AuthenticatedMember> = {}): AuthenticatedMember {
  return {
    id: 1,
    name: 'Test Member',
    email: 'test@example.com',
    phone: null,
    spareOnly: false,
    socialMember: false,
    isAdmin: false,
    isServerAdmin: false,
    isCalendarAdmin: false,
    isContentAdmin: false,
    isSponsorAdmin: false,
    leagueManagerLeagueIds: [],
    ownedEventIds: [],
    managedCredentialIds: [],
    managedVolunteerProgramIds: [],
    isLeagueAdministrator: false,
    isLeagueAdministratorGlobal: false,
    roleCodes: [],
    roleNames: [],
    scopeRules: [],
    optedInSms: false,
    emailSubscribed: false,
    emailVisible: false,
    phoneVisible: false,
    themePreference: 'system',
    ...overrides,
  };
}

describe('memberCanBypassLeagueProcessingHold', () => {
  test('ordinary members cannot bypass', () => {
    expect(memberCanBypassLeagueProcessingHold(member())).toBe(false);
  });

  test('admins and league managers can bypass', () => {
    expect(memberCanBypassLeagueProcessingHold(member({ isAdmin: true }))).toBe(true);
    expect(memberCanBypassLeagueProcessingHold(member({ isServerAdmin: true }))).toBe(true);
    expect(memberCanBypassLeagueProcessingHold(member({ leagueManagerLeagueIds: [12] }))).toBe(true);
    expect(
      memberCanBypassLeagueProcessingHold(
        member({
          scopeRules: [{ scope: 'registrations.manage', effect: 'allow' }],
        }),
      ),
    ).toBe(true);
  });
});
