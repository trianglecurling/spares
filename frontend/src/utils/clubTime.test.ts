import { afterEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_CLUB_TIME_ZONE,
  addMinutesToDateTimeLocal,
  dateTimeLocalToIso,
  floatingDateToIso,
  formatDateInTimeZone,
  formatTimeInTimeZone,
  instantToFloatingDate,
  isoToDateTimeLocal,
  localDateTimeToIso,
  setClubTimeZone,
} from './clubTime';

const EASTERN = 'America/New_York';

afterEach(() => {
  setClubTimeZone(DEFAULT_CLUB_TIME_ZONE);
});

describe('localDateTimeToIso', () => {
  test('maps Eastern daylight-saving evening times to UTC (+4h)', () => {
    expect(localDateTimeToIso('2026-07-09', '15:00', EASTERN)).toBe('2026-07-09T19:00:00.000Z');
    expect(localDateTimeToIso('2026-07-09', '18:15', EASTERN)).toBe('2026-07-09T22:15:00.000Z');
  });

  test('maps Eastern standard-time evening times to UTC (+5h)', () => {
    expect(localDateTimeToIso('2026-01-08', '15:00', EASTERN)).toBe('2026-01-08T20:00:00.000Z');
    expect(localDateTimeToIso('2026-01-08', '18:15', EASTERN)).toBe('2026-01-08T23:15:00.000Z');
  });

  test('preserves 3pm wall-clock across the fall DST boundary', () => {
    expect(localDateTimeToIso('2026-10-31', '15:00', EASTERN)).toBe('2026-10-31T19:00:00.000Z');
    expect(localDateTimeToIso('2026-11-01', '15:00', EASTERN)).toBe('2026-11-01T20:00:00.000Z');
  });

  test('preserves 3pm wall-clock across the spring DST boundary', () => {
    expect(localDateTimeToIso('2026-03-07', '15:00', EASTERN)).toBe('2026-03-07T20:00:00.000Z');
    expect(localDateTimeToIso('2026-03-08', '15:00', EASTERN)).toBe('2026-03-08T19:00:00.000Z');
  });
});

describe('datetime-local conversion', () => {
  test('treats datetime-local values as club wall clock, not the device zone', () => {
    expect(dateTimeLocalToIso('2026-07-09T15:00', EASTERN)).toBe('2026-07-09T19:00:00.000Z');
    expect(isoToDateTimeLocal('2026-07-09T19:00:00.000Z', EASTERN)).toBe('2026-07-09T15:00');
    expect(isoToDateTimeLocal('2026-01-08T20:00:00.000Z', EASTERN)).toBe('2026-01-08T15:00');
  });

  test('adds minutes on club wall clock away from the ambiguous fall-back hour', () => {
    expect(addMinutesToDateTimeLocal('2026-11-01T15:00', 90, EASTERN)).toBe('2026-11-01T16:30');
    expect(addMinutesToDateTimeLocal('2026-03-08T15:00', 90, EASTERN)).toBe('2026-03-08T16:30');
  });
});

describe('floating dates', () => {
  test('round-trip an ISO instant through floating club-local components', () => {
    const iso = localDateTimeToIso('2026-07-09', '15:00:00', EASTERN);
    const floating = instantToFloatingDate(iso, EASTERN);
    expect(floating.getFullYear()).toBe(2026);
    expect(floating.getMonth()).toBe(6);
    expect(floating.getDate()).toBe(9);
    expect(floating.getHours()).toBe(15);
    expect(floating.getMinutes()).toBe(0);
    expect(floatingDateToIso(floating, EASTERN)).toBe(iso);
    expect(formatDateInTimeZone(new Date(iso), EASTERN)).toBe('2026-07-09');
    expect(formatTimeInTimeZone(new Date(iso), EASTERN)).toBe('15:00:00');
  });
});
