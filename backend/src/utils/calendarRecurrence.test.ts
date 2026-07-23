import { describe, expect, test } from 'bun:test';
import rrule from 'rrule';
import { composeRecurrenceRule, expandRecurrenceInTimeZone } from './calendarRecurrence.js';
import { formatTimeInTimeZone, localDateTimeToIso } from './timeZone.js';

const { RRule } = rrule;
const EASTERN = 'America/New_York';

describe('composeRecurrenceRule', () => {
  test('returns bare rrule when no endDate or count', () => {
    expect(composeRecurrenceRule({ rrule: 'FREQ=WEEKLY;BYDAY=MO' })).toBe('FREQ=WEEKLY;BYDAY=MO');
  });

  test('bakes floating UNTIL into weekly rrule from endDate', () => {
    const composed = composeRecurrenceRule({
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      endDate: '2026-12-31',
    });
    expect(composed).toContain('FREQ=WEEKLY');
    expect(composed).toContain('BYDAY=MO');
    expect(composed).toMatch(/UNTIL=20261231T235959Z/i);

    const options = RRule.parseString(composed);
    expect(options.until?.toISOString()).toBe('2026-12-31T23:59:59.000Z');
    expect(options.count).toBeUndefined();
  });

  test('prefers endDate over count when both are provided', () => {
    const composed = composeRecurrenceRule({
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
      endDate: '2026-08-15',
      count: 99,
    });
    const options = RRule.parseString(composed);
    expect(options.until).toBeInstanceOf(Date);
    expect(options.count).toBeUndefined();
  });

  test('bakes COUNT when only count is provided', () => {
    const composed = composeRecurrenceRule({
      rrule: 'FREQ=DAILY',
      count: 5,
    });
    expect(composed).toMatch(/COUNT=5/i);
    expect(composed).not.toMatch(/UNTIL=/i);
  });

  test('trims whitespace on rrule and endDate', () => {
    const composed = composeRecurrenceRule({
      rrule: '  FREQ=MONTHLY  ',
      endDate: ' 2026-09-01 ',
    });
    expect(composed).toContain('FREQ=MONTHLY');
    expect(composed).toMatch(/UNTIL=/i);
  });
});

describe('expandRecurrenceInTimeZone', () => {
  test('keeps wall-clock time across the fall DST boundary', () => {
    // 2026-11-01: clocks fall back in America/New_York (EDT → EST).
    const start = localDateTimeToIso('2026-10-19', '18:00:00', EASTERN);
    const end = localDateTimeToIso('2026-10-19', '20:00:00', EASTERN);
    const instances = expandRecurrenceInTimeZone(
      start,
      end,
      'FREQ=WEEKLY;BYDAY=MO',
      new Date('2026-10-01T00:00:00.000Z'),
      new Date('2026-11-30T00:00:00.000Z'),
      EASTERN
    );

    const byDate = new Map(instances.map((i) => [i.recurrenceDate, i]));
    expect(byDate.has('2026-10-19')).toBe(true);
    expect(byDate.has('2026-10-26')).toBe(true);
    expect(byDate.has('2026-11-02')).toBe(true);
    expect(byDate.has('2026-11-09')).toBe(true);

    for (const date of ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']) {
      const inst = byDate.get(date)!;
      expect(formatTimeInTimeZone(new Date(inst.start), EASTERN)).toBe('18:00:00');
      expect(formatTimeInTimeZone(new Date(inst.end), EASTERN)).toBe('20:00:00');
    }

    // Absolute UTC hour must shift after the fall-back so local 6pm is preserved.
    expect(byDate.get('2026-10-26')!.start).toBe('2026-10-26T22:00:00.000Z'); // EDT
    expect(byDate.get('2026-11-02')!.start).toBe('2026-11-02T23:00:00.000Z'); // EST
  });

  test('keeps wall-clock time across the spring DST boundary', () => {
    // 2026-03-08: clocks spring forward in America/New_York (EST → EDT).
    const start = localDateTimeToIso('2026-03-02', '18:00:00', EASTERN);
    const end = localDateTimeToIso('2026-03-02', '19:30:00', EASTERN);
    const instances = expandRecurrenceInTimeZone(
      start,
      end,
      'FREQ=WEEKLY;BYDAY=MO',
      new Date('2026-02-20T00:00:00.000Z'),
      new Date('2026-03-30T00:00:00.000Z'),
      EASTERN
    );

    const byDate = new Map(instances.map((i) => [i.recurrenceDate, i]));
    expect(formatTimeInTimeZone(new Date(byDate.get('2026-03-02')!.start), EASTERN)).toBe('18:00:00');
    expect(formatTimeInTimeZone(new Date(byDate.get('2026-03-09')!.start), EASTERN)).toBe('18:00:00');
    expect(byDate.get('2026-03-02')!.start).toBe('2026-03-02T23:00:00.000Z'); // EST
    expect(byDate.get('2026-03-09')!.start).toBe('2026-03-09T22:00:00.000Z'); // EDT
  });

  test('honors floating UNTIL end date', () => {
    const start = localDateTimeToIso('2026-07-06', '18:00:00', EASTERN);
    const end = localDateTimeToIso('2026-07-06', '20:00:00', EASTERN);
    const rule = composeRecurrenceRule({
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      endDate: '2026-07-20',
    });
    const instances = expandRecurrenceInTimeZone(
      start,
      end,
      rule,
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
      EASTERN
    );
    expect(instances.map((i) => i.recurrenceDate)).toEqual([
      '2026-07-06',
      '2026-07-13',
      '2026-07-20',
    ]);
  });
});
