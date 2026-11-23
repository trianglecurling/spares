import { describe, expect, test } from 'bun:test';
import {
  PaymentRefundListError,
  resolveRefundIssuedBounds,
  utcInstantToSqliteDateTime,
} from './listAdminRefunds.js';

describe('resolveRefundIssuedBounds', () => {
  test('returns no bounds when no range is selected', () => {
    expect(
      resolveRefundIssuedBounds({
        todayLocal: '2026-10-21',
        timeZone: 'America/New_York',
      })
    ).toEqual({});
  });

  test('custom range uses club-local midnights', () => {
    const bounds = resolveRefundIssuedBounds({
      range: 'custom',
      from: '2026-10-21',
      to: '2026-10-21',
      todayLocal: '2026-10-21',
      timeZone: 'America/New_York',
    });
    expect(bounds.fromUtc?.toISOString()).toBe('2026-10-21T04:00:00.000Z');
    expect(bounds.toExclusiveUtc?.toISOString()).toBe('2026-10-22T04:00:00.000Z');
    expect(utcInstantToSqliteDateTime(bounds.fromUtc!)).toBe('2026-10-21 04:00:00');
  });

  test('rejects an end date before the start date', () => {
    expect(() =>
      resolveRefundIssuedBounds({
        range: 'custom',
        from: '2026-10-22',
        to: '2026-10-21',
        todayLocal: '2026-10-21',
        timeZone: 'America/New_York',
      })
    ).toThrow(PaymentRefundListError);
  });

  test('rejects a calendar date that does not exist', () => {
    expect(() =>
      resolveRefundIssuedBounds({
        range: 'custom',
        from: '2026-02-31',
        todayLocal: '2026-10-21',
        timeZone: 'America/New_York',
      })
    ).toThrow(PaymentRefundListError);
  });
});
