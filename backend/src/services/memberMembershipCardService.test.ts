import { describe, expect, test } from 'bun:test';
import {
  resolveIcePrivilegesValidThrough,
  resolveMembershipCardStatus,
} from './memberMembershipCardService.js';

describe('resolveMembershipCardStatus', () => {
  test('returns regular member with latest purchased season membership end date', () => {
    expect(
      resolveMembershipCardStatus({
        today: '2026-03-01',
        latestPurchasedSeasonMembership: { membershipType: 'regular', endsAt: '2026-06-30' },
      }),
    ).toEqual({ kind: 'regular', validThrough: '2026-06-30' });
  });

  test('returns social member from purchased season membership type', () => {
    expect(
      resolveMembershipCardStatus({
        today: '2026-03-01',
        latestPurchasedSeasonMembership: { membershipType: 'social', endsAt: '2026-06-30' },
      }),
    ).toEqual({ kind: 'social', validThrough: '2026-06-30' });
  });

  test('returns former member with expiration when latest purchased season has ended', () => {
    expect(
      resolveMembershipCardStatus({
        today: '2026-03-01',
        latestPurchasedSeasonMembership: { membershipType: 'regular', endsAt: '2025-12-31' },
      }),
    ).toEqual({ kind: 'former', validThrough: '2025-12-31' });
  });

  test('returns non-member when there is no purchased season membership', () => {
    expect(
      resolveMembershipCardStatus({
        today: '2026-03-01',
        latestPurchasedSeasonMembership: null,
      }),
    ).toEqual({ kind: 'non_member', validThrough: null });
  });

  test('always includes validThrough for active regular memberships', () => {
    const status = resolveMembershipCardStatus({
      today: '2026-03-01',
      latestPurchasedSeasonMembership: {
        membershipType: 'regular',
        endsAt: '2027-08-31T04:00:00.000Z',
      },
    });
    expect(status).toEqual({ kind: 'regular', validThrough: '2027-08-31' });
  });
});

describe('resolveIcePrivilegesValidThrough', () => {
  test('omits ice privileges for social members', () => {
    expect(
      resolveIcePrivilegesValidThrough({
        membershipKind: 'social',
        sessionEndDate: '2026-05-15',
        hasActiveSessionIcePrivilege: true,
        onSessionRoster: false,
      }),
    ).toBeNull();
  });

  test('uses the session end date instead of the season membership end date', () => {
    expect(
      resolveIcePrivilegesValidThrough({
        membershipKind: 'regular',
        sessionEndDate: '2026-12-31',
        hasActiveSessionIcePrivilege: false,
        onSessionRoster: true,
      }),
    ).toBe('2026-12-31');
  });

  test('returns null when the member has no session ice privileges', () => {
    expect(
      resolveIcePrivilegesValidThrough({
        membershipKind: 'regular',
        sessionEndDate: '2026-12-31',
        hasActiveSessionIcePrivilege: false,
        onSessionRoster: false,
      }),
    ).toBeNull();
  });
});
