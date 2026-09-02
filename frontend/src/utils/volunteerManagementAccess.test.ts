import { describe, expect, test } from 'bun:test';
import type { AuthenticatedMember } from '../../../backend/src/types.ts';
import { getAdminLinks } from './memberNavigation';
import {
  memberCanAccessVolunteeringAdmin,
  memberCanManageVolunteerProgramFromClaims,
} from './volunteerManagementAccess';

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

describe('memberCanAccessVolunteeringAdmin', () => {
  test('is true for volunteering.manage', () => {
    expect(
      memberCanAccessVolunteeringAdmin(
        member({
          scopeRules: [{ scope: 'volunteering.manage', effect: 'allow' }],
        }),
      ),
    ).toBe(true);
  });

  test('is true when the member manages at least one program', () => {
    expect(memberCanAccessVolunteeringAdmin(member({ managedVolunteerProgramIds: [12] }))).toBe(true);
  });

  test('is false without scope or managed programs', () => {
    expect(memberCanAccessVolunteeringAdmin(member())).toBe(false);
  });
});

describe('memberCanManageVolunteerProgramFromClaims', () => {
  test('allows a listed program only', () => {
    const programManager = member({ managedVolunteerProgramIds: [12] });
    expect(memberCanManageVolunteerProgramFromClaims(programManager, 12)).toBe(true);
    expect(memberCanManageVolunteerProgramFromClaims(programManager, 99)).toBe(false);
  });
});

describe('getAdminLinks volunteering', () => {
  test('includes Manage sign-ups for a single-program manager', () => {
    expect(getAdminLinks(member({ managedVolunteerProgramIds: [12] }))).toEqual([
      { to: '/admin/volunteering', label: 'Manage sign-ups' },
    ]);
  });

  test('omits Manage sign-ups without scope or managed programs', () => {
    expect(getAdminLinks(member()).some((link) => link.to === '/admin/volunteering')).toBe(false);
  });
});
