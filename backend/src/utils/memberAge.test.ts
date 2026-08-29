import { describe, expect, test } from 'bun:test';
import {
  DATE_OF_BIRTH_FUTURE_MESSAGE,
  DATE_OF_BIRTH_INVALID_MESSAGE,
  dateOfBirthValidationMessage,
  isValidDateOnly,
  utcDateOnly,
} from './memberAge.js';

describe('date of birth validation', () => {
  const asOf = new Date('2026-08-28T15:00:00.000Z');

  test('utcDateOnly uses the UTC calendar day', () => {
    expect(utcDateOnly(asOf)).toBe('2026-08-28');
  });

  test('accepts a real past date', () => {
    expect(dateOfBirthValidationMessage('1990-01-01', asOf)).toBeNull();
    expect(dateOfBirthValidationMessage('2026-08-28', asOf)).toBeNull();
  });

  test('rejects dates in the future', () => {
    expect(dateOfBirthValidationMessage('2026-08-29', asOf)).toBe(DATE_OF_BIRTH_FUTURE_MESSAGE);
    expect(dateOfBirthValidationMessage('2963-01-15', asOf)).toBe(DATE_OF_BIRTH_FUTURE_MESSAGE);
  });

  test('rejects malformed and overflow calendar dates', () => {
    expect(isValidDateOnly('2026-02-31')).toBe(false);
    expect(dateOfBirthValidationMessage('not-a-date', asOf)).toBe(DATE_OF_BIRTH_INVALID_MESSAGE);
    expect(dateOfBirthValidationMessage('2026-02-31', asOf)).toBe(DATE_OF_BIRTH_INVALID_MESSAGE);
    expect(dateOfBirthValidationMessage('2963-13-01', asOf)).toBe(DATE_OF_BIRTH_INVALID_MESSAGE);
  });

  test('ignores empty values so callers can decide requiredness', () => {
    expect(dateOfBirthValidationMessage('', asOf)).toBeNull();
    expect(dateOfBirthValidationMessage(null, asOf)).toBeNull();
    expect(dateOfBirthValidationMessage(undefined, asOf)).toBeNull();
  });
});
