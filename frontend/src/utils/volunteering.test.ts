import { describe, expect, test } from 'bun:test';
import {
  volunteerProgramAppearsInDiscovery,
  volunteerProgramHasOpenShifts,
  formatVolunteerDateOnly,
  volunteerCredentialIsValidOn,
} from './volunteering';

describe('volunteerProgramHasOpenShifts', () => {
  test('is false when there are no shifts', () => {
    expect(volunteerProgramHasOpenShifts({ shifts: [] })).toBe(false);
  });

  test('is false when shifts have no roles', () => {
    expect(volunteerProgramHasOpenShifts({ shifts: [{ roles: [] }] })).toBe(false);
  });

  test('is true when any shift has a role', () => {
    expect(
      volunteerProgramHasOpenShifts({
        shifts: [{ roles: [] }, { roles: [{ id: 1 }] }],
      })
    ).toBe(true);
  });
});

describe('volunteerProgramAppearsInDiscovery', () => {
  test('includes programs with no roles even without shifts', () => {
    expect(volunteerProgramAppearsInDiscovery({ roles: [], shifts: [] })).toBe(true);
  });

  test('hides shift-based programs until they have an open shift', () => {
    expect(
      volunteerProgramAppearsInDiscovery({
        roles: [{ id: 1 }],
        shifts: [],
      })
    ).toBe(false);
  });

  test('includes programs with an open shift', () => {
    expect(
      volunteerProgramAppearsInDiscovery({
        roles: [{ id: 1 }],
        shifts: [{ roles: [{ id: 1 }] }],
      })
    ).toBe(true);
  });
});

describe('volunteerCredentialIsValidOn', () => {
  test('treats a missing expiration as always valid', () => {
    expect(volunteerCredentialIsValidOn(null, '2026-08-24')).toBe(true);
    expect(volunteerCredentialIsValidOn('', '2026-08-24')).toBe(true);
  });

  test('is valid through the expiration date', () => {
    expect(volunteerCredentialIsValidOn('2026-09-01', '2026-09-01')).toBe(true);
    expect(volunteerCredentialIsValidOn('2026-09-01', '2026-09-02')).toBe(false);
  });
});

describe('formatVolunteerDateOnly', () => {
  test('formats a calendar date without shifting timezones', () => {
    expect(formatVolunteerDateOnly('2026-09-01')).toBe('Sep 1, 2026');
  });
});
