import { describe, expect, test } from 'bun:test';
import {
  blockedStartRanges,
  hatchBands,
  startSlotIsBlocked,
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

describe('hatchBands', () => {
  test('the lead-in before 10:15 is one band that reaches 10:15', () => {
    const pxPerMinute = 2;
    const gridStart = 6 * 60;
    const topFor = (value: Date) => (value.getHours() * 60 + value.getMinutes() - gridStart) * pxPerMinute;
    const bands = hatchBands([{ start: at(8 * 60 + 30), end: at(10 * 60 + 15) }], topFor);
    expect(bands).toEqual([{ top: (8 * 60 + 30 - gridStart) * pxPerMinute, height: 105 * pxPerMinute }]);
  });
});
