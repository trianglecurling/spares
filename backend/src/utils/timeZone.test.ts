import { describe, expect, test } from 'bun:test';
import { localDateTimeToIso, localDateTimeToUtcDate } from './timeZone.js';

const EASTERN = 'America/New_York';

describe('localDateTimeToUtcDate', () => {
  test('maps Eastern daylight-saving evening times to UTC (+4h)', () => {
    // 2026-07-09 is EDT (UTC-4)
    expect(localDateTimeToIso('2026-07-09', '18:15', EASTERN)).toBe('2026-07-09T22:15:00.000Z');
    expect(localDateTimeToIso('2026-07-09', '20:30', EASTERN)).toBe('2026-07-10T00:30:00.000Z');
  });

  test('maps Eastern standard-time evening times to UTC (+5h)', () => {
    // 2026-01-08 is EST (UTC-5)
    expect(localDateTimeToIso('2026-01-08', '18:15', EASTERN)).toBe('2026-01-08T23:15:00.000Z');
    expect(localDateTimeToIso('2026-01-08', '20:30', EASTERN)).toBe('2026-01-09T01:30:00.000Z');
  });

  test('accepts HH:MM:SS time strings', () => {
    expect(localDateTimeToIso('2026-07-09', '18:15:00', EASTERN)).toBe('2026-07-09T22:15:00.000Z');
  });

  test('returns an invalid Date for malformed input', () => {
    expect(Number.isNaN(localDateTimeToUtcDate('not-a-date', '18:15', EASTERN).getTime())).toBe(true);
    expect(Number.isNaN(localDateTimeToUtcDate('2026-07-09', 'bad', EASTERN).getTime())).toBe(true);
  });
});
