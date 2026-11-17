import { describe, expect, test } from 'bun:test';
import {
  isTuesdayEveningLeague,
  isTuesdayPlaydownTeam,
  resolveTuesdayEveningBadge,
} from './waitlistTuesdayEveningBadges.js';

describe('isTuesdayEveningLeague', () => {
  test('matches the play-in league', () => {
    expect(isTuesdayEveningLeague({ isPlayInBased: 1 })).toBe(true);
    expect(isTuesdayEveningLeague({ isPlayInBased: true })).toBe(true);
  });

  test('does not match other leagues', () => {
    expect(isTuesdayEveningLeague({ isPlayInBased: 0 })).toBe(false);
    expect(isTuesdayEveningLeague({ isPlayInBased: null })).toBe(false);
  });
});

describe('isTuesdayPlaydownTeam', () => {
  test('treats stored playdown, projected playdown, and ineligible single-returner as playdown', () => {
    expect(isTuesdayPlaydownTeam({ status: 'playdown' })).toBe(true);
    expect(isTuesdayPlaydownTeam({ status: 'pending', projectedStatus: 'projected_playdown' })).toBe(true);
    expect(isTuesdayPlaydownTeam({ status: 'pending', projectedStatus: 'ineligible_single_returner' })).toBe(true);
  });

  test('does not treat guaranteed, projected-in, or settled teams as playdown', () => {
    expect(isTuesdayPlaydownTeam({ status: 'pending', projectedStatus: 'guaranteed' })).toBe(false);
    expect(isTuesdayPlaydownTeam({ status: 'pending', projectedStatus: 'projected_in' })).toBe(false);
    expect(isTuesdayPlaydownTeam({ status: 'entered', projectedStatus: 'projected_playdown' })).toBe(false);
    expect(isTuesdayPlaydownTeam({ status: 'not_entered', projectedStatus: 'projected_playdown' })).toBe(false);
    expect(isTuesdayPlaydownTeam({ status: 'withdrawn' })).toBe(false);
  });
});

describe('resolveTuesdayEveningBadge', () => {
  const rosteredMemberIds = new Set([10, 11]);
  const playdownMemberIds = new Set([11, 20]);
  const topWaitlistIdByMember = new Map([
    [10, 5],
    [11, 7],
    [20, 5],
  ]);

  test('returns backup when this is a rostered member\'s #1 waitlist', () => {
    expect(
      resolveTuesdayEveningBadge({
        waitlistId: 5,
        memberIds: [10],
        rosteredMemberIds,
        playdownMemberIds,
        topWaitlistIdByMember,
      }),
    ).toBe('backup');
  });

  test('hides backup when the waitlist is not the member\'s #1 waitlist', () => {
    expect(
      resolveTuesdayEveningBadge({
        waitlistId: 6,
        memberIds: [10],
        rosteredMemberIds,
        playdownMemberIds,
        topWaitlistIdByMember,
      }),
    ).toBeNull();
  });

  test('returns backup on a team entry when it is any rostered member\'s #1 waitlist', () => {
    expect(
      resolveTuesdayEveningBadge({
        waitlistId: 7,
        memberIds: [10, 11],
        rosteredMemberIds,
        playdownMemberIds,
        topWaitlistIdByMember,
      }),
    ).toBe('backup');
  });

  test('returns playdown when a listed member is only on a playdown team', () => {
    expect(
      resolveTuesdayEveningBadge({
        waitlistId: 6,
        memberIds: [20],
        rosteredMemberIds,
        playdownMemberIds,
        topWaitlistIdByMember,
      }),
    ).toBe('playdown');
  });

  test('prefers backup over playdown on a #1 waitlist', () => {
    expect(
      resolveTuesdayEveningBadge({
        waitlistId: 7,
        memberIds: [11],
        rosteredMemberIds,
        playdownMemberIds,
        topWaitlistIdByMember,
      }),
    ).toBe('backup');
  });

  test('hides both badges when a rostered member is not on their #1 waitlist', () => {
    expect(
      resolveTuesdayEveningBadge({
        waitlistId: 5,
        memberIds: [11],
        rosteredMemberIds,
        playdownMemberIds,
        topWaitlistIdByMember,
      }),
    ).toBeNull();
  });

  test('returns null when no listed member is involved', () => {
    expect(
      resolveTuesdayEveningBadge({
        waitlistId: 5,
        memberIds: [99],
        rosteredMemberIds,
        playdownMemberIds,
        topWaitlistIdByMember,
      }),
    ).toBeNull();
  });
});
