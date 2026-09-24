import { describe, expect, test } from 'bun:test';
import { isLiveScoresWindowOpen } from './fiscalSeason';

const START = '2026-10-01T14:00:00.000Z';
const END = '2026-10-01T18:00:00.000Z';
const HOUR = 60 * 60 * 1000;

describe('isLiveScoresWindowOpen', () => {
  test('stays closed more than 24 hours before the earliest start', () => {
    const now = new Date(START).getTime() - 24 * HOUR - 1;
    expect(isLiveScoresWindowOpen([{ start_dt: START, end_dt: END }], now)).toBe(false);
  });

  test('opens at 24 hours before the earliest start and stays open afterward', () => {
    const startMs = new Date(START).getTime();
    const timespans = [
      { start_dt: '2026-10-02T14:00:00.000Z', end_dt: '2026-10-02T18:00:00.000Z' },
      { start_dt: START, end_dt: END },
    ];
    expect(isLiveScoresWindowOpen(timespans, startMs - 24 * HOUR)).toBe(true);
    expect(isLiveScoresWindowOpen(timespans, startMs + 48 * HOUR)).toBe(true);
  });

  test('stays closed when the event has no start time', () => {
    expect(isLiveScoresWindowOpen([], Date.now())).toBe(false);
    expect(isLiveScoresWindowOpen(undefined, Date.now())).toBe(false);
  });
});
