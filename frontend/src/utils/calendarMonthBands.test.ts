import { describe, expect, test } from 'bun:test';
import { countFreeMonthDaySlots, packMonthDayEventSlots } from './calendarMonthBands';

describe('packMonthDayEventSlots', () => {
  test('fills a hole when a continuing band occupies slot 1', () => {
    const packed = packMonthDayEventSlots([1], ['Tue clinic']);
    expect(packed).toEqual([{ type: 'event', event: 'Tue clinic' }]);
  });

  test('skips occupied slot 1 when a second same-day event needs a later row', () => {
    const packed = packMonthDayEventSlots([1], ['Clinic', 'League']);
    expect(packed).toEqual([
      { type: 'event', event: 'Clinic' },
      { type: 'spacer' },
      { type: 'event', event: 'League' },
    ]);
  });

  test('keeps top-N spacers when continuing bands occupy the first rows', () => {
    const packed = packMonthDayEventSlots([0, 1], ['Board meeting']);
    expect(packed).toEqual([
      { type: 'spacer' },
      { type: 'spacer' },
      { type: 'event', event: 'Board meeting' },
    ]);
  });

  test('returns no slots when the day has no in-cell events', () => {
    expect(packMonthDayEventSlots([1], [])).toEqual([]);
  });
});

describe('countFreeMonthDaySlots', () => {
  test('counts the empty first slot when only band 1 is occupied', () => {
    expect(countFreeMonthDaySlots([1], 4)).toBe(3);
  });

  test('ignores occupied bands below the visible window', () => {
    expect(countFreeMonthDaySlots([5], 4)).toBe(4);
  });

  test('matches a contiguous top reservation', () => {
    expect(countFreeMonthDaySlots([0, 1], 4)).toBe(2);
  });
});
