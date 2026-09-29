import { describe, expect, test } from 'bun:test';
import { ExpenseDateRangeError, resolveExpenseDateBounds } from './expenseReportDateRange.js';

describe('resolveExpenseDateBounds', () => {
  test('returns no bounds when no range is selected', () => {
    expect(resolveExpenseDateBounds({ todayLocal: '2026-09-29', fiscalYearStartMmdd: '09-01' })).toEqual({});
  });

  test('this month', () => {
    expect(
      resolveExpenseDateBounds({ range: 'this_month', todayLocal: '2026-12-15', fiscalYearStartMmdd: '09-01' })
    ).toEqual({ from: '2026-12-01', toExclusive: '2027-01-01' });
  });

  test('last month rolls back across the year boundary', () => {
    expect(
      resolveExpenseDateBounds({ range: 'last_month', todayLocal: '2026-01-10', fiscalYearStartMmdd: '09-01' })
    ).toEqual({ from: '2025-12-01', toExclusive: '2026-01-01' });
  });

  test('this fiscal year after the fiscal start date', () => {
    expect(
      resolveExpenseDateBounds({ range: 'this_fiscal_year', todayLocal: '2026-09-01', fiscalYearStartMmdd: '09-01' })
    ).toEqual({ from: '2026-09-01', toExclusive: '2027-09-01' });
  });

  test('this fiscal year before the fiscal start date', () => {
    expect(
      resolveExpenseDateBounds({ range: 'this_fiscal_year', todayLocal: '2026-08-31', fiscalYearStartMmdd: '9-1' })
    ).toEqual({ from: '2025-09-01', toExclusive: '2026-09-01' });
  });

  test('custom range includes the end date', () => {
    expect(
      resolveExpenseDateBounds({
        range: 'custom',
        from: '2026-02-01',
        to: '2026-02-28',
        todayLocal: '2026-09-29',
        fiscalYearStartMmdd: '09-01',
      })
    ).toEqual({ from: '2026-02-01', toExclusive: '2026-03-01' });
  });

  test('custom range allows open-ended bounds', () => {
    expect(
      resolveExpenseDateBounds({ range: 'custom', from: '2026-02-01', todayLocal: '2026-09-29', fiscalYearStartMmdd: null })
    ).toEqual({ from: '2026-02-01', toExclusive: undefined });
  });

  test('custom range rejects reversed and invalid dates', () => {
    expect(() =>
      resolveExpenseDateBounds({
        range: 'custom',
        from: '2026-03-01',
        to: '2026-02-01',
        todayLocal: '2026-09-29',
        fiscalYearStartMmdd: '09-01',
      })
    ).toThrow(ExpenseDateRangeError);
    expect(() =>
      resolveExpenseDateBounds({
        range: 'custom',
        from: '2026-02-31',
        todayLocal: '2026-09-29',
        fiscalYearStartMmdd: '09-01',
      })
    ).toThrow(ExpenseDateRangeError);
  });
});
