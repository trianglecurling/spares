import { describe, expect, test } from 'bun:test';
import {
  volunteerProgramAppearsInDiscovery,
  volunteerProgramFirstShiftDate,
  volunteerProgramHasIneligibleCredentialRoles,
  volunteerProgramMissingCredentialNames,
  volunteerProgramHasOpenShifts,
  volunteerProgramLastShiftHasEnded,
  volunteerProgramShiftsForCaller,
  volunteerShiftsDistinctRoleCount,
  volunteerProgramSignupTotals,
  volunteerProgramVisibleGivenCredentials,
  volunteerSpotsStatusLabel,
  volunteerSpotsTotals,
  formatVolunteerDateOnly,
  formatVolunteerHoursLabel,
  formatVolunteerShiftCount,
  buildPastVolunteeringItems,
  summarizePastVolunteering,
  volunteerHourLogFieldErrorsFromUnknown,
  commitVolunteerHourLogHours,
  roundVolunteerHoursUp,
  VOLUNTEER_HOUR_LOG_MAX_MESSAGE,
  volunteerCredentialIsValidOn,
  volunteerShiftDayKey,
  volunteerShiftHasEnded,
  defaultVolunteerCreditHours,
  volunteerCreditHoursFromShift,
  compareVolunteerProgramsForList,
  volunteerProgramUiTerms,
  snapVolunteerCreditHours,
  maxVolunteerCreditHoursOnStep,
} from './volunteering';

describe('volunteerProgramShiftsForCaller', () => {
  const eligible = { callerHasCredentials: true };
  const ineligible = { callerHasCredentials: false };

  test('omits roles the caller cannot take', () => {
    expect(
      volunteerProgramShiftsForCaller({
        shifts: [
          { id: 1, roles: [eligible, ineligible] },
          { id: 2, roles: [ineligible] },
        ],
      })
    ).toEqual([{ id: 1, roles: [eligible] }]);
  });

  test('keeps ineligible roles for program managers', () => {
    expect(
      volunteerProgramShiftsForCaller({
        canManage: true,
        shifts: [
          { id: 1, roles: [eligible, ineligible] },
          { id: 2, roles: [ineligible] },
        ],
      })
    ).toEqual([
      { id: 1, roles: [eligible, ineligible] },
      { id: 2, roles: [ineligible] },
    ]);
  });

  test('returns no shifts when every role is ineligible', () => {
    expect(
      volunteerProgramShiftsForCaller({
        shifts: [{ id: 1, roles: [ineligible] }],
      })
    ).toEqual([]);
  });

  test('includes ineligible roles when asked to show them', () => {
    expect(
      volunteerProgramShiftsForCaller(
        {
          shifts: [
            { id: 1, roles: [eligible, ineligible] },
            { id: 2, roles: [ineligible] },
          ],
        },
        { includeIneligible: true }
      )
    ).toEqual([
      { id: 1, roles: [eligible, ineligible] },
      { id: 2, roles: [ineligible] },
    ]);
  });

  test('keeps ineligible roles the caller is already signed up for', () => {
    const signedUp = { callerHasCredentials: false, callerIsSignedUp: true };
    expect(
      volunteerProgramShiftsForCaller({
        shifts: [
          { id: 1, roles: [signedUp, ineligible] },
          { id: 2, roles: [ineligible] },
        ],
      })
    ).toEqual([{ id: 1, roles: [signedUp] }]);
  });
});

describe('volunteerProgramHasIneligibleCredentialRoles', () => {
  test('is true when any role is credential-gated for the caller', () => {
    expect(
      volunteerProgramHasIneligibleCredentialRoles({
        shifts: [{ roles: [{ callerHasCredentials: true }, { callerHasCredentials: false }] }],
      })
    ).toBe(true);
  });

  test('is false when every role is eligible', () => {
    expect(
      volunteerProgramHasIneligibleCredentialRoles({
        shifts: [{ roles: [{ callerHasCredentials: true }] }],
      })
    ).toBe(false);
  });

  test('is false when the only ineligible roles are ones the caller already signed up for', () => {
    expect(
      volunteerProgramHasIneligibleCredentialRoles({
        shifts: [
          {
            roles: [
              { callerHasCredentials: true },
              { callerHasCredentials: false, callerIsSignedUp: true },
            ],
          },
        ],
      })
    ).toBe(false);
  });
});

