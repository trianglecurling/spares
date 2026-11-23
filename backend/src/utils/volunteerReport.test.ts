import { describe, expect, test } from 'bun:test';
import {
  VolunteerReportValidationError,
  buildVolunteerReportCsv,
  collectVolunteerReportActivities,
  parseVolunteerReportRange,
  volunteerReportFilename,
  type VolunteerReportHourLogSource,
  type VolunteerReportSignupSource,
} from './volunteerReport';

const nowIso = '2020-02-01T12:00:00.000Z';
const today = '2020-02-01';

function signup(
  overrides: Partial<VolunteerReportSignupSource> &
    Pick<VolunteerReportSignupSource, 'signupId' | 'shiftId' | 'date'>
): VolunteerReportSignupSource {
  return {
    memberId: 1,
    memberName: 'John Doe',
    startDt: `${overrides.date}T15:00:00.000Z`,
    roleName: 'Helper',
    creditHours: 3,
    signupKind: 'volunteering',
    status: 'confirmed',
    ...overrides,
  };
}

function hourLog(
  overrides: Partial<VolunteerReportHourLogSource> & Pick<VolunteerReportHourLogSource, 'id' | 'date'>
): VolunteerReportHourLogSource {
  return {
    memberId: 1,
    memberName: 'John Doe',
    hours: 2,
    description: 'Admin work',
    ...overrides,
  };
}

function csvBody(activities: ReturnType<typeof collectVolunteerReportActivities>): string {
  return buildVolunteerReportCsv(activities).replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
}

describe('parseVolunteerReportRange', () => {
  test('accepts an inclusive date range', () => {
    expect(parseVolunteerReportRange('2020-01-01', '2020-01-31')).toEqual({
      from: '2020-01-01',
      to: '2020-01-31',
    });
  });

  test('rejects a missing or inverted range', () => {
    expect(() => parseVolunteerReportRange('', '2020-01-31')).toThrow(VolunteerReportValidationError);
    try {
      parseVolunteerReportRange('2020-02-01', '2020-01-01');
    } catch (err) {
      expect(err).toBeInstanceOf(VolunteerReportValidationError);
      expect((err as VolunteerReportValidationError).details.to).toBe(
        'End date must be on or after the start date.'
      );
    }
    expect(() => parseVolunteerReportRange('2020-02-31', '2020-03-01')).toThrow(
      VolunteerReportValidationError
    );
  });
});

describe('collectVolunteerReportActivities', () => {
  test('groups members and lists shifts with self-reported hours', () => {
    const activities = collectVolunteerReportActivities({
      from: '2020-01-01',
      to: '2020-01-31',
      today,
      nowIso,
      signups: [
        signup({ signupId: 1, shiftId: 1, date: '2020-01-01', roleName: 'Helper', creditHours: 3 }),
        signup({
          signupId: 2,
          memberId: 2,
          memberName: 'Jill Chang',
          shiftId: 2,
          date: '2020-01-02',
          roleName: 'Food prep',
          creditHours: 5,
        }),
        signup({
          signupId: 3,
          memberId: 2,
          memberName: 'Jill Chang',
          shiftId: 3,
          date: '2020-01-05',
          roleName: 'Food prep',
          creditHours: 5,
        }),
        signup({
          signupId: 4,
          memberId: 3,
          memberName: 'Joseph Gardner',
          shiftId: 4,
          date: '2020-01-19',
          roleName: 'Tax advice',
          creditHours: 1,
        }),
      ],
      hourLogs: [
        hourLog({ id: 1, date: '2020-01-10', hours: 2, description: 'Admin work' }),
        hourLog({ id: 2, date: '2020-01-12', hours: 2, description: 'Cleaning' }),
        hourLog({
          id: 3,
          memberId: 4,
          memberName: 'Jessica Martinez',
          date: '2020-01-26',
          hours: 6,
          description: 'Data entry',
        }),
      ],
    });

    expect(csvBody(activities)).toBe(
      [
        'Name,Date,Role name,Volunteer hours',
        'Jessica Martinez,1/26/2020,Data entry,6',
        'Jill Chang,1/2/2020,Food prep,5',
        ',1/5/2020,Food prep,5',
        'John Doe,1/1/2020,Helper,3',
        ',1/10/2020,Admin work,2',
        ',1/12/2020,Cleaning,2',
        'Joseph Gardner,1/19/2020,Tax advice,1',
        '',
      ].join('\n')
    );
  });

  test('lists shift hours once when a member filled more than one role', () => {
    const activities = collectVolunteerReportActivities({
      from: '2020-01-01',
      to: '2020-01-31',
      today,
      nowIso,
      signups: [
        signup({ signupId: 2, shiftId: 9, date: '2020-01-01', roleName: 'Helper', creditHours: 3 }),
        signup({ signupId: 1, shiftId: 9, date: '2020-01-01', roleName: 'Cleaning', creditHours: 3 }),
      ],
      hourLogs: [],
    });

    expect(csvBody(activities)).toBe(
      ['Name,Date,Role name,Volunteer hours', 'John Doe,1/1/2020,Cleaning,3', ',1/1/2020,Helper,', ''].join(
        '\n'
      )
    );
  });

  test('omits guests, general sign-ups, future shifts, and rows outside the range', () => {
    const activities = collectVolunteerReportActivities({
      from: '2020-01-01',
      to: '2020-01-31',
      today,
      nowIso,
      signups: [
        signup({ signupId: 1, shiftId: 1, date: '2019-12-31' }),
        signup({ signupId: 2, shiftId: 2, date: '2020-02-01', startDt: '2020-02-01T18:00:00.000Z' }),
        signup({ signupId: 3, shiftId: 3, date: '2020-01-15', memberId: null, memberName: null }),
        signup({ signupId: 4, shiftId: 4, date: '2020-01-15', signupKind: 'general', roleName: 'Potluck' }),
        signup({ signupId: 5, shiftId: 5, date: '2020-01-15', status: 'cancelled' }),
        signup({ signupId: 6, shiftId: 6, date: '2020-01-20', roleName: 'Ice', creditHours: 1.5 }),
      ],
      hourLogs: [
        hourLog({ id: 1, date: '2020-02-02', description: 'Later' }),
        hourLog({ id: 2, date: '2019-12-01', description: 'Earlier' }),
        hourLog({ id: 3, date: '2020-01-08', hours: 1.5, description: 'Food, prep' }),
      ],
    });

    const csv = buildVolunteerReportCsv(activities);
    expect(csv).toContain('John Doe,1/8/2020,"Food, prep",1.5');
    expect(csv).toContain(',1/20/2020,Ice,1.5');
    expect(csv).not.toContain('Potluck');
    expect(csv).not.toContain('Later');
    expect(csv).not.toContain('Earlier');
    expect(volunteerReportFilename('2020-01-01', '2020-01-31')).toBe(
      'volunteer-report-2020-01-01-to-2020-01-31.csv'
    );
  });
});
