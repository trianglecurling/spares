import { describe, expect, test } from 'bun:test';
import {
  waitlistOfferPreferenceForLeagues,
  waitlistOfferPreferenceFromPriorityList,
} from './waitlistOfferPreference.js';

describe('waitlistOfferPreferenceFromPriorityList', () => {
  test('auto-accepts waitlists for leagues on the priority list', () => {
    expect(
      waitlistOfferPreferenceFromPriorityList({
        leagueId: 10,
        priorityLeagueIds: [10, 20],
      }),
    ).toBe('auto_accept');
  });

  test('auto-declines waitlists for leagues left off the priority list', () => {
    expect(
      waitlistOfferPreferenceFromPriorityList({
        leagueId: 30,
        priorityLeagueIds: [10, 20],
      }),
    ).toBe('auto_decline');
  });

  test('auto-declines when the member has no registration list', () => {
    expect(
      waitlistOfferPreferenceFromPriorityList({
        leagueId: 10,
        priorityLeagueIds: [],
      }),
    ).toBe('auto_decline');
  });
});

describe('waitlistOfferPreferenceForLeagues', () => {
  test('auto-accepts when any attached league is on the list', () => {
    expect(
      waitlistOfferPreferenceForLeagues({
        leagueIds: [20, 30],
        priorityLeagueIds: [10, 30],
      }),
    ).toBe('auto_accept');
  });

  test('auto-declines when none of the attached leagues are on the list', () => {
    expect(
      waitlistOfferPreferenceForLeagues({
        leagueIds: [20, 30],
        priorityLeagueIds: [10],
      }),
    ).toBe('auto_decline');
  });
});
