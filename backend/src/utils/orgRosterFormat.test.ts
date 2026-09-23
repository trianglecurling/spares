import { describe, expect, test } from 'bun:test';
import { USA_CURLING_CLUB_VALUE } from './parentOrganizations.js';
import {
  buildUsaCurlingRosterTsv,
  buildUswcaRosterTsv,
  formatUsaCurlingPhone,
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

  test('maps members under 18 on the roster date to Youth', () => {
    expect(
      usaCurlingMembershipType({
        dateOfBirth: '2008-09-24',
        asOfDate: '2026-09-23',
      }),
    ).toBe('Youth');
    expect(
      usaCurlingMembershipType({
        dateOfBirth: '2008-09-23',
        asOfDate: '2026-09-23',
      }),
    ).toBe('Basic');
    expect(
      usaCurlingMembershipType({
        dateOfBirth: '1990-01-01',
        asOfDate: '2026-09-23',
      }),
    ).toBe('Basic');
    expect(
      usaCurlingMembershipType({
        dateOfBirth: null,
        asOfDate: '2026-09-23',
      }),
    ).toBe('Basic');
  });

  test('from another club is true when other-club years are above zero', () => {
    expect(usaCurlingFromAnotherClub(0)).toBe(false);
    expect(usaCurlingFromAnotherClub(0.5)).toBe(true);
    expect(usaCurlingFromAnotherClub(null)).toBe(false);
  });

  test('formats USA Curling phones as 10-digit US numbers', () => {
    expect(formatUsaCurlingPhone('919-555-0100')).toBe('(919) 555-0100');
    expect(formatUsaCurlingPhone('(919) 555-0100')).toBe('(919) 555-0100');
    expect(formatUsaCurlingPhone('19195550100')).toBe('(919) 555-0100');
    expect(formatUsaCurlingPhone('+1 (919) 555-0100')).toBe('(919) 555-0100');
    expect(formatUsaCurlingPhone('555-0100')).toBe('');
    expect(formatUsaCurlingPhone('29195550100')).toBe('');
    expect(formatUsaCurlingPhone('91955501001')).toBe('');
    expect(formatUsaCurlingPhone('')).toBe('');
    expect(formatUsaCurlingPhone(null)).toBe('');
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
        primaryContactNumber: '919-555-0100',
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
        '(919) 555-0100',
        '',
        '',
      ].join('\t'),
    );
  });

  test('builds USWCA data rows as last name, first name, email', () => {
    expect(
      buildUswcaRosterTsv([{ lastName: 'Stone', firstName: 'Pat', email: 'pat@example.com' }]),
    ).toBe('Stone\tPat\tpat@example.com');
  });
});
