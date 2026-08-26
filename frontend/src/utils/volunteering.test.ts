import { describe, expect, test } from 'bun:test';
import {
  volunteerProgramAppearsInDiscovery,
  volunteerProgramFirstShiftDate,
  volunteerProgramHasOpenShifts,
  volunteerProgramLastShiftHasEnded,
  volunteerProgramSignupTotals,
  volunteerProgramVisibleGivenCredentials,
  formatVolunteerDateOnly,
  volunteerCredentialIsValidOn,
  volunteerShiftDayKey,
  volunteerShiftHasEnded,
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

describe('volunteerProgramSignupTotals', () => {
  test('sums confirmed sign-ups and seats needed across shift roles', () => {
    expect(
      volunteerProgramSignupTotals({
        shifts: [
          {
            roles: [
              { volunteersRegistered: 2, volunteersNeeded: 4 },
              { volunteersRegistered: 1, volunteersNeeded: 1 },
            ],
          },
          {
            roles: [{ volunteersRegistered: 0, volunteersNeeded: 3 }],
          },
        ],
      })
    ).toEqual({ signedUp: 3, needed: 8 });
  });

  test('is 0/0 when there are no shift roles', () => {
    expect(volunteerProgramSignupTotals({ shifts: [] })).toEqual({ signedUp: 0, needed: 0 });
    expect(volunteerProgramSignupTotals({ shifts: [{ roles: [] }] })).toEqual({
      signedUp: 0,
      needed: 0,
    });
  });

  test('omits ended shifts when a later shift remains', () => {
    expect(
      volunteerProgramSignupTotals(
        {
          shifts: [
            {
              endDt: '2026-08-01T12:00:00.000Z',
              roles: [{ volunteersRegistered: 4, volunteersNeeded: 4 }],
            },
            {
              endDt: '2026-09-01T12:00:00.000Z',
              roles: [{ volunteersRegistered: 1, volunteersNeeded: 3 }],
            },
          ],
        },
        '2026-08-15T00:00:00.000Z'
      )
    ).toEqual({ signedUp: 1, needed: 3 });
  });

  test('keeps historical totals when every shift has ended', () => {
    expect(
      volunteerProgramSignupTotals(
        {
          shifts: [
            {
              endDt: '2026-08-01T12:00:00.000Z',
              roles: [{ volunteersRegistered: 4, volunteersNeeded: 4 }],
            },
          ],
        },
        '2026-08-15T00:00:00.000Z'
      )
    ).toEqual({ signedUp: 4, needed: 4 });
  });
});

describe('volunteerShiftHasEnded', () => {
  test('is past only after the shift end', () => {
    expect(volunteerShiftHasEnded('2026-08-15T18:00:00.000Z', '2026-08-15T17:59:59.000Z')).toBe(
      false
    );
    expect(volunteerShiftHasEnded('2026-08-15T18:00:00.000Z', '2026-08-15T18:00:00.000Z')).toBe(
      false
    );
    expect(volunteerShiftHasEnded('2026-08-15T18:00:00.000Z', '2026-08-15T18:00:01.000Z')).toBe(
      true
    );
  });
});

describe('volunteerProgramLastShiftHasEnded', () => {
  test('is false when there are no shifts', () => {
    expect(volunteerProgramLastShiftHasEnded({ shifts: [] }, '2026-08-15T00:00:00.000Z')).toBe(
      false
    );
  });

  test('uses the latest shift end, not array order', () => {
    expect(
      volunteerProgramLastShiftHasEnded(
        {
          shifts: [
            { endDt: '2026-09-01T12:00:00.000Z' },
            { endDt: '2026-08-01T12:00:00.000Z' },
          ],
        },
        '2026-08-15T00:00:00.000Z'
      )
    ).toBe(false);
    expect(
      volunteerProgramLastShiftHasEnded(
        {
          shifts: [
            { endDt: '2026-09-01T12:00:00.000Z' },
            { endDt: '2026-08-01T12:00:00.000Z' },
          ],
        },
        '2026-09-01T12:00:01.000Z'
      )
    ).toBe(true);
  });
});

describe('volunteerProgramFirstShiftDate', () => {
  test('returns null when there are no shifts', () => {
    expect(volunteerProgramFirstShiftDate({ shifts: [] })).toBeNull();
  });

  test('uses the earliest shift start, not array order', () => {
    expect(
      volunteerProgramFirstShiftDate({
        shifts: [
          { startDt: '2026-10-02T18:00:00.000Z' },
          { startDt: '2026-09-01T12:00:00.000Z' },
        ],
      })
    ).toBe(volunteerShiftDayKey('2026-09-01T12:00:00.000Z'));
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

describe('volunteerProgramVisibleGivenCredentials', () => {
  const iceTech = { id: 1 };
  const firstAid = { id: 2 };
  const bar = { id: 3 };

  test('keeps programs with no roles', () => {
    expect(volunteerProgramVisibleGivenCredentials({ roles: [] }, [])).toBe(true);
  });

  test('keeps programs that have any role with no credential requirement', () => {
    expect(
      volunteerProgramVisibleGivenCredentials(
        {
          roles: [{ requiredCredentials: [iceTech] }, { requiredCredentials: [] }],
        },
        []
      )
    ).toBe(true);
  });

  test('hides programs when the member does not qualify for any role', () => {
    expect(
      volunteerProgramVisibleGivenCredentials(
        {
          roles: [{ requiredCredentials: [iceTech] }, { requiredCredentials: [firstAid] }],
        },
        [bar.id]
      )
    ).toBe(false);
  });

  test('shows programs when the member qualifies for at least one role', () => {
    expect(
      volunteerProgramVisibleGivenCredentials(
        {
          roles: [{ requiredCredentials: [iceTech] }, { requiredCredentials: [firstAid] }],
        },
        [firstAid.id]
      )
    ).toBe(true);
  });

  test('hides a multi-credential role when the member holds only some of its required credentials', () => {
    expect(
      volunteerProgramVisibleGivenCredentials(
        {
          roles: [{ requiredCredentials: [iceTech, firstAid] }],
        },
        [iceTech.id]
      )
    ).toBe(false);
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
