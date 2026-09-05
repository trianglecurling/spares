import { describe, expect, test } from 'bun:test';
import {
  isTopRankedWaitlist,
  isTuesdayEveningLeague,
  isTuesdayPlaydownTeam,
  resolveTuesdayEveningBadge,
} from './waitlistTuesdayEveningBadges.js';

describe('isTuesdayEveningLeague', () => {
  test('matches the Tuesday Evening name regardless of play-in flag', () => {
    expect(isTuesdayEveningLeague({ name: 'Tuesday Evening', isPlayInBased: 0 })).toBe(true);
    expect(isTuesdayEveningLeague({ name: 'Fall Tuesday Evening League', isPlayInBased: false })).toBe(true);
  });

  test('matches a Tuesday play-in league if the display name varies', () => {
    expect(isTuesdayEveningLeague({ name: 'Tuesday Competitive', isPlayInBased: 1 })).toBe(true);
    expect(isTuesdayEveningLeague({ name: 'Tuesday Competitive', isPlayInBased: 0 })).toBe(false);
  });

  test('does not match other weeknights', () => {
    expect(isTuesdayEveningLeague({ name: 'Thursday Evening', isPlayInBased: 0 })).toBe(false);
    expect(isTuesdayEveningLeague({ name: 'Monday Night', isPlayInBased: 1 })).toBe(false);
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

describe('isTopRankedWaitlist', () => {
  test('only rank 1 counts', () => {
    expect(isTopRankedWaitlist(1)).toBe(true);
    expect(isTopRankedWaitlist(2)).toBe(false);
    expect(isTopRankedWaitlist(null)).toBe(false);
    expect(isTopRankedWaitlist(undefined)).toBe(false);
  });
});

describe('resolveTuesdayEveningBadge', () => {
  const rosteredMemberIds = new Set([10, 11]);
  const playdownMemberIds = new Set([11, 20]);

  test('returns backup when a listed member is rostered on a #1 waitlist', () => {
    expect(
      resolveTuesdayEveningBadge({
        memberIds: [10],
        rosteredMemberIds,
        playdownMemberIds,
        isTopRankedWaitlist: true,
      }),
    ).toBe('backup');
  });

  test('hides backup when the waitlist is not the member\'s #1 preference', () => {
    expect(
      resolveTuesdayEveningBadge({
        memberIds: [10],
        rosteredMemberIds,
        playdownMemberIds,
        isTopRankedWaitlist: false,
      }),
    ).toBeNull();
  });

  test('returns playdown when a listed member is only on a playdown team', () => {
    expect(
      resolveTuesdayEveningBadge({
        memberIds: [20],
        rosteredMemberIds,
        playdownMemberIds,
        isTopRankedWaitlist: false,
      }),
    ).toBe('playdown');
  });

  test('prefers backup over playdown on a #1 waitlist', () => {
    expect(
      resolveTuesdayEveningBadge({
        memberIds: [11],
        rosteredMemberIds,
        playdownMemberIds,
        isTopRankedWaitlist: true,
      }),
    ).toBe('backup');
  });

  test('hides both badges when a rostered member is not on their #1 waitlist', () => {
    expect(
      resolveTuesdayEveningBadge({
        memberIds: [11],
        rosteredMemberIds,
        playdownMemberIds,
        isTopRankedWaitlist: false,
      }),
    ).toBeNull();
  });

  test('returns null when no listed member is involved', () => {
    expect(
      resolveTuesdayEveningBadge({
        memberIds: [99],
        rosteredMemberIds,
        playdownMemberIds,
        isTopRankedWaitlist: true,
      }),
    ).toBeNull();
  });
});
