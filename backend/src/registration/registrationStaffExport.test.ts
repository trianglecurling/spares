import { describe, expect, test } from 'bun:test';
import {
  LEAGUE_PRIORITIES_EXPORT_KEY,
  buildRegistrationExportTable,
  csvCell,
  leaguePriorityHeader,
  registrationExportColumnCatalog,
  resolveRegistrationExportColumns,
  toCsv,
} from './registrationStaffExport.js';

describe('registration export columns', () => {
  test('includes a single league-priorities column in the catalog', () => {
    const catalog = registrationExportColumnCatalog();
    const leagueColumns = catalog.filter((column) => column.kind === 'leaguePriorities');
    expect(leagueColumns).toEqual([
      expect.objectContaining({
        key: LEAGUE_PRIORITIES_EXPORT_KEY,
        label: 'League priorities',
      }),
    ]);
    expect(catalog.some((column) => column.key === 'membershipOption')).toBe(true);
    expect(catalog.some((column) => column.key === 'email')).toBe(true);
    expect(catalog.some((column) => column.key === 'paymentStatus')).toBe(true);
  });

  test('drops unknown and duplicate selected keys while preserving order', () => {
    const resolved = resolveRegistrationExportColumns(['email', 'missing', 'firstName', 'email', 'id']);
    expect(resolved.map((column) => column.key)).toEqual(['email', 'firstName', 'id']);
  });
});

describe('buildRegistrationExportTable', () => {
  test('expands league priorities to the smallest number of columns needed', () => {
    const table = buildRegistrationExportTable(
      ['firstName', LEAGUE_PRIORITIES_EXPORT_KEY, 'email'],
      [
        { values: { firstName: 'Ada', email: 'ada@example.com' }, leaguePriorities: ['Monday Night'] },
        {
          values: { firstName: 'Grace', email: 'grace@example.com' },
          leaguePriorities: ['Tuesday Draw', 'Thursday Draw', 'Sunday Open'],
        },
      ],
    );

    expect(table.headers).toEqual([
      'First name',
      leaguePriorityHeader(1),
      leaguePriorityHeader(2),
      leaguePriorityHeader(3),
      'Email',
    ]);
    expect(table.records).toEqual([
      ['Ada', 'Monday Night', '', '', 'ada@example.com'],
      ['Grace', 'Tuesday Draw', 'Thursday Draw', 'Sunday Open', 'grace@example.com'],
    ]);
  });

  test('omits league-priority columns when nobody has a priority list', () => {
    const table = buildRegistrationExportTable(
      [LEAGUE_PRIORITIES_EXPORT_KEY, 'id'],
      [{ values: { id: '12' }, leaguePriorities: [] }],
    );
    expect(table.headers).toEqual(['Registration ID']);
    expect(table.records).toEqual([['12']]);
  });
});

describe('csv helpers', () => {
  test('quotes commas, quotes, and line breaks', () => {
    expect(csvCell('Monday Night')).toBe('Monday Night');
    expect(csvCell('Night, draw')).toBe('"Night, draw"');
    expect(csvCell('Say "hello"')).toBe('"Say ""hello"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  test('includes a UTF-8 BOM and CRLF rows so spreadsheets open cleanly', () => {
    const csv = toCsv(['Name', 'Note'], [['Ada', 'ok']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Name,Note\r\nAda,ok\r\n');
  });
});
