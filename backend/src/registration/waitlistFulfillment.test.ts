import { describe, expect, test } from 'bun:test';
import type { RegistrationContext } from './registrationContext.js';
import { league, registrationContext, selection } from './registrationTestFixtures.js';
import {
  addWaitlistPriorityLeagueIds,
  applyAddWaitlistPriorityRanks,
  inferDefaultDesiredAddWaitlistLeagueCount,
  maxDesiredAddWaitlistLeagueCount,
  remainingFirstTwoSlots,
  requiresWaitlistFulfillmentPreferences,
  validateWaitlistFulfillment,
} from './waitlistFulfillment.js';

function waitlistContext(overrides: Partial<RegistrationContext> = {}): RegistrationContext {
  const friday = league({ id: 11, name: 'Friday League' });
  const thursday = league({ id: 12, name: 'Thursday League' });
  return registrationContext({
    activeLeagueIds: [],
    leagues: {
      [friday.id]: friday,
      [thursday.id]: thursday,
    },
    selections: [
      selection({ selectionType: 'waitlist_add', leagueId: friday.id, rank: 1 }),
      selection({ selectionType: 'waitlist_add', leagueId: thursday.id, rank: 2 }),
    ],
    desiredAddWaitlistLeagueCount: 1,
    ...overrides,
  });
}

describe('waitlist fulfillment preferences', () => {
  test('requires preferences only when two or more ADD waitlists are selected', () => {
    const oneWaitlist = registrationContext({
      selections: [selection({ selectionType: 'waitlist_add', leagueId: 1 })],
    });
    expect(requiresWaitlistFulfillmentPreferences(oneWaitlist)).toBe(false);
    expect(requiresWaitlistFulfillmentPreferences(waitlistContext())).toBe(true);
    expect(
      validateWaitlistFulfillment(oneWaitlist, 1).map((error) => error.code),
    ).toContain('waitlist_fulfillment_not_applicable');
  });

  test('zero-league members with two ADD waitlists may choose one or two leagues', () => {
    const context = waitlistContext();
    expect(remainingFirstTwoSlots(context)).toBe(2);
    expect(maxDesiredAddWaitlistLeagueCount(context)).toBe(2);
    expect(inferDefaultDesiredAddWaitlistLeagueCount(context)).toBe(2);
    expect(validateWaitlistFulfillment(context, 1)).toHaveLength(0);
    expect(validateWaitlistFulfillment(context, 2)).toHaveLength(0);
    expect(validateWaitlistFulfillment(context, 3).map((error) => error.code)).toContain('waitlist_fulfillment_count_invalid');
  });

  test('one-league members are limited to one desired waitlist league', () => {
    const context = waitlistContext({
      activeLeagueIds: [99],
      desiredAddWaitlistLeagueCount: 1,
    });
    expect(remainingFirstTwoSlots(context)).toBe(1);
    expect(maxDesiredAddWaitlistLeagueCount(context)).toBe(1);
    expect(validateWaitlistFulfillment(context, 1)).toHaveLength(0);
    expect(validateWaitlistFulfillment(context, 2).map((error) => error.code)).toContain('waitlist_fulfillment_count_invalid');
  });

  test('priority ranks must be unique and contiguous', () => {
    const context = waitlistContext({
      selections: [
        selection({ selectionType: 'waitlist_add', leagueId: 11, rank: 1 }),
        selection({ selectionType: 'waitlist_add', leagueId: 12 }),
      ],
      desiredAddWaitlistLeagueCount: 1,
    });
    expect(validateWaitlistFulfillment(context, 1).map((error) => error.code)).toContain('waitlist_fulfillment_priority_required');

    const invalidOrder = waitlistContext({
      selections: [
        selection({ selectionType: 'waitlist_add', leagueId: 11, rank: 1 }),
        selection({ selectionType: 'waitlist_add', leagueId: 12, rank: 3 }),
      ],
      desiredAddWaitlistLeagueCount: 1,
    });
    expect(validateWaitlistFulfillment(invalidOrder, 1).map((error) => error.code)).toContain('waitlist_fulfillment_priority_invalid');
  });

  test('applyAddWaitlistPriorityRanks and addWaitlistPriorityLeagueIds stay aligned', () => {
    const context = waitlistContext();
    const ranked = applyAddWaitlistPriorityRanks(context.selections, [12, 11]);
    expect(addWaitlistPriorityLeagueIds({ ...context, selections: ranked })).toEqual([12, 11]);
    expect(ranked.find((item) => item.leagueId === 12)?.rank).toBe(1);
    expect(ranked.find((item) => item.leagueId === 11)?.rank).toBe(2);
  });
});
