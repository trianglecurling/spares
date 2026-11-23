import { describe, expect, test } from 'bun:test';
import type { AuthenticatedMember } from '../../../backend/src/types.ts';
import { getAdminLinks } from './memberNavigation';
import {
  memberCanAccessDonationCollectionsAdmin,
  memberCanManageDonationCollectionFromClaims,
} from './donationCollectionAccess';

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
    managedDonationCollectionIds: [],
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

describe('donation collection access', () => {
  test('donations.manage can open every collection', () => {
    const admin = member({
      scopeRules: [{ scope: 'donations.manage', effect: 'allow' }],
    });
    expect(memberCanAccessDonationCollectionsAdmin(admin)).toBe(true);
    expect(memberCanManageDonationCollectionFromClaims(admin, 4)).toBe(true);
  });

  test('a manager can open only assigned collections', () => {
    const manager = member({ managedDonationCollectionIds: [4] });
    expect(memberCanManageDonationCollectionFromClaims(manager, 4)).toBe(true);
    expect(memberCanManageDonationCollectionFromClaims(manager, 9)).toBe(false);
    expect(getAdminLinks(manager)).toEqual([
      { to: '/admin/donations', label: 'Manage donation collections' },
    ]);
  });
});
