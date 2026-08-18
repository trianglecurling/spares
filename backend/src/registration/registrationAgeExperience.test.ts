import { describe, expect, test } from 'bun:test';
import { experienceAllowsBasicIcePrivileges, isJuniorRecreationalEligible } from './registrationAgeExperience.js';

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

describe('experienceAllowsBasicIcePrivileges', () => {
  test('does not offer basic ice until a new curler reports at least one year', () => {
    expect(experienceAllowsBasicIcePrivileges('none_or_minimal')).toBe(false);
    expect(experienceAllowsBasicIcePrivileges('specified_years', 0.5)).toBe(false);
    expect(experienceAllowsBasicIcePrivileges('specified_years', null)).toBe(false);
    expect(experienceAllowsBasicIcePrivileges('specified_years', 1)).toBe(true);
    expect(experienceAllowsBasicIcePrivileges('specified_years', 2)).toBe(true);
    expect(experienceAllowsBasicIcePrivileges('known_existing')).toBe(true);
    expect(experienceAllowsBasicIcePrivileges(null)).toBe(true);
  });
});
