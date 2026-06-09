import { describe, expect, test } from 'bun:test';
import {
  RegistrationShellValidationError,
  curlerDemographicsAreComplete,
  isMinorOnRegistrationDate,
  validateDemographics,
  validateGuardian,
} from './registrationShellService.js';

describe('registration shell validation', () => {
  test('demographics require valid email and non-future birth date', () => {
    expect(() =>
      validateDemographics({
        firstName: 'Jamie',
        lastName: 'Curler',
        dateOfBirth: '2999-01-01',
        email: 'jamie@example.com',
        phone: '919-555-0100',
        mailingAddress: '123 Curling Way',
        emergencyContactName: 'Alex Curler',
        emergencyContactPhone: '919-555-0110',
      })
    ).toThrow(RegistrationShellValidationError);

    expect(() =>
      validateDemographics({
        firstName: 'Jamie',
        lastName: 'Curler',
        dateOfBirth: '2000-01-01',
        email: 'not-an-email',
        phone: '919-555-0100',
        mailingAddress: '123 Curling Way',
        emergencyContactName: 'Alex Curler',
        emergencyContactPhone: '919-555-0110',
      })
    ).toThrow(RegistrationShellValidationError);
  });

  test('complete demographics and guardian fields pass validation', () => {
    expect(() =>
      validateDemographics({
        firstName: 'Jamie',
        lastName: 'Curler',
        dateOfBirth: '2000-01-01',
        email: 'jamie@example.com',
        phone: '919-555-0100',
        mailingAddress: '123 Curling Way',
        emergencyContactName: 'Alex Curler',
        emergencyContactPhone: '919-555-0110',
      })
    ).not.toThrow();

    expect(() =>
      validateGuardian({
        firstName: 'Pat',
        lastName: 'Guardian',
        email: 'pat@example.com',
        phone: '919-555-0120',
      })
    ).not.toThrow();
  });

  test('curlerDemographicsAreComplete detects complete and incomplete payloads', () => {
    expect(
      curlerDemographicsAreComplete({
        firstName: 'Jamie',
        lastName: 'Curler',
        dateOfBirth: '2000-01-01',
        email: 'jamie@example.com',
        phone: '919-555-0100',
        mailingAddress: '123 Curling Way',
        emergencyContactName: 'Alex Curler',
        emergencyContactPhone: '919-555-0110',
      }),
    ).toBe(true);

    expect(
      curlerDemographicsAreComplete({
        firstName: 'Jamie',
        lastName: 'Curler',
        dateOfBirth: '2000-01-01',
        email: 'jamie@example.com',
      }),
    ).toBe(false);
  });

  test('minor status is based on registration date', () => {
    const today = new Date();
    const minorYear = today.getUTCFullYear() - 17;
    const adultYear = today.getUTCFullYear() - 19;
    const month = String(today.getUTCMonth() + 1).padStart(2, '0');
    const day = String(today.getUTCDate()).padStart(2, '0');

    expect(isMinorOnRegistrationDate(`${minorYear}-${month}-${day}`)).toBe(true);
    expect(isMinorOnRegistrationDate(`${adultYear}-${month}-${day}`)).toBe(false);
  });
});
