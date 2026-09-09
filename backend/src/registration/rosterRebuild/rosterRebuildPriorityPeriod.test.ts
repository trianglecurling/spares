import { describe, expect, test } from 'bun:test';
import {
  FALLBACK_PRIORITY_PERIOD_END_ISO,
  receivedDuringPriorityPeriod,
  resolvePriorityPeriodEnd,
} from './rosterRebuildPriorityPeriod.js';

describe('resolvePriorityPeriodEnd', () => {
  test('uses the earliest open transition', () => {
    const period = resolvePriorityPeriodEnd([
      { id: 4, state: 'priority', effectiveAt: '2026-08-20T12:00:00.000Z' },
      { id: 5, state: 'open', effectiveAt: '2026-09-04T04:01:00.000Z' },
    ]);
    expect(period).toEqual({
      endMs: Date.parse('2026-09-04T04:01:00.000Z'),
      endIso: '2026-09-04T04:01:00.000Z',
      source: 'open_transition',
    });
  });

  test('falls back to 12:01am September 4, 2026 EDT', () => {
    const period = resolvePriorityPeriodEnd([{ id: 4, state: 'priority', effectiveAt: '2026-08-20T12:00:00.000Z' }]);
    expect(period.source).toBe('fallback');
    expect(period.endMs).toBe(Date.parse(FALLBACK_PRIORITY_PERIOD_END_ISO));
    expect(period.endIso).toBe('2026-09-04T04:01:00.000Z');
  });
});

describe('receivedDuringPriorityPeriod', () => {
  const endMs = Date.parse('2026-09-04T04:01:00.000Z');

  test('includes submissions before the open cutoff, including early access', () => {
    expect(receivedDuringPriorityPeriod('2026-08-13T02:10:20.564Z', endMs)).toBe(true);
    expect(receivedDuringPriorityPeriod('2026-09-04T04:00:59.999Z', endMs)).toBe(true);
  });

  test('excludes submissions at or after the open cutoff', () => {
    expect(receivedDuringPriorityPeriod('2026-09-04T04:01:00.000Z', endMs)).toBe(false);
    expect(receivedDuringPriorityPeriod('2026-09-05T02:33:09.798Z', endMs)).toBe(false);
  });

  test('treats a missing received-at as outside the priority period', () => {
    expect(receivedDuringPriorityPeriod(null, endMs)).toBe(false);
  });
});
