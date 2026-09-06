import { describe, expect, test } from 'bun:test';
import { parseCsv, parseRosterExportCsv, rosterExportToCsv } from './rosterRebuildReports.js';

describe('roster rebuild CSV helpers', () => {
  test('round-trips an export row that contains commas and quotes', () => {
    const csv = rosterExportToCsv([
      {
        leagueId: 1,
        leagueName: 'Hump Day',
        memberId: 10,
        memberName: 'Smith, "Pat"',
        memberEmail: 'pat@example.com',
        status: 'active',
        placementType: 'guaranteed_return',
        isTemporarySabbaticalFill: false,
        sourceRegistrationId: 44,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const parsed = parseRosterExportCsv(csv);
    expect(parsed).toEqual([
      {
        leagueId: 1,
        memberId: 10,
        leagueName: 'Hump Day',
        memberName: 'Smith, "Pat"',
        memberEmail: 'pat@example.com',
        status: 'active',
      },
    ]);
  });

  test('parseCsv strips the BOM and ignores blank lines', () => {
    const { headers, rows } = parseCsv('\uFEFFa,b\n1,2\n\n');
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([['1', '2']]);
  });
});
