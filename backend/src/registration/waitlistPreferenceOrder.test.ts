import { describe, expect, test } from 'bun:test';
import {
  canReorderWaitlistPreferenceDrop,
  clampWaitlistPreferenceOrder,
  insertWaitlistInPreferenceOrder,
  isWaitlistPreferenceOrderClamped,
} from './waitlistPreferenceOrder.js';

function entry(id: number, requiresByotRoster: boolean) {
  return { id, requiresByotRoster };
}

describe('waitlist preference order', () => {
  test('clamps rostered waitlists ahead of individual waitlists and keeps relative order', () => {
    expect(
      clampWaitlistPreferenceOrder([
        entry(1, false),
        entry(2, true),
        entry(3, false),
        entry(4, true),
      ]).map((row) => row.id),
    ).toEqual([2, 4, 1, 3]);
  });

  test('detects when a rostered waitlist sits behind an individual waitlist', () => {
    expect(isWaitlistPreferenceOrderClamped([entry(1, true), entry(2, false)])).toBe(true);
    expect(isWaitlistPreferenceOrderClamped([entry(1, false), entry(2, true)])).toBe(false);
    expect(isWaitlistPreferenceOrderClamped([entry(1, true), entry(2, true), entry(3, false)])).toBe(true);
  });

  test('blocks drag across the rostered / individual boundary', () => {
    expect(canReorderWaitlistPreferenceDrop(entry(1, true), entry(2, true))).toBe(true);
    expect(canReorderWaitlistPreferenceDrop(entry(1, false), entry(2, false))).toBe(true);
    expect(canReorderWaitlistPreferenceDrop(entry(1, true), entry(2, false))).toBe(false);
    expect(canReorderWaitlistPreferenceDrop(entry(1, false), entry(2, true))).toBe(false);
  });

  test('inserts a rostered waitlist after existing rostered waitlists', () => {
    expect(
      insertWaitlistInPreferenceOrder([entry(1, true), entry(2, false)], entry(3, true)).map((row) => row.id),
    ).toEqual([1, 3, 2]);
  });

  test('appends an individual waitlist at the end', () => {
    expect(
      insertWaitlistInPreferenceOrder([entry(1, true), entry(2, false)], entry(3, false)).map((row) => row.id),
    ).toEqual([1, 2, 3]);
  });
});
