import { describe, expect, test } from 'bun:test';
import {
  activityKind,
  iceDayOccupancySheetIds,
  parseEventCalendarEventId,
  parseLeagueCalendarEventId,
} from './iceDayScheduleService.js';

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

describe('activityKind', () => {
  test('treats league feed items as league occupancy', () => {
    expect(activityKind({ source: 'leagues', typeId: 'leagues' })).toBe('league');
  });

  test('does not treat calendar or event items as league just because they use the leagues type', () => {
    expect(activityKind({ source: 'direct', typeId: 'leagues' })).toBe('other');
    expect(activityKind({ source: 'events', typeId: 'leagues' })).toBe('other');
    expect(activityKind({ source: 'events', typeId: 'other' })).toBe('other');
  });

  test('treats bonspiel types as bonspiel', () => {
    expect(activityKind({ source: 'events', typeId: 'bonspiel' })).toBe('bonspiel');
    expect(activityKind({ source: 'events', typeId: 'bonspiel-fours' })).toBe('bonspiel');
  });
});

describe('iceDayOccupancySheetIds', () => {
  test('returns only explicit sheet locations', () => {
    expect(
      iceDayOccupancySheetIds({
        locations: [
          { type: 'sheet', sheetId: 2 },
          { type: 'sheet', sheetId: 4 },
          { type: 'warm-room' },
        ],
      })
    ).toEqual([2, 4]);
  });

  test('returns no sheets when the event has no location', () => {
    expect(iceDayOccupancySheetIds({})).toEqual([]);
    expect(iceDayOccupancySheetIds({ locations: [] })).toEqual([]);
    expect(iceDayOccupancySheetIds({ locations: [{ type: 'offsite' }] })).toEqual([]);
  });
});
