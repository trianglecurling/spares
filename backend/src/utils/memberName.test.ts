import { describe, expect, test } from 'bun:test';
import {
  formatMemberDisplayName,
  memberNameMatchKey,
  normalizeOptionalPersonName,
  normalizePersonName,
  repairUtf8Mojibake,
  resolveMemberNameFields,
  splitMemberDisplayName,
} from './memberName.js';

describe('normalizePersonName', () => {
  test('repairs Windows-1252 mojibake of a curly apostrophe', () => {
    expect(normalizePersonName('Tony D\u00E2\u20AC\u2122Agostino')).toBe("Tony D'Agostino");
  });

  test('turns typographic apostrophes into ASCII apostrophes', () => {
    expect(normalizePersonName('Tony D\u2019Agostino')).toBe("Tony D'Agostino");
    expect(normalizePersonName("Tony D'Agostino")).toBe("Tony D'Agostino");
  });

  test('decodes HTML apostrophe entities', () => {
    expect(normalizePersonName('Tony D&rsquo;Agostino')).toBe("Tony D'Agostino");
    expect(normalizePersonName('Tony D&#8217;Agostino')).toBe("Tony D'Agostino");
  });

  test('preserves letters with diacritics', () => {
    expect(normalizePersonName('José García')).toBe('José García');
    expect(normalizePersonName('François')).toBe('François');
    expect(normalizePersonName('Søren')).toBe('Søren');
    expect(normalizePersonName('Château')).toBe('Château');
  });

  test('keeps Hawaiian okina', () => {
    expect(normalizePersonName('Hawai\u02BBi')).toBe('Hawai\u02BBi');
  });

  test('collapses whitespace', () => {
    expect(normalizePersonName('  Tony   D’Agostino  ')).toBe("Tony D'Agostino");
  });

  test('returns empty for nullish input', () => {
    expect(normalizePersonName(null)).toBe('');
    expect(normalizePersonName(undefined)).toBe('');
    expect(normalizeOptionalPersonName(null)).toBeNull();
    expect(normalizeOptionalPersonName('  ')).toBeNull();
  });
});

describe('repairUtf8Mojibake', () => {
  test('repairs accented-letter mojibake', () => {
    expect(repairUtf8Mojibake('Jos\u00C3\u00A9')).toBe('José');
  });

  test('leaves legitimate circumflex letters alone', () => {
    expect(repairUtf8Mojibake('Château')).toBe('Château');
  });
});

describe('resolveMemberNameFields', () => {
  test('normalizes first and last name on save', () => {
    expect(
      resolveMemberNameFields({
        firstName: 'Tony',
        lastName: 'D\u00E2\u20AC\u2122Agostino',
      })
    ).toEqual({
      firstName: 'Tony',
      lastName: "D'Agostino",
      name: "Tony D'Agostino",
    });
  });

  test('treats curly and mojibake apostrophes as the same match key', () => {
    expect(memberNameMatchKey('Tony', 'D\u2019Agostino')).toBe(memberNameMatchKey('Tony', "D'Agostino"));
  });
});

describe('split and format', () => {
  test('splits a repaired full name', () => {
    expect(splitMemberDisplayName('Tony D\u00E2\u20AC\u2122Agostino')).toEqual({
      firstName: 'Tony',
      lastName: "D'Agostino",
    });
  });

  test('formats first and last with normalization', () => {
    expect(formatMemberDisplayName('Tony', 'D\u2019Agostino')).toBe("Tony D'Agostino");
  });
});
