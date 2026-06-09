import { describe, expect, test } from 'bun:test';
import {
  memberEmailLookup,
  memberNameLookup,
  parseMemberExperienceBaselineTsv,
  resolveExperienceBaselineMemberMatch,
  summarizeExperienceBaselineImportCoverage,
} from './memberExperienceBaselineImport';

describe('parseMemberExperienceBaselineTsv', () => {
  test('parses the expected spreadsheet format', () => {
    const tsv = `name\temail\tother-years\tour-years\ttotal-years
Trevor Gau\tcurl@tgau.me\t0\t10\t10
Jeff Kosokoff\tkozmoboxman@gmail.com\t0\t8\t8`;

    const result = parseMemberExperienceBaselineTsv(tsv);
    expect(result.fatalError).toBeUndefined();
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      name: 'Trevor Gau',
      email: 'curl@tgau.me',
      baselineOtherClubExperienceYears: 0,
      baselineClubExperienceYears: 10,
      expectedTotalYears: 10,
    });
    expect(result.rows[1]?.totalMismatchWarning).toBeUndefined();
  });

  test('flags total-year mismatches without blocking import', () => {
    const result = parseMemberExperienceBaselineTsv(
      'name\temail\tother-years\tour-years\ttotal-years\nA\ta@example.com\t1\t2\t99',
    );
    expect(result.rows[0]?.totalMismatchWarning).toContain('does not match');
  });

  test('resolves members by stored first and last name when email is absent', () => {
    const members = [
      {
        id: 1,
        name: 'Shelley Walter',
        firstName: 'Shelley',
        lastName: 'Walter',
        email: 'zzzzrn@gmail.com',
      },
    ];
    const match = resolveExperienceBaselineMemberMatch(
      { name: 'Shelley Walter', email: '' },
      memberEmailLookup(members),
      memberNameLookup(members),
    );
    expect(match.member?.id).toBe(1);
    expect(match.issue).toBeUndefined();
  });

  test('accepts name-only rows when email is missing', () => {
    const result = parseMemberExperienceBaselineTsv(
      'name\tother-years\tour-years\nShelley Walter\t0\t1',
    );
    expect(result.fatalError).toBeUndefined();
    expect(result.rows[0]).toMatchObject({
      name: 'Shelley Walter',
      email: '',
      baselineClubExperienceYears: 1,
    });
    expect(result.rows[0]?.parseError).toBeUndefined();
  });

  test('disambiguates shared email using name in preview matching', () => {
    const members = [
      {
        id: 1,
        name: 'Alex Parent',
        firstName: 'Alex',
        lastName: 'Parent',
        email: 'shared@example.com',
      },
      {
        id: 2,
        name: 'Jamie Child',
        firstName: 'Jamie',
        lastName: 'Child',
        email: 'shared@example.com',
      },
    ];
    const match = resolveExperienceBaselineMemberMatch(
      { name: 'Jamie Child', email: 'shared@example.com' },
      memberEmailLookup(members),
      memberNameLookup(members),
    );
    expect(match.member?.id).toBe(2);
    expect(match.issue).toBeUndefined();
  });

  test('flags ambiguous email when name is missing for shared email', () => {
    const members = [
      { id: 1, name: 'Alex Parent', firstName: 'Alex', lastName: 'Parent', email: 'shared@example.com' },
      { id: 2, name: 'Jamie Child', firstName: 'Jamie', lastName: 'Child', email: 'shared@example.com' },
    ];
    const match = resolveExperienceBaselineMemberMatch(
      { name: '', email: 'shared@example.com' },
      memberEmailLookup(members),
      memberNameLookup(members),
    );
    expect(match.member).toBeUndefined();
    expect(match.issue).toContain('Add a name to disambiguate');
    expect(match.status).toBe('ambiguous_email');
  });

  test('summarizes not-found rows and members missing from import', () => {
    const members = [
      { id: 1, name: 'Alex Parent', firstName: 'Alex', lastName: 'Parent', email: 'alex@example.com' },
      { id: 2, name: 'Jamie Child', firstName: 'Jamie', lastName: 'Child', email: 'jamie@example.com' },
      { id: 3, name: 'Solo Member', firstName: 'Solo', lastName: 'Member', email: 'solo@example.com' },
    ];
    const previewRows = [
      {
        lineNumber: 2,
        name: 'Alex Parent',
        email: 'alex@example.com',
        baselineOtherClubExperienceYears: 0,
        baselineClubExperienceYears: 1,
        expectedTotalYears: null,
        matchedMemberId: 1,
        matchStatus: 'matched' as const,
      },
      {
        lineNumber: 3,
        name: 'Nobody',
        email: 'missing@example.com',
        baselineOtherClubExperienceYears: 0,
        baselineClubExperienceYears: 2,
        expectedTotalYears: null,
        matchStatus: 'not_found' as const,
        previewIssue: 'No member in the app matches this email.',
      },
    ];

    const summary = summarizeExperienceBaselineImportCoverage(previewRows, members);
    expect(summary.notFoundRows).toHaveLength(1);
    expect(summary.notFoundRows[0]?.lineNumber).toBe(3);
    expect(summary.membersNotInImport.map((member) => member.id)).toEqual([2, 3]);
  });
});
