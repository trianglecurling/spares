import { describe, expect, test } from 'bun:test';
import {
  blockedStartRanges,
  hatchBands,
  refitSlotsToDuration,
  startSlotIsBlocked,
  suggestShorterDuration,
  type StartSlotOccupancy,
} from './bookingStartOccupancy';

const SHEETS = [1, 2, 3, 4];

/** Minutes after local midnight on a fixed day. */
function at(totalMinutes: number): Date {
  return new Date(2026, 9, 27, 0, totalMinutes, 0, 0);
}

function openSlot(startMinutes: number, durationMinutes = 120): StartSlotOccupancy {
  return {
    start: at(startMinutes),
    end: at(startMinutes + durationMinutes),
    availableSheetIds: SHEETS,
  };
}

describe('startSlotIsBlocked', () => {
  const event = { start: at(10 * 60 + 15), end: at(12 * 60 + 15), sheetIds: SHEETS };

  test('a 2-hour booking that ends as the event starts is free', () => {
    expect(startSlotIsBlocked(openSlot(8 * 60 + 15), SHEETS, [event])).toBe(false);
  });

  test('the next 15-minute start runs into the event', () => {
    expect(startSlotIsBlocked(openSlot(8 * 60 + 30), SHEETS, [event])).toBe(true);
    expect(startSlotIsBlocked(openSlot(9 * 60 + 45), SHEETS, [event])).toBe(true);
    expect(startSlotIsBlocked(openSlot(10 * 60), SHEETS, [event])).toBe(true);
  });

  test('a block on fewer than all sheets still leaves a place to start', () => {
    const partial = { ...event, sheetIds: [1, 2, 3] };
    expect(startSlotIsBlocked(openSlot(8 * 60 + 30), SHEETS, [partial])).toBe(false);
  });
});

describe('blockedStartRanges', () => {
  test('a 2-hour lead-in before a 10:15 all-sheet event reaches 10:15', () => {
    const event = { start: at(10 * 60 + 15), end: at(12 * 60 + 15), sheetIds: SHEETS };
    const slots: StartSlotOccupancy[] = [];
    for (let minutes = 8 * 60; minutes <= 12 * 60; minutes += 15) {
      const blockedByServer = minutes >= 8 * 60 + 30 && minutes <= 9 * 60 + 30;
      slots.push({
        start: at(minutes),
        end: at(minutes + 120),
        availableSheetIds: blockedByServer ? [] : SHEETS,
        ...(blockedByServer ? { unavailableReason: 'sheets_busy' } : {}),
      });
    }

    const ranges = blockedStartRanges(slots, 15, SHEETS, [event]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.start).toEqual(at(8 * 60 + 30));
    expect(ranges[0]!.end.getTime()).toBeGreaterThanOrEqual(at(10 * 60 + 15).getTime());
  });

  test('adjacent starts stay one range when the step is a millisecond short', () => {
    const slots = [0, 15, 30].map((minutes) => ({
      start: at(minutes),
      end: at(minutes + 120),
      availableSheetIds: [] as number[],
      unavailableReason: 'past',
    }));
    const ranges = blockedStartRanges(slots, 15 - 1 / 60_000, [], []);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.end.getTime() - ranges[0]!.start.getTime()).toBeGreaterThanOrEqual(45 * 60_000 - 2);
  });
});

describe('refitSlotsToDuration', () => {
  const sheets = [1, 2, 3, 4];
  // Tuesday afternoon: group event ends at 3:00 on two sheets, ice preparation starts at 4:30 on every sheet.
  const events = [
    { start: at(13 * 60), end: at(15 * 60), sheetIds: [2, 3], title: 'Group Event (2)' },
    { start: at(16 * 60 + 30), end: at(18 * 60), sheetIds: sheets, title: 'Ice Preparation' },
  ];

  test('a 1-hour start at 3:00 is free when preparation starts at 4:30', () => {
    const slots = refitSlotsToDuration(
      [{ start: at(15 * 60), end: at(17 * 60), availableSheetIds: [], unavailableReason: 'sheets_busy' }],
      60,
      sheets,
      events
    );
    expect(slots[0]!.unavailableReason).toBeUndefined();
    expect(slots[0]!.availableSheetIds).toEqual(sheets);
    expect(slots[0]!.end).toEqual(at(16 * 60));
  });

  test('a 2-hour start at 3:00 runs into preparation on every sheet', () => {
    const slots = refitSlotsToDuration(
      [{ start: at(15 * 60), end: at(16 * 60), availableSheetIds: sheets }],
      120,
      sheets,
      events
    );
    expect(slots[0]!.unavailableReason).toBe('sheets_busy');
    expect(startSlotIsBlocked(slots[0]!, sheets, events)).toBe(true);
  });

  test('90 minutes ends as preparation starts and stays free', () => {
    const slots = refitSlotsToDuration(
      [{ start: at(15 * 60), end: at(15 * 60), availableSheetIds: [] }],
      90,
      sheets,
      events
    );
    expect(slots[0]!.unavailableReason).toBeUndefined();
  });
});

describe('suggestShorterDuration', () => {
  const sheets = [1, 2, 3, 4];
  const events = [
    { start: at(13 * 60), end: at(15 * 60), sheetIds: [2, 3], title: 'Group Event (2)' },
    { start: at(16 * 60 + 30), end: at(18 * 60), sheetIds: sheets, title: 'Ice Preparation' },
  ];

  test('after 2:30 has started, a 2-hour booking has no start but 90 minutes fits at 3:00', () => {
    const slots: StartSlotOccupancy[] = [];
    for (let minutes = 14 * 60; minutes <= 16 * 60; minutes += 15) {
      slots.push({
        start: at(minutes),
        end: at(minutes + 120),
        availableSheetIds: [],
        ...(minutes < 15 * 60 ? { unavailableReason: 'past' as const } : {}),
      });
    }
    const suggestion = suggestShorterDuration({
      slots,
      durationMinutes: 120,
      sheetIds: sheets,
      events,
      minMinutes: 15,
      stepMinutes: 15,
    });
    expect(suggestion).toEqual({
      start: at(15 * 60),
      durationMinutes: 90,
      beforeTitle: 'Ice Preparation',
    });
  });

  test('does not suggest a shorter booking when the selected duration already fits', () => {
    const slots: StartSlotOccupancy[] = [
      { start: at(15 * 60), end: at(16 * 60), availableSheetIds: sheets },
    ];
    expect(
      suggestShorterDuration({
        slots,
        durationMinutes: 60,
        sheetIds: sheets,
        events,
        minMinutes: 15,
        stepMinutes: 15,
      })
    ).toBeNull();
  });
});

describe('hatchBands', () => {
  test('the lead-in before 10:15 is one band that reaches 10:15', () => {
    const pxPerMinute = 2;
    const gridStart = 6 * 60;
    const topFor = (value: Date) => (value.getHours() * 60 + value.getMinutes() - gridStart) * pxPerMinute;
    const bands = hatchBands([{ start: at(8 * 60 + 30), end: at(10 * 60 + 15) }], topFor);
    expect(bands).toEqual([{ top: (8 * 60 + 30 - gridStart) * pxPerMinute, height: 105 * pxPerMinute }]);
  });
});
