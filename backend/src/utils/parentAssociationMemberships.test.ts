import { describe, expect, test } from 'bun:test';
import {
  booleanFromSqliteFlag,
  defaultUsaCurlingMembershipOptIn,
  defaultUswcaMembershipOptIn,
  membershipAppliesParentAssociations,
  shouldCollectParentAssociationOptIns,
  sqliteFlagFromBoolean,
} from './parentAssociationMemberships.js';

describe('parent association memberships', () => {
  test('regular, social, spare-only, and Junior Recreational show parent associations', () => {
    expect(membershipAppliesParentAssociations('regular')).toBe(true);
    expect(membershipAppliesParentAssociations('social')).toBe(true);
    expect(membershipAppliesParentAssociations('regular_spare_only')).toBe(true);
    expect(membershipAppliesParentAssociations('junior_recreational')).toBe(true);
    expect(membershipAppliesParentAssociations('none')).toBe(false);
    expect(membershipAppliesParentAssociations(null)).toBe(false);
  });

  test('lifetime members always collect parent association opt-ins', () => {
    expect(shouldCollectParentAssociationOptIns(null, true)).toBe(true);
    expect(shouldCollectParentAssociationOptIns('none', true)).toBe(true);
    expect(shouldCollectParentAssociationOptIns('regular', true)).toBe(true);
    expect(shouldCollectParentAssociationOptIns(null, false)).toBe(false);
    expect(shouldCollectParentAssociationOptIns('regular', false)).toBe(true);
  });

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
