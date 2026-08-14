import { describe, expect, test } from 'bun:test';
import {
  booleanFromSqliteFlag,
  defaultUsaCurlingMembershipOptIn,
  defaultUswcaMembershipOptIn,
  sqliteFlagFromBoolean,
} from './parentAssociationMemberships.js';

describe('parent association memberships', () => {
  test('USA Curling is opted in by default', () => {
    expect(defaultUsaCurlingMembershipOptIn()).toBe(true);
  });

  test('USWCA defaults on only for She/Her pronouns', () => {
    expect(defaultUswcaMembershipOptIn('She/Her')).toBe(true);
    expect(defaultUswcaMembershipOptIn('He/Him')).toBe(false);
    expect(defaultUswcaMembershipOptIn('They/Them')).toBe(false);
    expect(defaultUswcaMembershipOptIn('Prefer not to say')).toBe(false);
    expect(defaultUswcaMembershipOptIn('')).toBe(false);
  });

  test('sqlite flags round-trip', () => {
    expect(sqliteFlagFromBoolean(true)).toBe(1);
    expect(sqliteFlagFromBoolean(false)).toBe(0);
    expect(sqliteFlagFromBoolean(null)).toBeNull();
    expect(booleanFromSqliteFlag(1)).toBe(true);
    expect(booleanFromSqliteFlag(0)).toBe(false);
    expect(booleanFromSqliteFlag(null)).toBeNull();
  });
});
