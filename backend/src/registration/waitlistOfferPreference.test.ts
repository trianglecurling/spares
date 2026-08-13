import { describe, expect, test } from 'bun:test';
import {
  isEnteringPriorityRegistration,
  shouldResetWaitlistPreferenceForPriorityOpen,
  waitlistOfferPreferenceAfterRegistration,
} from './waitlistOfferPreference.js';

describe('waitlistOfferPreferenceAfterRegistration', () => {
  test('auto-accepts waitlists for leagues on the priority list', () => {
    expect(
      waitlistOfferPreferenceAfterRegistration({
        leagueId: 10,
        priorityLeagueIds: [10, 20],
      }),
    ).toBe('auto_accept');
  });

  test('auto-declines waitlists for leagues left off the priority list', () => {
    expect(
      waitlistOfferPreferenceAfterRegistration({
        leagueId: 30,
        priorityLeagueIds: [10, 20],
      }),
    ).toBe('auto_decline');
  });
});

describe('isEnteringPriorityRegistration', () => {
  test('is true when the window moves from closed or open into priority', () => {
    expect(isEnteringPriorityRegistration('closed', 'priority')).toBe(true);
    expect(isEnteringPriorityRegistration('open', 'priority')).toBe(true);
    expect(isEnteringPriorityRegistration(null, 'priority')).toBe(true);
  });

  test('is false when the window is already priority or leaves priority', () => {
    expect(isEnteringPriorityRegistration('priority', 'priority')).toBe(false);
    expect(isEnteringPriorityRegistration('priority', 'open')).toBe(false);
    expect(isEnteringPriorityRegistration('closed', 'open')).toBe(false);
  });
});

describe('shouldResetWaitlistPreferenceForPriorityOpen', () => {
  const openedAt = '2026-08-12T16:00:00.000Z';

  test('does not reset entries already set to ask', () => {
    expect(
      shouldResetWaitlistPreferenceForPriorityOpen({
        preference: 'ask',
        updatedAt: '2026-07-01T00:00:00.000Z',
        priorityOpenedAt: openedAt,
      }),
    ).toBe(false);
  });

  test('resets auto-accept and auto-decline entries last touched before priority opened', () => {
    expect(
      shouldResetWaitlistPreferenceForPriorityOpen({
        preference: 'auto_accept',
        updatedAt: '2026-08-01T00:00:00.000Z',
        priorityOpenedAt: openedAt,
      }),
    ).toBe(true);
    expect(
      shouldResetWaitlistPreferenceForPriorityOpen({
        preference: 'auto_decline',
        updatedAt: '2026-08-12T15:59:59.000Z',
        priorityOpenedAt: openedAt,
      }),
    ).toBe(true);
  });

  test('leaves entries that were confirmed at or after priority opened', () => {
    expect(
      shouldResetWaitlistPreferenceForPriorityOpen({
        preference: 'auto_accept',
        updatedAt: openedAt,
        priorityOpenedAt: openedAt,
      }),
    ).toBe(false);
    expect(
      shouldResetWaitlistPreferenceForPriorityOpen({
        preference: 'auto_decline',
        updatedAt: '2026-08-12T16:00:01.000Z',
        priorityOpenedAt: openedAt,
      }),
    ).toBe(false);
  });

  test('resets entries with an unparseable updated_at so year-round joins are not left auto-accepting', () => {
    expect(
      shouldResetWaitlistPreferenceForPriorityOpen({
        preference: 'auto_accept',
        updatedAt: null,
        priorityOpenedAt: openedAt,
      }),
    ).toBe(true);
  });
});
