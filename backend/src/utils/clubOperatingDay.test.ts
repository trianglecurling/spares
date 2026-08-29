import { describe, expect, test } from 'bun:test';
import {
  clubOperatingDateFromInstant,
  clubOperatingDayWindow,
  isClubOperatingDateString,
  parseFlexibleDateTime,
} from './clubOperatingDay.js';
import { localDateTimeToUtcDate } from './timeZone.js';

const EASTERN = 'America/New_York';

describe('isClubOperatingDateString', () => {
  test('accepts calendar dates and rejects overflow', () => {
    expect(isClubOperatingDateString('2026-08-28')).toBe(true);
    expect(isClubOperatingDateString('2026-02-29')).toBe(false);
    expect(isClubOperatingDateString('08-28-2026')).toBe(false);
  });
});

describe('clubOperatingDateFromInstant', () => {
  test('times at or after 4am belong to that calendar date', () => {
    const fourAm = localDateTimeToUtcDate('2026-08-28', '04:00', EASTERN);
    const evening = localDateTimeToUtcDate('2026-08-28', '22:15', EASTERN);
    expect(clubOperatingDateFromInstant(fourAm, EASTERN)).toBe('2026-08-28');
    expect(clubOperatingDateFromInstant(evening, EASTERN)).toBe('2026-08-28');
  });

  test('times before 4am belong to the previous calendar date', () => {
    const justBefore = localDateTimeToUtcDate('2026-08-29', '03:59', EASTERN);
    const midnight = localDateTimeToUtcDate('2026-08-29', '00:00', EASTERN);
    expect(clubOperatingDateFromInstant(justBefore, EASTERN)).toBe('2026-08-28');
    expect(clubOperatingDateFromInstant(midnight, EASTERN)).toBe('2026-08-28');
  });
});

describe('clubOperatingDayWindow', () => {
  test('is a half-open window from 4am to the next 4am', () => {
    const { dayStart, dayEnd } = clubOperatingDayWindow('2026-08-28', EASTERN);
    expect(dayStart.toISOString()).toBe(localDateTimeToUtcDate('2026-08-28', '04:00', EASTERN).toISOString());
    expect(dayEnd.toISOString()).toBe(localDateTimeToUtcDate('2026-08-29', '04:00', EASTERN).toISOString());
  });
});

describe('parseFlexibleDateTime', () => {
  test('treats datetime-local as club-local wall clock', () => {
    const parsed = parseFlexibleDateTime('2026-08-28T18:30', EASTERN);
    expect(parsed?.toISOString()).toBe(localDateTimeToUtcDate('2026-08-28', '18:30', EASTERN).toISOString());
  });

  test('parses ISO instants as-is', () => {
    const parsed = parseFlexibleDateTime('2026-08-28T22:30:00.000Z', EASTERN);
    expect(parsed?.toISOString()).toBe('2026-08-28T22:30:00.000Z');
  });
});
