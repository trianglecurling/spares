import { describe, expect, test } from 'bun:test';
import {
  applyPendingRegistrationMembership,
  playInMembershipCardParticipation,
  resolveClubTenure,
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

  test('returns lifetime member regardless of purchased season membership', () => {
    expect(
      resolveMembershipCardStatus({
        today: '2026-03-01',
        isLifetimeMember: true,
        latestPurchasedSeasonMembership: null,
      }),
    ).toEqual({ kind: 'lifetime', validThrough: null });
    expect(
      resolveMembershipCardStatus({
        today: '2026-03-01',
        isLifetimeMember: true,
        latestPurchasedSeasonMembership: { membershipType: 'regular', endsAt: '2025-12-31' },
      }),
    ).toEqual({ kind: 'lifetime', validThrough: null });
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

describe('applyPendingRegistrationMembership', () => {
  test('optimistically upgrades former member to pending season end date', () => {
    expect(
      applyPendingRegistrationMembership({
        today: '2026-07-01',
        membershipStatus: { kind: 'former', validThrough: '2026-06-30' },
        pendingGrant: {
          membershipOption: 'regular',
          seasonId: 2,
          seasonStartDate: '2026-07-01',
          seasonEndsAt: '2027-06-30',
        },
      }),
    ).toEqual({
      membershipStatus: { kind: 'regular', validThrough: '2027-06-30' },
      pendingRegistrationPayment: true,
    });
  });

  test('optimistically upgrades non-member using social membership option', () => {
    expect(
      applyPendingRegistrationMembership({
        today: '2026-07-01',
        membershipStatus: { kind: 'non_member', validThrough: null },
        pendingGrant: {
          membershipOption: 'social',
          seasonId: 2,
          seasonStartDate: '2026-07-01',
          seasonEndsAt: '2027-06-30',
        },
      }),
    ).toEqual({
      membershipStatus: { kind: 'social', validThrough: '2027-06-30' },
      pendingRegistrationPayment: true,
    });
  });

  test('keeps purchased date when it already covers the pending season and still marks payment pending', () => {
    expect(
      applyPendingRegistrationMembership({
        today: '2026-07-01',
        membershipStatus: { kind: 'regular', validThrough: '2027-06-30' },
        pendingGrant: {
          membershipOption: 'regular',
          seasonId: 2,
          seasonStartDate: '2026-07-01',
          seasonEndsAt: '2027-06-30',
        },
      }),
    ).toEqual({
      membershipStatus: { kind: 'regular', validThrough: '2027-06-30' },
      pendingRegistrationPayment: true,
    });
  });

  test('does not override lifetime membership', () => {
    expect(
      applyPendingRegistrationMembership({
        today: '2026-07-01',
        membershipStatus: { kind: 'lifetime', validThrough: null },
        pendingGrant: {
          membershipOption: 'regular',
          seasonId: 2,
          seasonStartDate: '2026-07-01',
          seasonEndsAt: '2027-06-30',
        },
      }),
    ).toEqual({
      membershipStatus: { kind: 'lifetime', validThrough: null },
      pendingRegistrationPayment: false,
    });
  });

  test('ignores expired pending season grants', () => {
    expect(
      applyPendingRegistrationMembership({
        today: '2026-07-01',
        membershipStatus: { kind: 'former', validThrough: '2025-12-31' },
        pendingGrant: {
          membershipOption: 'regular',
          seasonId: 1,
          seasonStartDate: '2025-07-01',
          seasonEndsAt: '2026-06-30',
        },
      }),
    ).toEqual({
      membershipStatus: { kind: 'former', validThrough: '2025-12-31' },
      pendingRegistrationPayment: false,
    });
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

  test('includes ice privileges for lifetime members on session roster', () => {
    expect(
      resolveIcePrivilegesValidThrough({
        membershipKind: 'lifetime',
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

describe('playInMembershipCardParticipation', () => {
  test('lists guaranteed play-in like roster (no pending badge)', () => {
    expect(playInMembershipCardParticipation({ guaranteed: true })).toBe('roster');
  });

  test('lists non-guaranteed play-in as pending', () => {
    expect(playInMembershipCardParticipation({ guaranteed: false })).toBe('pending');
  });

  test('omits missing evaluations', () => {
    expect(playInMembershipCardParticipation(undefined)).toBeNull();
  });
});

describe('resolveClubTenure', () => {
  const firstSeason = { seasonId: 10, startDate: '2025-07-01' };
  const secondSeason = { seasonId: 20, startDate: '2026-07-01' };
  const firstSession = { id: 101, seasonId: 10 };
  const laterSession = { id: 102, seasonId: 10 };
  const secondSeasonSession = { id: 201, seasonId: 20 };

  test('returns null when there are no membership seasons', () => {
    expect(
      resolveClubTenure({
        membershipSeasons: [],
        currentSession: firstSession,
        firstSessionIdOfCurrentSeason: 101,
      }),
    ).toBeNull();
  });

  test('adds baseline years at this club on top of tracked membership seasons', () => {
    expect(
      resolveClubTenure({
        membershipSeasons: [firstSeason, secondSeason],
        currentSession: secondSeasonSession,
        firstSessionIdOfCurrentSeason: 201,
        baselineClubExperienceYears: 9,
      }),
    ).toEqual({ kind: 'years', years: 11 });
  });

  test('uses baseline years when there are no tracked membership seasons', () => {
    expect(
      resolveClubTenure({
        membershipSeasons: [],
        currentSession: firstSession,
        firstSessionIdOfCurrentSeason: 101,
        baselineClubExperienceYears: 9,
      }),
    ).toEqual({ kind: 'years', years: 9 });
  });

  test('does not treat a first session as new when a club baseline applies', () => {
    expect(
      resolveClubTenure({
        membershipSeasons: [firstSeason],
        currentSession: firstSession,
        firstSessionIdOfCurrentSeason: 101,
        baselineClubExperienceYears: 9,
      }),
    ).toEqual({ kind: 'years', years: 10 });
  });

  test('returns new member for the first session of the first season', () => {
    expect(
      resolveClubTenure({
        membershipSeasons: [firstSeason],
        currentSession: firstSession,
        firstSessionIdOfCurrentSeason: 101,
      }),
    ).toEqual({ kind: 'new', years: null });
  });

  test('returns 1-year member for later sessions of the first season', () => {
    expect(
      resolveClubTenure({
        membershipSeasons: [firstSeason],
        currentSession: laterSession,
        firstSessionIdOfCurrentSeason: 101,
      }),
    ).toEqual({ kind: 'years', years: 1 });
  });

  test('returns 2-year member for any session of the second season', () => {
    expect(
      resolveClubTenure({
        membershipSeasons: [firstSeason, secondSeason],
        currentSession: secondSeasonSession,
        firstSessionIdOfCurrentSeason: 201,
      }),
    ).toEqual({ kind: 'years', years: 2 });
    expect(
      resolveClubTenure({
        membershipSeasons: [firstSeason, secondSeason],
        currentSession: { id: 202, seasonId: 20 },
        firstSessionIdOfCurrentSeason: 201,
      }),
    ).toEqual({ kind: 'years', years: 2 });
  });

  test('stays new member during the first session even with a future season already recorded', () => {
    expect(
      resolveClubTenure({
        membershipSeasons: [firstSeason, secondSeason],
        currentSession: firstSession,
        firstSessionIdOfCurrentSeason: 101,
      }),
    ).toEqual({ kind: 'new', years: null });
  });

  test('uses historical season count when the dashboard session is not a membership season', () => {
    expect(
      resolveClubTenure({
        membershipSeasons: [firstSeason],
        currentSession: secondSeasonSession,
        firstSessionIdOfCurrentSeason: 201,
      }),
    ).toEqual({ kind: 'years', years: 1 });
  });
});
