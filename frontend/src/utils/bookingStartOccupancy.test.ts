import { describe, expect, test } from 'bun:test';
import {
  blockedStartRanges,
  refitSlotsToDuration,
  slotIsOpen,
  startsWithinDay,
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

describe('refitSlotsToDuration against an all-sheet event', () => {
  const event = { start: at(10 * 60 + 15), end: at(12 * 60 + 15), sheetIds: SHEETS };
  const isOpen = (startMinutes: number, sheetIds = SHEETS) =>
    slotIsOpen(refitSlotsToDuration([openSlot(startMinutes)], 120, SHEETS, [{ ...event, sheetIds }])[0]!);

  test('a 2-hour booking that ends as the event starts is free', () => {
    expect(isOpen(8 * 60 + 15)).toBe(true);
  });

  test('the next 15-minute start runs into the event', () => {
    expect(isOpen(8 * 60 + 30)).toBe(false);
    expect(isOpen(9 * 60 + 45)).toBe(false);
    expect(isOpen(10 * 60)).toBe(false);
  });

  test('a block on fewer than all sheets still leaves a place to start', () => {
    expect(isOpen(8 * 60 + 30, [1, 2, 3])).toBe(true);
  });
});

describe('blockedStartRanges', () => {
  test('a 2-hour lead-in before a 10:15 all-sheet event reaches 10:15', () => {
    const event = { start: at(10 * 60 + 15), end: at(12 * 60 + 15), sheetIds: SHEETS };
    const fetched: StartSlotOccupancy[] = [];
    for (let minutes = 8 * 60; minutes <= 12 * 60; minutes += 15) fetched.push(openSlot(minutes));

    const ranges = blockedStartRanges(refitSlotsToDuration(fetched, 120, SHEETS, [event]), 15);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.start).toEqual(at(8 * 60 + 30));
    expect(ranges[0]!.end.getTime()).toBeGreaterThanOrEqual(at(10 * 60 + 15).getTime());
  });

  test('open starts split blocked runs', () => {
    const slots: StartSlotOccupancy[] = [
      { start: at(0), end: at(60), availableSheetIds: [], unavailableReason: 'past' },
      { start: at(15), end: at(75), availableSheetIds: [], unavailableReason: 'past' },
      openSlot(30, 60),
      { start: at(45), end: at(105), availableSheetIds: [], unavailableReason: 'sheets_busy' },
    ];
    expect(blockedStartRanges(slots, 15)).toEqual([
      { start: at(0), end: at(30) },
      { start: at(45), end: at(60) },
    ]);
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
    expect(slotIsOpen(slots[0]!)).toBe(false);
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

  test('a start that overlaps one of the member’s bookings is a member conflict', () => {
    const slots = refitSlotsToDuration([openSlot(9 * 60, 60)], 60, sheets, [], [
      { start: at(9 * 60 + 30), end: at(10 * 60 + 30) },
    ]);
    expect(slots[0]!.unavailableReason).toBe('member_conflict');
  });

  test('past starts stay past', () => {
    const slots = refitSlotsToDuration(
      [{ start: at(9 * 60), end: at(10 * 60), availableSheetIds: [], unavailableReason: 'past' }],
      30,
      sheets,
      []
    );
    expect(slots[0]).toEqual({
      start: at(9 * 60),
      end: at(9 * 60 + 30),
      availableSheetIds: [],
      unavailableReason: 'past',
    });
  });
});

describe('startsWithinDay', () => {
  const day = at(0);
  const quarterHours = Array.from({ length: 96 }, (_, i) => openSlot(i * 15, 15));
  const startMinutes = (slots: StartSlotOccupancy[]) =>
    slots.map((slot) => slot.start.getHours() * 60 + slot.start.getMinutes());

  test('drops starts before the earliest hour', () => {
    expect(startMinutes(startsWithinDay(quarterHours, day, 6, 15))[0]).toBe(6 * 60);
  });

  test('drops starts whose booking would run past midnight', () => {
    expect(startMinutes(startsWithinDay(quarterHours, day, 6, 180)).pop()).toBe(21 * 60);
    expect(startMinutes(startsWithinDay(quarterHours, day, 6, 15)).pop()).toBe(23 * 60 + 45);
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
