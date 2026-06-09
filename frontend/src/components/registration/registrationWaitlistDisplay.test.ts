import { describe, expect, test } from 'bun:test';
import {
  formatWaitlistPositionSuffix,
  projectedWaitlistPosition,
  waitlistEntryCountLabel,
  waitlistJoinOptionDescription,
} from './registrationViewEditShared';

describe('registration waitlist display helpers', () => {
  test('projected position is one more than the active entry count', () => {
    expect(projectedWaitlistPosition(0)).toBe(1);
    expect(projectedWaitlistPosition(4)).toBe(5);
  });

  test('formatWaitlistPositionSuffix uses actual position for existing entries', () => {
    expect(formatWaitlistPositionSuffix({ isExisting: true, position: 3, activeWaitlistEntryCount: 10 })).toBe(
      '(position #3)',
    );
  });

  test('formatWaitlistPositionSuffix uses projected position for new selections', () => {
    expect(formatWaitlistPositionSuffix({ isExisting: false, activeWaitlistEntryCount: 7 })).toBe('(position #8)');
  });

  test('waitlist join option description includes entry count', () => {
    expect(waitlistJoinOptionDescription({ activeWaitlistEntryCount: 1 }, 'Thursday evenings')).toBe(
      'Thursday evenings · 1 entry on waitlist',
    );
    expect(waitlistEntryCountLabel(3)).toBe('3 entries on waitlist');
  });
});
