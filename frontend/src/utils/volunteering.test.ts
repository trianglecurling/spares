import { describe, expect, test } from 'bun:test';
import {
  volunteerProgramAppearsInDiscovery,
  volunteerProgramHasOpenShifts,
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
