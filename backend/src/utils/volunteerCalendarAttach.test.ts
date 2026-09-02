import { describe, expect, test } from 'bun:test';
import {
  applyCalendarExceptionsAndOverrides,
  pickDirectCalendarEventsOverlappingRange,
  planCalendarSyncedShiftChanges,
} from './volunteerCalendarAttach.js';

const DAY_START = '2026-09-02T04:00:00.000Z';
const DAY_END = '2026-09-03T04:00:00.000Z';

describe('pickDirectCalendarEventsOverlappingRange', () => {
  test('keeps events that overlap the local day and drops others', () => {
    const picked = pickDirectCalendarEventsOverlappingRange(
      [
        {
          id: 'direct:1',
          title: 'Morning ice',
          start: '2026-09-02T12:00:00.000Z',
          end: '2026-09-02T14:00:00.000Z',
          allDay: false,
        },
        {
          id: 'direct:2',
          title: 'Next day',
          start: DAY_END,
          end: '2026-09-03T06:00:00.000Z',
          allDay: false,
        },
        {
          id: 'direct:3',
          title: 'Previous day',
          start: '2026-09-01T20:00:00.000Z',
          end: DAY_START,
          allDay: false,
        },
      ],
      DAY_START,
      DAY_END
    );
    expect(picked.map((event) => event.id)).toEqual([1]);
  });

  test('dedupes recurring occurrences to the series id', () => {
    const picked = pickDirectCalendarEventsOverlappingRange(
      [
        {
          id: 'direct:12:2026-09-02',
          title: 'Weekly clinic',
          start: '2026-09-02T15:00:00.000Z',
          end: '2026-09-02T16:00:00.000Z',
          allDay: false,
          isRecurring: true,
        },
        {
          id: 'direct:12:2026-09-02',
          title: 'Weekly clinic (dup)',
          start: '2026-09-02T18:00:00.000Z',
          end: '2026-09-02T19:00:00.000Z',
          allDay: false,
          isRecurring: true,
        },
      ],
      DAY_START,
      DAY_END
    );
    expect(picked).toEqual([
      {
        id: 12,
        title: 'Weekly clinic',
        start: '2026-09-02T15:00:00.000Z',
        end: '2026-09-02T16:00:00.000Z',
        allDay: false,
        isRecurring: true,
      },
    ]);
  });

  test('ignores non-direct feed ids', () => {
    const picked = pickDirectCalendarEventsOverlappingRange(
      [
        {
          id: 'event:9',
          title: 'Bonspiel',
          start: '2026-09-02T12:00:00.000Z',
          end: '2026-09-02T14:00:00.000Z',
          allDay: false,
        },
      ],
      DAY_START,
      DAY_END
    );
    expect(picked).toEqual([]);
  });
});

describe('applyCalendarExceptionsAndOverrides', () => {
  test('drops excepted dates unless an override exists', () => {
    const occurrences = applyCalendarExceptionsAndOverrides(
      [
        { start: '2026-09-02T15:00:00.000Z', end: '2026-09-02T16:00:00.000Z', recurrenceDate: '2026-09-02' },
        { start: '2026-09-09T15:00:00.000Z', end: '2026-09-09T16:00:00.000Z', recurrenceDate: '2026-09-09' },
      ],
      false,
      new Set(['2026-09-02', '2026-09-09']),
      new Map([
        [
          '2026-09-09',
          { start: '2026-09-09T17:00:00.000Z', end: '2026-09-09T18:00:00.000Z', allDay: false },
        ],
      ])
    );
    expect(occurrences).toEqual([
      {
        start: '2026-09-09T17:00:00.000Z',
        end: '2026-09-09T18:00:00.000Z',
        recurrenceDate: '2026-09-09',
        allDay: false,
      },
    ]);
  });
});

describe('planCalendarSyncedShiftChanges', () => {
  test('updates matching dates, creates new dates, and deletes removed dates', () => {
    const plan = planCalendarSyncedShiftChanges(
      [
        { id: 1, recurrenceDate: '2026-09-02' },
        { id: 2, recurrenceDate: '2026-09-09' },
      ],
      [
        { start: 'a', end: 'b', recurrenceDate: '2026-09-02', allDay: false },
        { start: 'c', end: 'd', recurrenceDate: '2026-09-16', allDay: false },
      ]
    );
    expect(plan.updates).toEqual([
      { id: 1, start: 'a', end: 'b', recurrenceDate: '2026-09-02' },
    ]);
    expect(plan.creates.map((row) => row.recurrenceDate)).toEqual(['2026-09-16']);
    expect(plan.deleteIds).toEqual([2]);
  });

  test('does not recreate dates skipped by a volunteer exception', () => {
    const plan = planCalendarSyncedShiftChanges(
      [{ id: 1, recurrenceDate: '2026-09-02' }],
      [
        { start: 'a', end: 'b', recurrenceDate: '2026-09-02', allDay: false },
        { start: 'c', end: 'd', recurrenceDate: '2026-09-09', allDay: false },
      ],
      new Set(['2026-09-09'])
    );
    expect(plan.creates).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
  });
});
