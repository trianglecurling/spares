import { describe, expect, test } from 'bun:test';
import {
  formatRegistrationOpensAt,
  getEventDateRailLabels,
  getPublicEventRegistrationStatusLines,
} from './publicEventCardUtils';

const baseEvent = {
  capacity: 20 as number | null,
  enableWaitlist: 1,
  registrationStart: '2026-08-01T13:00:00.000Z',
  registrationCutoff: '2026-09-01T13:00:00.000Z',
  timespans: [{ start_dt: '2026-09-15T18:00:00.000Z', end_dt: '2026-09-15T21:00:00.000Z' }],
  confirmedCount: 5,
  waitlistedCount: 0,
  openSpots: 15,
  serverNow: '2026-08-15T12:00:00.000Z',
};

describe('getPublicEventRegistrationStatusLines', () => {
  test('shows open date before registration starts', () => {
    const lines = getPublicEventRegistrationStatusLines({
      ...baseEvent,
      serverNow: '2026-07-15T12:00:00.000Z',
      confirmedCount: 0,
      openSpots: 20,
    });
    expect(lines.timingLine).toBe(formatRegistrationOpensAt(baseEvent.registrationStart));
    expect(lines.capacityLines).toEqual(['0 of 20 registered']);
  });

  test('shows registered count while registration is open without spots remaining', () => {
    const lines = getPublicEventRegistrationStatusLines(baseEvent);
    expect(lines.timingLine).toBeNull();
    expect(lines.capacityLines).toEqual(['5 of 20 registered']);
  });

  test('shows full and waitlist status when full', () => {
    const lines = getPublicEventRegistrationStatusLines({
      ...baseEvent,
      confirmedCount: 20,
      waitlistedCount: 3,
      openSpots: 0,
    });
    expect(lines.timingLine).toBeNull();
    expect(lines.capacityLines).toEqual([
      'Full – waitlist available',
      '3 entries on waitlist',
    ]);
  });

  test('shows registration closed after cutoff', () => {
    const lines = getPublicEventRegistrationStatusLines({
      ...baseEvent,
      serverNow: '2026-09-10T12:00:00.000Z',
      openSpots: 2,
      confirmedCount: 18,
    });
    expect(lines.timingLine).toBe('Registration closed');
    expect(lines.capacityLines).toEqual(['18 of 20 registered']);
  });

  test('omits capacity lines when unlimited', () => {
    const lines = getPublicEventRegistrationStatusLines({
      ...baseEvent,
      capacity: null,
      openSpots: null,
    });
    expect(lines.timingLine).toBeNull();
    expect(lines.capacityLines).toEqual([]);
  });
});

describe('getEventDateRailLabels', () => {
  test('same-day event', () => {
    const start = new Date(2026, 8, 15, 18, 0, 0);
    const end = new Date(2026, 8, 15, 21, 0, 0);
    expect(
      getEventDateRailLabels([
        { start_dt: start.toISOString(), end_dt: end.toISOString() },
      ]),
    ).toEqual({
      monthLabel: start.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      dayLabel: '15',
    });
  });
});