describe('volunteerProgramMissingCredentialNames', () => {
  const iceTech = { id: 1, name: 'Ice technician' };
  const firstAid = { id: 2, name: 'First aid' };
  const bar = { id: 3, name: 'Bar certified' };

  test('lists unique credentials required by hidden roles', () => {
    expect(
      volunteerProgramMissingCredentialNames({
        shifts: [
          {
            roles: [
              {
                callerHasCredentials: true,
                requiredCredentials: [],
              },
              {
                callerHasCredentials: false,
                requiredCredentials: [iceTech, firstAid],
              },
            ],
          },
          {
            roles: [
              {
                callerHasCredentials: false,
                requiredCredentials: [iceTech],
              },
            ],
          },
        ],
      })
    ).toEqual(['First aid', 'Ice technician']);
  });

  test('omits credentials the caller already holds via an eligible role', () => {
    expect(
      volunteerProgramMissingCredentialNames({
        shifts: [
          {
            roles: [
              {
                callerHasCredentials: true,
                requiredCredentials: [iceTech],
              },
              {
                callerHasCredentials: false,
                requiredCredentials: [iceTech, firstAid],
              },
            ],
          },
        ],
      })
    ).toEqual(['First aid']);
  });

  test('uses explicit held ids when provided', () => {
    expect(
      volunteerProgramMissingCredentialNames(
        {
          shifts: [
            {
              roles: [
                {
                  callerHasCredentials: true,
                  requiredCredentials: [],
                },
                {
                  callerHasCredentials: false,
                  requiredCredentials: [iceTech, bar],
                },
              ],
            },
          ],
        },
        [iceTech.id]
      )
    ).toEqual(['Bar certified']);
  });

  test('returns no names for program managers', () => {
    expect(
      volunteerProgramMissingCredentialNames({
        canManage: true,
        shifts: [
          {
            roles: [{ callerHasCredentials: false, requiredCredentials: [iceTech] }],
          },
        ],
      })
    ).toEqual([]);
  });
});

describe('volunteerShiftsDistinctRoleCount', () => {
  test('is 0 when there are no roles', () => {
    expect(volunteerShiftsDistinctRoleCount([])).toBe(0);
    expect(volunteerShiftsDistinctRoleCount([{ roles: [] }])).toBe(0);
  });

  test('counts the same role across shifts once', () => {
    expect(
      volunteerShiftsDistinctRoleCount([
        { roles: [{ roleId: 1 }] },
        { roles: [{ roleId: 1 }] },
      ])
    ).toBe(1);
  });

  test('counts different roles on one shift', () => {
    expect(
      volunteerShiftsDistinctRoleCount([{ roles: [{ roleId: 1 }, { roleId: 2 }] }])
    ).toBe(2);
  });
});

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

describe('volunteerSpotsStatusLabel', () => {
  test('is Full when no spots remain', () => {
    expect(volunteerSpotsStatusLabel(0, 4)).toBe('Full');
    expect(volunteerSpotsStatusLabel(0, 1)).toBe('Full');
  });

  test('uses 1 spot left! only when capacity is greater than 1', () => {
    expect(volunteerSpotsStatusLabel(1, 4)).toBe('1 spot left!');
    expect(volunteerSpotsStatusLabel(1, 2)).toBe('1 spot left!');
    expect(volunteerSpotsStatusLabel(1, 1)).toBe('1 open spot');
  });

  test('uses 2 spots left! only when capacity is greater than 2', () => {
    expect(volunteerSpotsStatusLabel(2, 4)).toBe('2 spots left!');
    expect(volunteerSpotsStatusLabel(2, 3)).toBe('2 spots left!');
    expect(volunteerSpotsStatusLabel(2, 2)).toBe('2 open spots');
  });

  test('uses n open spots for every other remaining count', () => {
    expect(volunteerSpotsStatusLabel(3, 4)).toBe('3 open spots');
    expect(volunteerSpotsStatusLabel(4, 4)).toBe('4 open spots');
  });
});

