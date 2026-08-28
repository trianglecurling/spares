import { describe, expect, test } from 'bun:test';
import {
  aggregateVolunteerStats,
  volunteerShiftDurationHours,
  volunteerStatsSeasonCountStart,
} from './volunteerStats';

const season = {
  id: 1,
  name: '2026-27',
  startDate: '2026-09-01',
  endDate: '2027-04-30',
};

function row(
  overrides: Partial<Parameters<typeof aggregateVolunteerStats>[0][number]> & {
    signupId: number;
    shiftId: number;
    startDt: string;
    endDt: string;
    startDateOnly: string;
  }
) {
  return {
    memberId: 10,
    memberName: 'Alex',
    ...overrides,
  };
}

describe('volunteerShiftDurationHours', () => {
  test('returns hours between start and end', () => {
    expect(
      volunteerShiftDurationHours('2026-01-15T18:00:00.000Z', '2026-01-15T20:00:00.000Z')
    ).toBe(2);
  });

  test('is 0 when the range is empty or inverted', () => {
    expect(
      volunteerShiftDurationHours('2026-01-15T18:00:00.000Z', '2026-01-15T18:00:00.000Z')
    ).toBe(0);
  });
});

describe('aggregateVolunteerStats', () => {
  const nowIso = '2026-10-20T12:00:00.000Z';
  const monthPrefix = '2026-10';

  test('excludes future shifts', () => {
    const result = aggregateVolunteerStats(
      [
        row({
          signupId: 1,
          shiftId: 1,
          startDt: '2026-11-01T18:00:00.000Z',
          endDt: '2026-11-01T20:00:00.000Z',
          startDateOnly: '2026-11-01',
        }),
      ],
      {
        viewerMemberId: 10,
        nowIso,
        monthPrefix,
        season,
        membershipCount: 100,
      }
    );
    expect(result.club.hours.lifetime).toBe(0);
    expect(result.club.shifts.lifetime).toBe(0);
  });

  test('counts hours once when the same member signs up for two roles on one shift', () => {
    const result = aggregateVolunteerStats(
      [
        row({
          signupId: 1,
          shiftId: 5,
          startDt: '2026-10-10T18:00:00.000Z',
          endDt: '2026-10-10T20:00:00.000Z',
          startDateOnly: '2026-10-10',
        }),
        row({
          signupId: 2,
          shiftId: 5,
          startDt: '2026-10-10T18:00:00.000Z',
          endDt: '2026-10-10T20:00:00.000Z',
          startDateOnly: '2026-10-10',
        }),
      ],
      {
        viewerMemberId: 10,
        nowIso,
        monthPrefix,
        season,
        membershipCount: 50,
      }
    );
    expect(result.club.hours.month).toBe(2);
    expect(result.club.shifts.month).toBe(1);
    expect(result.me.hours.month).toBe(2);
    expect(result.me.shifts.month).toBe(1);
  });

  test('buckets month, season, and since-tracking totals separately', () => {
    const result = aggregateVolunteerStats(
      [
        row({
          signupId: 1,
          shiftId: 1,
          startDt: '2026-10-10T18:00:00.000Z',
          endDt: '2026-10-10T19:00:00.000Z',
          startDateOnly: '2026-10-10',
        }),
        row({
          signupId: 2,
          shiftId: 2,
          startDt: '2026-08-10T18:00:00.000Z',
          endDt: '2026-08-10T20:00:00.000Z',
          startDateOnly: '2026-08-10',
        }),
        row({
          signupId: 3,
          shiftId: 3,
          startDt: '2026-07-10T18:00:00.000Z',
          endDt: '2026-07-10T21:00:00.000Z',
          startDateOnly: '2026-07-10',
        }),
      ],
      {
        viewerMemberId: 10,
        nowIso,
        monthPrefix,
        season,
        membershipCount: 100,
      }
    );
    expect(result.club.hours).toEqual({ month: 1, season: 3, lifetime: 3 });
    expect(result.club.shifts).toEqual({ month: 1, season: 2, lifetime: 2 });
  });

  test('counts August prep hours for a September season start', () => {
    expect(volunteerStatsSeasonCountStart('2026-09-01')).toBe('2026-08-01');
    const result = aggregateVolunteerStats(
      [
        row({
          signupId: 1,
          shiftId: 1,
          startDt: '2026-08-15T18:00:00.000Z',
          endDt: '2026-08-15T20:00:00.000Z',
          startDateOnly: '2026-08-15',
        }),
      ],
      {
        viewerMemberId: 10,
        nowIso: '2026-08-28T12:00:00.000Z',
        monthPrefix: '2026-08',
        season,
        membershipCount: 100,
      }
    );
    expect(result.club.hours.season).toBe(2);
    expect(result.club.hours.lifetime).toBe(2);
  });

  test('omits hours from before August 2026', () => {
    const result = aggregateVolunteerStats(
      [
        row({
          signupId: 1,
          shiftId: 1,
          startDt: '2026-07-15T18:00:00.000Z',
          endDt: '2026-07-15T20:00:00.000Z',
          startDateOnly: '2026-07-15',
        }),
      ],
      {
        viewerMemberId: 10,
        nowIso: '2026-08-28T12:00:00.000Z',
        monthPrefix: '2026-08',
        season,
        membershipCount: 100,
      }
    );
    expect(result.club.hours.lifetime).toBe(0);
  });

  test('counts unique members for season percent and omits guests from that count', () => {
    const result = aggregateVolunteerStats(
      [
        row({
          signupId: 1,
          memberId: 10,
          memberName: 'Alex',
          shiftId: 1,
          startDt: '2026-10-10T18:00:00.000Z',
          endDt: '2026-10-10T20:00:00.000Z',
          startDateOnly: '2026-10-10',
        }),
        row({
          signupId: 2,
          memberId: 11,
          memberName: 'Blair',
          shiftId: 1,
          startDt: '2026-10-10T18:00:00.000Z',
          endDt: '2026-10-10T20:00:00.000Z',
          startDateOnly: '2026-10-10',
        }),
        row({
          signupId: 3,
          memberId: null,
          memberName: null,
          shiftId: 1,
          startDt: '2026-10-10T18:00:00.000Z',
          endDt: '2026-10-10T20:00:00.000Z',
          startDateOnly: '2026-10-10',
        }),
      ],
      {
        viewerMemberId: 10,
        nowIso,
        monthPrefix,
        season,
        membershipCount: 80,
      }
    );
    expect(result.club.uniqueVolunteersSeason).toBe(2);
    expect(result.club.uniqueVolunteerPercentSeason).toBe(2.5);
    expect(result.club.hours.season).toBe(6);
    expect(result.club.hoursPerMemberSeason).toBe(0.1);
  });

  test('builds a season leaderboard and viewer rank', () => {
    const result = aggregateVolunteerStats(
      [
        row({
          signupId: 1,
          memberId: 1,
          memberName: 'Zed',
          shiftId: 1,
          startDt: '2026-10-10T18:00:00.000Z',
          endDt: '2026-10-10T22:00:00.000Z',
          startDateOnly: '2026-10-10',
        }),
        row({
          signupId: 2,
          memberId: 10,
          memberName: 'Alex',
          shiftId: 2,
          startDt: '2026-10-11T18:00:00.000Z',
          endDt: '2026-10-11T19:00:00.000Z',
          startDateOnly: '2026-10-11',
        }),
      ],
      {
        viewerMemberId: 10,
        nowIso,
        monthPrefix,
        season,
        membershipCount: 10,
      }
    );
    expect(result.leaderboard).toEqual([
      { rank: 1, memberId: 1, name: 'Zed', hours: 4, isViewer: false },
      { rank: 2, memberId: 10, name: 'Alex', hours: 1, isViewer: true },
    ]);
    expect(result.me.seasonRank).toBe(2);
  });

  test('repairs mojibake in leaderboard names', () => {
    const result = aggregateVolunteerStats(
      [
        row({
          signupId: 1,
          memberId: 7,
          memberName: 'Tony D\u00E2\u20AC\u2122Agostino',
          shiftId: 1,
          startDt: '2026-10-10T18:00:00.000Z',
          endDt: '2026-10-10T22:00:00.000Z',
          startDateOnly: '2026-10-10',
        }),
      ],
      {
        viewerMemberId: 7,
        nowIso,
        monthPrefix,
        season,
        membershipCount: 10,
      }
    );
    expect(result.leaderboard[0]?.name).toBe("Tony D'Agostino");
  });
});
