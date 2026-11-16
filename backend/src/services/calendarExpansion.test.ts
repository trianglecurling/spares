import { describe, expect, test } from 'bun:test';
import {
  expandLeagueCalendarEvents,
  ICE_PREPARATION_TITLE,
  leagueIcePrepEventId,
  parseDirectCalendarFeedId,
  type LeagueCalendarExpansionLeague,
} from './calendarExpansion.js';
import { parseLeagueCalendarEventId } from './iceDayScheduleService.js';

const SHEETS = [
  { id: 1, name: 'Sheet A' },
  { id: 2, name: 'Sheet B' },
  { id: 3, name: 'Sheet C' },
];

function mondayLeague(
  overrides: Partial<LeagueCalendarExpansionLeague> = {}
): LeagueCalendarExpansionLeague {
  return {
    id: 7,
    name: 'Monday League',
    dayOfWeek: 1,
    format: 'teams',
    startDate: '2026-01-05',
    endDate: '2026-01-19',
    drawDurationMinutes: 120,
    drawTimes: [{ time: '18:00', icePrepMinutes: 30 }],
    exceptionDates: [],
    extraDraws: [],
    ...overrides,
  };
}

function expand(
  league: LeagueCalendarExpansionLeague,
  options?: {
    rangeStart?: Date;
    rangeEnd?: Date;
    sheetAvailabilityByDraw?: Map<string, Map<number, boolean>>;
  }
) {
  return expandLeagueCalendarEvents({
    leagues: [league],
    sheets: SHEETS,
    sheetAvailabilityByDraw: options?.sheetAvailabilityByDraw ?? new Map(),
    rangeStart: options?.rangeStart ?? new Date('2026-01-01T00:00:00.000Z'),
    rangeEnd: options?.rangeEnd ?? new Date('2026-01-31T00:00:00.000Z'),
    timeZone: 'UTC',
  });
}

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

describe('expandLeagueCalendarEvents ice preparation', () => {
  test('adds an all-sheet ice preparation block before each regular draw', () => {
    const availability = new Map<string, Map<number, boolean>>([
      ['7:2026-01-05:18:00', new Map([[2, false]])],
    ]);
    const events = expand(mondayLeague(), { sheetAvailabilityByDraw: availability });
    const prep = events.find((event) => event.id === leagueIcePrepEventId(7, '2026-01-05', '18:00'));
    const draw = events.find((event) => event.id === 'league:7:2026-01-05:18:00');

    expect(prep).toMatchObject({
      title: ICE_PREPARATION_TITLE,
      description: 'Before Monday League',
      start: '2026-01-05T17:30:00.000Z',
      end: '2026-01-05T18:00:00.000Z',
      source: 'leagues',
      typeId: 'maintenance',
    });
    expect(prep?.locations?.map((location) => location.sheetId)).toEqual([1, 2, 3]);
    expect(draw?.locations?.map((location) => location.sheetId)).toEqual([1, 3]);
    expect(parseLeagueCalendarEventId(prep!.id)).toBeNull();
    expect(events.filter((event) => event.title === ICE_PREPARATION_TITLE)).toHaveLength(3);
  });

  test('omits ice preparation on draw exception dates and follows the updated schedule', () => {
    const withException = expand(mondayLeague({ exceptionDates: ['2026-01-12'] }));
    const ids = withException.map((event) => event.id);
    expect(ids).not.toContain('league:7:2026-01-12:18:00');
    expect(ids).not.toContain(leagueIcePrepEventId(7, '2026-01-12', '18:00'));
    expect(ids).toContain(leagueIcePrepEventId(7, '2026-01-05', '18:00'));
    expect(ids).toContain(leagueIcePrepEventId(7, '2026-01-19', '18:00'));
  });

  test('does not add ice preparation for one-off draws', () => {
    const events = expand(
      mondayLeague({
        extraDraws: [{ date: '2026-01-07', time: '19:00' }],
      })
    );
    expect(events.map((event) => event.id)).toContain('league:7:2026-01-07:19:00');
    expect(events.map((event) => event.id)).not.toContain(leagueIcePrepEventId(7, '2026-01-07', '19:00'));
    expect(events.filter((event) => event.title === ICE_PREPARATION_TITLE)).toHaveLength(3);
  });

  test('skips ice preparation when that draw time is set to 0 minutes', () => {
    const events = expand(
      mondayLeague({ drawTimes: [{ time: '18:00', icePrepMinutes: 0 }] })
    );
    expect(events.some((event) => event.id.startsWith('league-ice-prep:'))).toBe(false);
    expect(events.some((event) => event.id.startsWith('league:7:'))).toBe(true);
  });

  test('keeps ice preparation that starts inside the range when the draw itself is just outside it', () => {
    const events = expand(
      mondayLeague({
        startDate: '2026-01-05',
        endDate: '2026-01-05',
        drawTimes: [{ time: '00:30', icePrepMinutes: 120 }],
      }),
      {
        rangeStart: new Date('2026-01-04T00:00:00.000Z'),
        rangeEnd: new Date('2026-01-04T23:00:00.000Z'),
      }
    );
    expect(events.map((event) => event.id)).toEqual([leagueIcePrepEventId(7, '2026-01-05', '00:30')]);
    expect(events[0]).toMatchObject({
      start: '2026-01-04T22:30:00.000Z',
      end: '2026-01-05T00:30:00.000Z',
    });
  });

  test('uses a separate ice prep time for each regular draw time', () => {
    const events = expand(
      mondayLeague({
        startDate: '2026-01-05',
        endDate: '2026-01-05',
        drawTimes: [
          { time: '18:00', icePrepMinutes: 30 },
          { time: '20:15', icePrepMinutes: 45 },
        ],
      })
    );
    const preps = events.filter((event) => event.title === ICE_PREPARATION_TITLE);
    expect(preps).toEqual([
      expect.objectContaining({
        id: leagueIcePrepEventId(7, '2026-01-05', '18:00'),
        start: '2026-01-05T17:30:00.000Z',
        end: '2026-01-05T18:00:00.000Z',
      }),
      expect.objectContaining({
        id: leagueIcePrepEventId(7, '2026-01-05', '20:15'),
        start: '2026-01-05T19:30:00.000Z',
        end: '2026-01-05T20:15:00.000Z',
      }),
    ]);
  });
});
