import { describe, expect, test } from 'bun:test';
import { icePurposeLabel, overlapsGroupEventRiskWindow } from './iceBookingShared';

/** 2026-11-23 is a Monday. */
function at(day: number, hours: number, minutes = 0): Date {
  return new Date(2026, 10, day, hours, minutes);
}

describe('overlapsGroupEventRiskWindow', () => {
  test('weekday bookings inside 10am–4pm are at risk', () => {
    expect(overlapsGroupEventRiskWindow(at(23, 9), at(23, 10, 15))).toBe(true);
    expect(overlapsGroupEventRiskWindow(at(23, 15, 45), at(23, 17))).toBe(true);
  });

  test('weekday bookings that only touch the window edges are not', () => {
    expect(overlapsGroupEventRiskWindow(at(23, 9), at(23, 10))).toBe(false);
    expect(overlapsGroupEventRiskWindow(at(23, 16), at(23, 18))).toBe(false);
  });

  test('Saturdays use 2:30pm–5pm', () => {
    expect(overlapsGroupEventRiskWindow(at(28, 13), at(28, 14, 30))).toBe(false);
    expect(overlapsGroupEventRiskWindow(at(28, 14), at(28, 15))).toBe(true);
  });

  test('Sundays are never at risk', () => {
    expect(overlapsGroupEventRiskWindow(at(29, 12), at(29, 14))).toBe(false);
  });

  test('a booking that runs to midnight ends at the end of the day', () => {
    expect(overlapsGroupEventRiskWindow(at(23, 21), at(24, 0))).toBe(false);
    expect(overlapsGroupEventRiskWindow(at(23, 15), at(24, 0))).toBe(true);
  });
});

describe('icePurposeLabel', () => {
  test('includes the description for other', () => {
    expect(icePurposeLabel({ purpose: 'other', purposeOther: 'Coaching' })).toBe('Other: Coaching');
  });

  test('includes guest names on legacy guest bookings', () => {
    expect(icePurposeLabel({ purpose: 'guests_new', guestNames: 'Ann, Bo' })).toBe(
      'Bringing guests: new curlers (Ann, Bo)'
    );
  });
});