describe('volunteerSpotsTotals', () => {
  test('sums remaining spots across roles', () => {
    expect(
      volunteerSpotsTotals([
        { volunteersRegistered: 3, volunteersNeeded: 4 },
        { volunteersRegistered: 1, volunteersNeeded: 2 },
      ])
    ).toEqual({ remaining: 2, needed: 6 });
  });

  test('does not go below zero remaining', () => {
    expect(volunteerSpotsTotals([{ volunteersRegistered: 5, volunteersNeeded: 4 }])).toEqual({
      remaining: 0,
      needed: 4,
    });
  });
});

describe('formatVolunteerDateOnly', () => {
  test('formats a calendar date without shifting timezones', () => {
    expect(formatVolunteerDateOnly('2026-09-01')).toBe('Sep 1, 2026');
  });
});

describe('roundVolunteerHoursUp', () => {
  test('rounds up to the next half hour', () => {
    expect(roundVolunteerHoursUp(1.1)).toBe(1.5);
    expect(roundVolunteerHoursUp(1.5)).toBe(1.5);
  });
});

describe('commitVolunteerHourLogHours', () => {
  test('rounds partial increments up and rejects more than 8 hours', () => {
    expect(commitVolunteerHourLogHours(1.1)).toEqual({ hours: 1.5 });
    expect(commitVolunteerHourLogHours(8.1)).toEqual({
      hours: 8.1,
      error: VOLUNTEER_HOUR_LOG_MAX_MESSAGE,
    });
  });
});

describe('volunteerHourLogFieldErrorsFromUnknown', () => {
  test('reads field details from an API error', () => {
    expect(
      volunteerHourLogFieldErrorsFromUnknown({
        response: { data: { details: { hours: VOLUNTEER_HOUR_LOG_MAX_MESSAGE } } },
      })
    ).toEqual({ hours: VOLUNTEER_HOUR_LOG_MAX_MESSAGE });
  });

  test('reads additional-member details from an API error', () => {
    expect(
      volunteerHourLogFieldErrorsFromUnknown({
        response: { data: { details: { additionalMemberIds: 'Select valid members.' } } },
      })
    ).toEqual({ additionalMemberIds: 'Select valid members.' });
  });
});

describe('buildPastVolunteeringItems', () => {
  const signup = (overrides: { signupId: number; startDt: string; endDt: string }) => ({
    signupId: overrides.signupId,
    shiftRoleId: overrides.signupId,
    programId: 1,
    programTitle: 'Ice crew',
    location: null,
    roleId: 1,
    roleName: 'Timer',
    startDt: overrides.startDt,
    endDt: overrides.endDt,
    status: 'confirmed' as const,
    comments: null,
    canCancel: false,
  });

  const log = (overrides: { id: number; volunteerDate: string; hours: number }) => ({
    id: overrides.id,
    memberId: 1,
    memberName: 'Alex',
    volunteerDate: overrides.volunteerDate,
    hours: overrides.hours,
    description: 'Set up tables',
    createdByMemberId: 1,
    createdByMemberName: 'Alex',
    createdAt: '2026-10-12T12:00:00.000Z',
    updatedAt: '2026-10-12T12:00:00.000Z',
  });

  test('intersperses shifts and self-reported hours by date, newest first', () => {
    const items = buildPastVolunteeringItems(
      [
        signup({
          signupId: 1,
          startDt: '2026-10-10T18:00:00.000Z',
          endDt: '2026-10-10T20:00:00.000Z',
        }),
        signup({
          signupId: 2,
          startDt: '2026-10-14T18:00:00.000Z',
          endDt: '2026-10-14T21:00:00.000Z',
        }),
      ],
      [
        log({ id: 21, volunteerDate: '2026-10-12', hours: 1.5 }),
        log({ id: 22, volunteerDate: '2026-10-14', hours: 2 }),
      ]
    );
    expect(items.map((item) => item.kind === 'shift' ? `shift:${item.signup.signupId}` : `log:${item.log.id}`)).toEqual([
      'shift:2',
      'log:22',
      'log:21',
      'shift:1',
    ]);
  });

  test('summarizes shift count and combined hours', () => {
    const items = buildPastVolunteeringItems(
      [
        signup({
          signupId: 1,
          startDt: '2026-10-10T18:00:00.000Z',
          endDt: '2026-10-10T20:00:00.000Z',
        }),
      ],
      [log({ id: 21, volunteerDate: '2026-10-12', hours: 1.5 })]
    );
    expect(summarizePastVolunteering(items)).toEqual({ shifts: 1, hours: 3.5 });
    expect(formatVolunteerShiftCount(1)).toBe('1 shift');
    expect(formatVolunteerHoursLabel(3.5)).toBe('3.5 hours');
  });

  test('uses stored credit hours for shift totals', () => {
    const items = buildPastVolunteeringItems(
      [
        {
          ...signup({
            signupId: 1,
            startDt: '2026-10-10T18:00:00.000Z',
            endDt: '2026-10-10T20:00:00.000Z',
          }),
          creditHours: 0,
        },
      ],
      []
    );
    expect(summarizePastVolunteering(items)).toEqual({ shifts: 1, hours: 0 });
  });
});

