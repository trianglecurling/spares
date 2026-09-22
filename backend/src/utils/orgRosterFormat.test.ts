import { describe, expect, test } from 'bun:test';
import { USA_CURLING_CLUB_VALUE } from './parentOrganizations.js';
import {
  buildUsaCurlingRosterTsv,
  buildUswcaRosterTsv,
  formatUsaSpreadsheetDate,
  tsvCell,
  usaCurlingFromAnotherClub,
  usaCurlingMembershipType,
} from './orgRosterFormat.js';

describe('org roster format', () => {
  test('formats ISO dates as MM/DD/YYYY', () => {
    expect(formatUsaSpreadsheetDate('2026-09-22')).toBe('09/22/2026');
    expect(formatUsaSpreadsheetDate('')).toBe('');
    expect(formatUsaSpreadsheetDate(null)).toBe('');
  });

  test('maps junior recreational and age 21 and under to Youth', () => {
    expect(
      usaCurlingMembershipType({
        membershipType: 'junior_recreational',
        dateOfBirth: '1990-01-01',
        asOfDate: '2026-09-22',
      }),
    ).toBe('Youth');
    expect(
      usaCurlingMembershipType({
        membershipType: 'regular',
        dateOfBirth: '2005-09-22',
        asOfDate: '2026-09-22',
      }),
    ).toBe('Youth');
    expect(
      usaCurlingMembershipType({
        membershipType: 'regular',
        dateOfBirth: '2004-09-21',
        asOfDate: '2026-09-22',
      }),
    ).toBe('Basic');
  });

  test('from another club is true when other-club years are above zero', () => {
    expect(usaCurlingFromAnotherClub(0)).toBe(false);
    expect(usaCurlingFromAnotherClub(0.5)).toBe(true);
    expect(usaCurlingFromAnotherClub(null)).toBe(false);
  });

  test('quotes TSV cells that contain tabs or quotes', () => {
    expect(tsvCell('plain')).toBe('plain');
    expect(tsvCell('has\ttab')).toBe('"has\ttab"');
    expect(tsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  test('builds USA Curling data rows without a header', () => {
    const tsv = buildUsaCurlingRosterTsv([
      {
        email: 'pat@example.com',
        firstName: 'Pat',
        lastName: 'Stone',
        gender: 'Female',
        dateOfBirth: '1991-04-03',
        membershipNumber: '12345',
        validFrom: '2026-09-22',
        membershipType: 'Basic',
        fromAnotherClub: true,
      },
    ]);
    expect(tsv.startsWith('Email')).toBe(false);
    expect(tsv).toBe(
      [
        'pat@example.com',
        'Pat',
        'Stone',
        'Female',
        '04/03/1991',
        '12345',
        '09/22/2026',
        USA_CURLING_CLUB_VALUE,
        'Basic',
        '',
        '',
        'Yes',
      ].join('\t'),
    );
  });

  test('builds USWCA data rows as last name, first name, email', () => {
    expect(
      buildUswcaRosterTsv([{ lastName: 'Stone', firstName: 'Pat', email: 'pat@example.com' }]),
    ).toBe('Stone\tPat\tpat@example.com');
  });
});
