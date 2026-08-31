import { describe, expect, test } from 'bun:test';
import {
  VOLUNTEER_REMINDER_MIN_SIGNUP_LEAD_MS,
  volunteerSignupQualifiesForReminder,
} from './volunteerReminders';

const SHIFT_START = '2026-09-10T18:00:00.000Z';

function hoursBeforeShift(hours: number): string {
  return new Date(Date.parse(SHIFT_START) - hours * 60 * 60 * 1000).toISOString();
}

describe('volunteerSignupQualifiesForReminder', () => {
  test('sends a reminder when signup was more than 72 hours before the shift', () => {
    expect(
      volunteerSignupQualifiesForReminder({
        signedUpAt: hoursBeforeShift(73),
        shiftStartDt: SHIFT_START,
      })
    ).toBe(true);
    expect(
      volunteerSignupQualifiesForReminder({
        signedUpAt: hoursBeforeShift(7 * 24),
        shiftStartDt: SHIFT_START,
      })
    ).toBe(true);
  });

  test('skips the reminder when signup was 72 hours or less before the shift', () => {
    expect(
      volunteerSignupQualifiesForReminder({
        signedUpAt: hoursBeforeShift(72),
        shiftStartDt: SHIFT_START,
      })
    ).toBe(false);
    expect(
      volunteerSignupQualifiesForReminder({
        signedUpAt: hoursBeforeShift(24),
        shiftStartDt: SHIFT_START,
      })
    ).toBe(false);
  });

  test('accepts Date values and SQLite-style datetime strings', () => {
    const signedUpAt = new Date(Date.parse(SHIFT_START) - VOLUNTEER_REMINDER_MIN_SIGNUP_LEAD_MS - 1);
    expect(
      volunteerSignupQualifiesForReminder({
        signedUpAt,
        shiftStartDt: new Date(SHIFT_START),
      })
    ).toBe(true);
    expect(
      volunteerSignupQualifiesForReminder({
        signedUpAt: hoursBeforeShift(7 * 24).replace('T', ' ').replace('.000Z', ''),
        shiftStartDt: SHIFT_START,
      })
    ).toBe(true);
  });

  test('skips when either timestamp is missing or invalid', () => {
    expect(
      volunteerSignupQualifiesForReminder({
        signedUpAt: null,
        shiftStartDt: SHIFT_START,
      })
    ).toBe(false);
    expect(
      volunteerSignupQualifiesForReminder({
        signedUpAt: hoursBeforeShift(80),
        shiftStartDt: 'not-a-date',
      })
    ).toBe(false);
  });
});
