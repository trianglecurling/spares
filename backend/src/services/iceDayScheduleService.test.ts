import { describe, expect, test } from 'bun:test';
import { parseEventCalendarEventId, parseLeagueCalendarEventId } from './iceDayScheduleService.js';

describe('parseLeagueCalendarEventId', () => {
  test('parses league feed ids', () => {
    expect(parseLeagueCalendarEventId('league:12:2026-08-28:18:30')).toEqual({
      leagueId: 12,
      date: '2026-08-28',
      time: '18:30',
    });
  });

  test('rejects other feed ids', () => {
    expect(parseLeagueCalendarEventId('event:12:34')).toBeNull();
    expect(parseLeagueCalendarEventId('league:12:2026-08-28')).toBeNull();
  });
});

describe('parseEventCalendarEventId', () => {
  test('parses event timespan feed ids', () => {
    expect(parseEventCalendarEventId('event:12:34')).toEqual({ eventId: 12, timespanId: 34 });
  });
});
