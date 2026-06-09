import { describe, expect, test } from 'bun:test';
import {
  isValidHalfYearExperienceValue,
  normalizeHalfYearExperienceValue,
  validateHalfYearExperienceValue,
} from './curlingExperienceYears.js';

describe('curlingExperienceYears validation', () => {
  test('accepts whole numbers and half years below 100', () => {
    expect(isValidHalfYearExperienceValue(0)).toBe(true);
    expect(isValidHalfYearExperienceValue(2)).toBe(true);
    expect(isValidHalfYearExperienceValue(2.5)).toBe(true);
    expect(isValidHalfYearExperienceValue(99.5)).toBe(true);
  });

  test('rejects invalid increments and out-of-range values', () => {
    expect(isValidHalfYearExperienceValue(2.25)).toBe(false);
    expect(isValidHalfYearExperienceValue(-0.5)).toBe(false);
    expect(isValidHalfYearExperienceValue(100)).toBe(false);
  });

  test('validateHalfYearExperienceValue returns field-specific messages', () => {
    expect(validateHalfYearExperienceValue(2.25, 'Minimum experience years')).toContain('.5');
    expect(validateHalfYearExperienceValue(null, 'Minimum experience years')).toBeUndefined();
  });

  test('normalizeHalfYearExperienceValue rounds to nearest half year', () => {
    expect(normalizeHalfYearExperienceValue(3.499)).toBe(3.5);
    expect(normalizeHalfYearExperienceValue(3.501)).toBe(3.5);
  });
});
