import { describe, expect, test } from 'bun:test';
import {
  calendarReturnPath,
  isCalendarDateParam,
  readCalendarViewCursor,
  writeCalendarViewCursor,
} from './calendarViewCursor';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

describe('calendar view cursor', () => {
  test('rejects dates that are not real calendar days', () => {
    expect(isCalendarDateParam('2026-12-01')).toBe(true);
    expect(isCalendarDateParam('2026-02-31')).toBe(false);
    expect(isCalendarDateParam('12/01/2026')).toBe(false);
    expect(isCalendarDateParam(null)).toBe(false);
  });

  test('round-trips the last viewed month for this tab', () => {
    const storage = memoryStorage();
    writeCalendarViewCursor(false, { date: '2026-12-01', view: 'month' }, storage);
    expect(readCalendarViewCursor(false, storage)).toEqual({ date: '2026-12-01', view: 'month' });
    expect(readCalendarViewCursor(true, storage)).toBeNull();
  });

  test('ignores corrupt stored cursors', () => {
    const storage = memoryStorage({
      'tbs:calendar-view-cursor:member': '{',
    });
    expect(readCalendarViewCursor(false, storage)).toBeNull();
  });

  test('return path keeps the editor query date ahead of the stored month', () => {
    const storage = memoryStorage();
    writeCalendarViewCursor(false, { date: '2026-11-01', view: 'week' }, storage);
    expect(
      calendarReturnPath(
        { get: (name) => (name === 'date' ? '2026-12-15' : name === 'view' ? 'day' : null) },
        { storage }
      )
    ).toBe('/calendar?date=2026-12-15&view=day');
  });

  test('return path uses the stored month when the editor URL has no date', () => {
    const storage = memoryStorage();
    writeCalendarViewCursor(false, { date: '2026-12-01', view: 'month' }, storage);
    expect(calendarReturnPath({ get: () => null }, { storage })).toBe(
      '/calendar?date=2026-12-01&view=month'
    );
  });

  test('return path is the bare calendar when nothing was viewed yet', () => {
    expect(calendarReturnPath({ get: () => null }, { storage: memoryStorage() })).toBe('/calendar');
  });
});
