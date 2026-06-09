import { describe, expect, test } from 'bun:test';
import { isJuniorRecreationalEligible } from './registrationAgeExperience.js';

describe('Junior Recreational age eligibility', () => {
  test('allows curlers age 21 or younger', () => {
    const today = new Date();
    const eligibleYear = today.getUTCFullYear() - 21;
    const ineligibleYear = today.getUTCFullYear() - 22;
    const month = String(today.getUTCMonth() + 1).padStart(2, '0');
    const day = String(today.getUTCDate()).padStart(2, '0');

    expect(isJuniorRecreationalEligible(`${eligibleYear}-${month}-${day}`)).toBe(true);
    expect(isJuniorRecreationalEligible(`${ineligibleYear}-${month}-${day}`)).toBe(false);
  });
});
