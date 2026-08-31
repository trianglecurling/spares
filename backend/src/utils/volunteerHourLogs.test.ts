import { describe, expect, test } from 'bun:test';
import {
  isValidVolunteerHourIncrement,
  parseVolunteerHourLogDate,
  parseVolunteerHourLogDescription,
  parseVolunteerHourLogHours,
  parseVolunteerHourLogInput,
  roundVolunteerHoursUp,
  VolunteerHourLogValidationError,
  VOLUNTEER_HOUR_LOG_MAX_MESSAGE,
} from './volunteerHourLogs';

describe('isValidVolunteerHourIncrement', () => {
  test('accepts half-hour increments from 0.5 to 8', () => {
    expect(isValidVolunteerHourIncrement(0.5)).toBe(true);
    expect(isValidVolunteerHourIncrement(1)).toBe(true);
    expect(isValidVolunteerHourIncrement(7.5)).toBe(true);
    expect(isValidVolunteerHourIncrement(8)).toBe(true);
  });

  test('rejects out-of-range and non-increment values', () => {
    expect(isValidVolunteerHourIncrement(0)).toBe(false);
    expect(isValidVolunteerHourIncrement(0.25)).toBe(false);
    expect(isValidVolunteerHourIncrement(8.5)).toBe(false);
    expect(isValidVolunteerHourIncrement(Number.NaN)).toBe(false);
  });
});

describe('parseVolunteerHourLogDate', () => {
  test('accepts today and earlier dates', () => {
    expect(parseVolunteerHourLogDate('2026-08-30', '2026-08-30')).toBe('2026-08-30');
    expect(parseVolunteerHourLogDate('2026-01-15', '2026-08-30')).toBe('2026-01-15');
  });

  test('rejects future and invalid dates', () => {
    expect(() => parseVolunteerHourLogDate('2026-08-31', '2026-08-30')).toThrow(
      VolunteerHourLogValidationError
    );
    expect(() => parseVolunteerHourLogDate('2026-02-30', '2026-08-30')).toThrow(
      VolunteerHourLogValidationError
    );
    expect(() => parseVolunteerHourLogDate('yesterday', '2026-08-30')).toThrow(
      VolunteerHourLogValidationError
    );
  });
});

describe('roundVolunteerHoursUp', () => {
  test('rounds up to the next half hour', () => {
    expect(roundVolunteerHoursUp(1)).toBe(1);
    expect(roundVolunteerHoursUp(1.1)).toBe(1.5);
    expect(roundVolunteerHoursUp(1.5)).toBe(1.5);
    expect(roundVolunteerHoursUp(0.25)).toBe(0.5);
  });
});

describe('parseVolunteerHourLogHours', () => {
  test('normalizes valid hours and rounds up partial increments', () => {
    expect(parseVolunteerHourLogHours(2)).toBe(2);
    expect(parseVolunteerHourLogHours('1.5')).toBe(1.5);
    expect(parseVolunteerHourLogHours(1.1)).toBe(1.5);
  });

  test('rejects more than 8 hours with the max-report message', () => {
    try {
      parseVolunteerHourLogHours(8.1);
      throw new Error('expected validation to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(VolunteerHourLogValidationError);
      expect((err as VolunteerHourLogValidationError).details.hours).toBe(VOLUNTEER_HOUR_LOG_MAX_MESSAGE);
    }
  });
});

describe('parseVolunteerHourLogDescription', () => {
  test('trims a non-empty description', () => {
    expect(parseVolunteerHourLogDescription('  Ice maintenance  ')).toBe('Ice maintenance');
  });

  test('rejects empty descriptions', () => {
    expect(() => parseVolunteerHourLogDescription('   ')).toThrow(VolunteerHourLogValidationError);
  });
});

describe('parseVolunteerHourLogInput', () => {
  test('collects multiple field errors', () => {
    try {
      parseVolunteerHourLogInput({ volunteerDate: '', hours: 0, description: '' }, '2026-08-30');
      throw new Error('expected validation to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(VolunteerHourLogValidationError);
      expect((err as VolunteerHourLogValidationError).details.volunteerDate).toBeTruthy();
      expect((err as VolunteerHourLogValidationError).details.hours).toBeTruthy();
      expect((err as VolunteerHourLogValidationError).details.description).toBeTruthy();
    }
  });
});
