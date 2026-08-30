import { describe, expect, test } from 'bun:test';
import { formatEventTimespansForDisplay } from './formatEventTimespans.js';
import { localDateTimeToIso } from './timeZone.js';

const EASTERN = 'America/New_York';

describe('formatEventTimespansForDisplay', () => {
  test('formats a single-day event in club time, not UTC', () => {
    const start = localDateTimeToIso('2026-07-09', '15:00', EASTERN);
    const end = localDateTimeToIso('2026-07-09', '17:00', EASTERN);
    expect(start).toBe('2026-07-09T19:00:00.000Z');

    const formatted = formatEventTimespansForDisplay([{ startDt: start, endDt: end }], EASTERN);
    expect(formatted.text).toContain('July 9, 2026');
    expect(formatted.text).toMatch(/3:00\sPM to 5:00\sPM/i);
    expect(formatted.text).not.toMatch(/7:00\sPM/);
    expect(formatted.html).toContain('<br>');
  });

  test('formats a winter event in Eastern standard time', () => {
    const start = localDateTimeToIso('2026-01-08', '15:00', EASTERN);
    const end = localDateTimeToIso('2026-01-08', '16:30', EASTERN);
    const formatted = formatEventTimespansForDisplay([{ start_dt: start, end_dt: end }], EASTERN);
    expect(formatted.text).toContain('January 8, 2026');
    expect(formatted.text).toMatch(/3:00\sPM to 4:30\sPM/i);
  });

  test('does not invent a second day for an evening session that crosses UTC midnight', () => {
    // 7:00–9:00 PM Friday ET is 23:00Z Friday → 01:00Z Saturday.
    const start = localDateTimeToIso('2026-09-11', '19:00', EASTERN);
    const end = localDateTimeToIso('2026-09-11', '21:00', EASTERN);
    expect(start).toBe('2026-09-11T23:00:00.000Z');
    expect(end).toBe('2026-09-12T01:00:00.000Z');

    const formatted = formatEventTimespansForDisplay([{ start_dt: start, end_dt: end }], EASTERN);
    expect(formatted.text).toContain('September 11, 2026');
    expect(formatted.text).toMatch(/7:00\sPM to 9:00\sPM/i);
    expect(formatted.text).not.toContain('September 12');
    expect(formatted.text).not.toMatch(/^Start:/);
  });

  test('keeps times on a genuine overnight span instead of date-only start/end', () => {
    const start = localDateTimeToIso('2026-09-11', '22:00', EASTERN);
    const end = localDateTimeToIso('2026-09-12', '01:00', EASTERN);
    const formatted = formatEventTimespansForDisplay([{ start_dt: start, end_dt: end }], EASTERN);
    expect(formatted.text).toMatch(/Start:.*September 11, 2026, 10:00\sPM/i);
    expect(formatted.text).toMatch(/End:.*September 12, 2026, 1:00\sAM/i);
  });
});
