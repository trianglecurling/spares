import { describe, expect, test } from 'bun:test';
import {
  resolveMemberExperienceBaselineImportRowMatch,
  validateMemberExperienceBaselineImportRow,
} from './memberExperienceBaselineImport.js';

describe('memberExperienceBaselineImport validation', () => {
  test('accepts valid rows matched by email', () => {
    expect(
      validateMemberExperienceBaselineImportRow(
        {
          email: 'curl@tgau.me',
          baselineOtherClubExperienceYears: 0,
          baselineClubExperienceYears: 10,
          name: 'Trevor Gau',
        },
        'Row 2',
      ),
    ).toBeNull();
  });

  test('accepts valid rows matched by name when email is absent', () => {
    expect(
      validateMemberExperienceBaselineImportRow(
        {
          name: 'Jeff Kosokoff',
          baselineOtherClubExperienceYears: 0,
          baselineClubExperienceYears: 8,
        },
        'Row 3',
      ),
    ).toBeNull();
  });

  test('rejects rows with neither email nor name', () => {
    expect(
      validateMemberExperienceBaselineImportRow(
        {
          baselineOtherClubExperienceYears: 0,
          baselineClubExperienceYears: 1,
        },
        'Row 4',
      ),
    ).toContain('Email or name is required');
  });

  test('rejects invalid half-year values', () => {
    expect(
      validateMemberExperienceBaselineImportRow(
        {
          email: 'curl@tgau.me',
          baselineOtherClubExperienceYears: 1.25,
          baselineClubExperienceYears: 10,
        },
        'Row 2',
      ),
    ).toContain('.5');
  });
});

describe('resolveMemberExperienceBaselineImportRowMatch', () => {
  const indexes = {
    byEmail: new Map([
      [
        'shared@example.com',
        [
          { id: 1, name: 'Alex Parent', email: 'shared@example.com', nameKey: 'alex|parent' },
          { id: 2, name: 'Jamie Child', email: 'shared@example.com', nameKey: 'jamie|child' },
        ],
      ],
      ['solo@example.com', [{ id: 3, name: 'Solo Member', email: 'solo@example.com', nameKey: 'solo|member' }]],
    ]),
    byName: new Map([
      ['alex|parent', [{ id: 1, name: 'Alex Parent', email: 'shared@example.com', nameKey: 'alex|parent' }]],
      ['jamie|child', [{ id: 2, name: 'Jamie Child', email: 'shared@example.com', nameKey: 'jamie|child' }]],
    ]),
  };

  test('resolves a unique email match without using name', () => {
    const result = resolveMemberExperienceBaselineImportRowMatch(
      {
        email: 'solo@example.com',
        baselineOtherClubExperienceYears: 0,
        baselineClubExperienceYears: 1,
      },
      indexes,
    );
    expect(result.match?.id).toBe(3);
    expect(result.status).toBeUndefined();
  });

  test('disambiguates shared email using name', () => {
    const result = resolveMemberExperienceBaselineImportRowMatch(
      {
        email: 'shared@example.com',
        name: 'Jamie Child',
        baselineOtherClubExperienceYears: 0,
        baselineClubExperienceYears: 2,
      },
      indexes,
    );
    expect(result.match?.id).toBe(2);
    expect(result.status).toBeUndefined();
  });

  test('fails ambiguous email when name is missing', () => {
    const result = resolveMemberExperienceBaselineImportRowMatch(
      {
        email: 'shared@example.com',
        baselineOtherClubExperienceYears: 0,
        baselineClubExperienceYears: 2,
      },
      indexes,
    );
    expect(result.match).toBeUndefined();
    expect(result.status).toBe('ambiguous_email');
  });

  test('fails not found when name does not match any shared-email member', () => {
    const result = resolveMemberExperienceBaselineImportRowMatch(
      {
        email: 'shared@example.com',
        name: 'Nobody Here',
        baselineOtherClubExperienceYears: 0,
        baselineClubExperienceYears: 2,
      },
      indexes,
    );
    expect(result.match).toBeUndefined();
    expect(result.status).toBe('not_found');
    expect(result.message).toContain('matches the provided name');
  });
});
