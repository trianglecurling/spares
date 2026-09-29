import { parseFiscalYearStartMmdd } from '../utils/fiscalSeason.js';
import { addCalendarDays } from '../utils/timeZone.js';

export const EXPENSE_DATE_RANGES = ['this_month', 'last_month', 'this_fiscal_year', 'custom'] as const;
export type ExpenseDateRange = (typeof EXPENSE_DATE_RANGES)[number];

/** Club-local calendar bounds: `from` inclusive, `toExclusive` exclusive (YYYY-MM-DD). */
export type ExpenseDateBounds = {
  from?: string;
  toExclusive?: string;
};

export class ExpenseDateRangeError extends Error {
  constructor(
    message: string,
    public field: 'from' | 'to'
  ) {
    super(message);
    this.name = 'ExpenseDateRangeError';
  }
}

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isValidYmd(value: string): boolean {
  return YMD_PATTERN.test(value) && addCalendarDays(value, 0) === value;
}

function monthStart(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-01`;
}

export function resolveExpenseDateBounds(input: {
  range?: ExpenseDateRange | '';
  from?: string;
  to?: string;
  todayLocal: string;
  fiscalYearStartMmdd: string | null | undefined;
}): ExpenseDateBounds {
  const year = Number(input.todayLocal.slice(0, 4));
  const month = Number(input.todayLocal.slice(5, 7));

  switch (input.range) {
    case 'this_month':
      return { from: monthStart(year, month), toExclusive: monthStart(year, month + 1) };
    case 'last_month':
      return { from: monthStart(year, month - 1), toExclusive: monthStart(year, month) };
    case 'this_fiscal_year': {
      const fiscal = parseFiscalYearStartMmdd(input.fiscalYearStartMmdd);
      const fiscalMmdd = `${pad(fiscal.month)}-${pad(fiscal.day)}`;
      const startYear = input.todayLocal.slice(5) >= fiscalMmdd ? year : year - 1;
      return {
        from: `${startYear}-${fiscalMmdd}`,
        toExclusive: `${startYear + 1}-${fiscalMmdd}`,
      };
    }
    case 'custom': {
      const from = input.from?.trim() || undefined;
      const to = input.to?.trim() || undefined;
      if (from && !isValidYmd(from)) {
        throw new ExpenseDateRangeError('Enter a valid start date.', 'from');
      }
      if (to && !isValidYmd(to)) {
        throw new ExpenseDateRangeError('Enter a valid end date.', 'to');
      }
      if (from && to && from > to) {
        throw new ExpenseDateRangeError('End date must be on or after the start date.', 'to');
      }
      return { from, toExclusive: to ? addCalendarDays(to, 1) : undefined };
    }
    default:
      return {};
  }
}
