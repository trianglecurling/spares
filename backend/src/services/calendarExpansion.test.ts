import { describe, expect, test } from 'bun:test';
import { parseDirectCalendarFeedId } from './calendarExpansion.js';

describe('parseDirectCalendarFeedId', () => {
  test('parses a standalone direct event id', () => {
    expect(parseDirectCalendarFeedId('direct:12')).toEqual({ dbId: 12, recurrenceDate: null });
  });

  test('parses a recurring instance id', () => {
    expect(parseDirectCalendarFeedId('direct:12:2026-12-11')).toEqual({
      dbId: 12,
      recurrenceDate: '2026-12-11',
    });
  });

  test('rejects non-direct sources and malformed ids', () => {
    expect(parseDirectCalendarFeedId('event:12')).toBeNull();
    expect(parseDirectCalendarFeedId('direct:abc')).toBeNull();
    expect(parseDirectCalendarFeedId('direct:12:12/11')).toBeNull();
    expect(parseDirectCalendarFeedId('direct:0')).toBeNull();
  });
});