describe('snapVolunteerCreditHours', () => {
  test('snaps to half hours and does not exceed duration', () => {
    expect(snapVolunteerCreditHours(1.1, 3)).toBe(1);
    expect(snapVolunteerCreditHours(1.4, 3)).toBe(1.5);
    expect(snapVolunteerCreditHours(2.9, 2.3)).toBe(2);
    expect(snapVolunteerCreditHours(-1, 3)).toBe(0);
  });

  test('maxVolunteerCreditHoursOnStep uses the 0.5 grid', () => {
    expect(maxVolunteerCreditHoursOnStep(2.3)).toBe(2);
    expect(maxVolunteerCreditHoursOnStep(3)).toBe(3);
    expect(maxVolunteerCreditHoursOnStep(0.3)).toBe(0);
  });
});

describe('defaultVolunteerCreditHours', () => {
  test('uses duration for volunteering and zero for general sign-ups', () => {
    expect(
      defaultVolunteerCreditHours(
        'volunteering',
        '2026-10-10T18:00:00.000Z',
        '2026-10-10T21:00:00.000Z'
      )
    ).toBe(3);
    expect(
      defaultVolunteerCreditHours(
        'general',
        '2026-10-10T18:00:00.000Z',
        '2026-10-10T21:00:00.000Z'
      )
    ).toBe(0);
  });

  test('prefers stored credit hours on a shift', () => {
    expect(
      volunteerCreditHoursFromShift({
        startDt: '2026-10-10T18:00:00.000Z',
        endDt: '2026-10-10T21:00:00.000Z',
        creditHours: 1,
      })
    ).toBe(1);
  });
});

describe('compareVolunteerProgramsForList', () => {
  const program = (
    title: string,
    priority: number | null,
    startDt?: string
  ) => ({
    title,
    priority,
    shifts: startDt ? [{ startDt }] : [],
  });

  test('sorts lower priority numbers first', () => {
    expect(
      compareVolunteerProgramsForList(program('B', 2), program('A', 1))
    ).toBeGreaterThan(0);
  });

  test('treats missing priority as last', () => {
    expect(
      compareVolunteerProgramsForList(program('Soon', null, '2026-08-01T12:00:00.000Z'), program('Numbered', 10))
    ).toBeGreaterThan(0);
  });
});

describe('volunteerProgramUiTerms', () => {
  test('uses lists and times for general sign-ups', () => {
    expect(volunteerProgramUiTerms('general')).toMatchObject({
      roleTab: 'Lists',
      shiftTab: 'Times',
      roleSingular: 'list',
      shiftSingular: 'time',
      addPeople: 'Add sign-ups',
      peopleFieldLabel: 'People',
    });
  });

  test('keeps roles and shifts for volunteering', () => {
    expect(volunteerProgramUiTerms('volunteering')).toMatchObject({
      roleTab: 'Roles',
      shiftTab: 'Shifts',
    });
  });
});
