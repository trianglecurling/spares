import { describe, expect, test } from 'bun:test';
import {
  formatEstimatedTotalRange,
  formatWaitlistPositionSuffix,
  projectedWaitlistPosition,
  waitlistEntryCountLabel,
} from './registrationViewEditShared';

const currency = (amountMinor: number) => `$${(amountMinor / 100).toFixed(2)}`;

describe('registration waitlist display helpers', () => {
  test('projected position is one more than the active entry count', () => {
    expect(projectedWaitlistPosition(0)).toBe(1);
    expect(projectedWaitlistPosition(4)).toBe(5);
  });

  test('an unknown entry count still projects the first position', () => {
    expect(projectedWaitlistPosition(null)).toBe(1);
  });

  test('an existing entry shows its actual position', () => {
    expect(formatWaitlistPositionSuffix({ isExisting: true, position: 3, activeWaitlistEntryCount: 10 })).toBe(
      '(position #3)',
    );
  });

  test('a league the registrant has not joined yet shows the projected position', () => {
    expect(formatWaitlistPositionSuffix({ isExisting: false, activeWaitlistEntryCount: 7 })).toBe('(position #8)');
  });

  test('no position is shown when nothing is known about the queue', () => {
    expect(formatWaitlistPositionSuffix({ isExisting: true })).toBeNull();
  });

  test('the entry count label is singular for one entry', () => {
    expect(waitlistEntryCountLabel(1)).toBe('1 entry on waitlist');
    expect(waitlistEntryCountLabel(3)).toBe('3 entries on waitlist');
  });
});

describe('estimated total range formatting', () => {
  test('a settled total is shown as a single amount', () => {
    expect(formatEstimatedTotalRange(12500, 12500, currency)).toBe('$125.00');
  });

  test('an unsettled total is shown as a range', () => {
    expect(formatEstimatedTotalRange(12500, 42500, currency)).toBe('$125.00 – $425.00');
  });
});
