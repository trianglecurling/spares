import { describe, expect, test } from 'bun:test';
import { isPersonAccount, isServiceAccount, personAccountsOnly } from './accountKind.js';

describe('accountKind', () => {
  test('treats missing account_kind as a person', () => {
    expect(isPersonAccount({})).toBe(true);
    expect(isServiceAccount({})).toBe(false);
    expect(isPersonAccount({ account_kind: null })).toBe(true);
    expect(isPersonAccount({ account_kind: 'person' })).toBe(true);
  });

  test('identifies service accounts', () => {
    expect(isServiceAccount({ account_kind: 'service' })).toBe(true);
    expect(isPersonAccount({ account_kind: 'service' })).toBe(false);
  });

  test('filters person accounts', () => {
    expect(
      personAccountsOnly([
        { id: 1, account_kind: 'person' },
        { id: 2, account_kind: 'service' },
        { id: 3 },
      ]).map((row) => row.id)
    ).toEqual([1, 3]);
  });
});
