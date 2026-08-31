import { describe, expect, test } from 'bun:test';
import {
  SYSTEM_CREDENTIAL_KEYS,
  memberHoldsSystemCredential,
  parseSystemCredentialKey,
} from './systemCredentials.js';

const adultMember = {
  isCurrentMember: true,
  hasIcePrivileges: true,
  ageYears: 34,
};

describe('parseSystemCredentialKey', () => {
  test('accepts known keys', () => {
    expect(parseSystemCredentialKey('current_member')).toBe(SYSTEM_CREDENTIAL_KEYS.currentMember);
    expect(parseSystemCredentialKey('has_ice_privileges')).toBe(SYSTEM_CREDENTIAL_KEYS.hasIcePrivileges);
    expect(parseSystemCredentialKey('over_18')).toBe(SYSTEM_CREDENTIAL_KEYS.over18);
    expect(parseSystemCredentialKey('over_21')).toBe(SYSTEM_CREDENTIAL_KEYS.over21);
  });

  test('rejects unknown or empty values', () => {
    expect(parseSystemCredentialKey('club_credit_card_holder')).toBeNull();
    expect(parseSystemCredentialKey('')).toBeNull();
    expect(parseSystemCredentialKey(null)).toBeNull();
  });
});

describe('memberHoldsSystemCredential', () => {
  test('current member follows membership, not ice privileges', () => {
    expect(memberHoldsSystemCredential(SYSTEM_CREDENTIAL_KEYS.currentMember, adultMember)).toBe(true);
    expect(
      memberHoldsSystemCredential(SYSTEM_CREDENTIAL_KEYS.currentMember, {
        ...adultMember,
        isCurrentMember: false,
        hasIcePrivileges: true,
      }),
    ).toBe(false);
    expect(
      memberHoldsSystemCredential(SYSTEM_CREDENTIAL_KEYS.currentMember, {
        isCurrentMember: true,
        hasIcePrivileges: false,
        ageYears: 16,
      }),
    ).toBe(true);
  });

  test('ice privileges is independent of age', () => {
    expect(memberHoldsSystemCredential(SYSTEM_CREDENTIAL_KEYS.hasIcePrivileges, adultMember)).toBe(true);
    expect(
      memberHoldsSystemCredential(SYSTEM_CREDENTIAL_KEYS.hasIcePrivileges, {
        ...adultMember,
        hasIcePrivileges: false,
      }),
    ).toBe(false);
  });

  test('age credentials require a known date of birth and use inclusive thresholds', () => {
    expect(memberHoldsSystemCredential(SYSTEM_CREDENTIAL_KEYS.over18, { ...adultMember, ageYears: null })).toBe(
      false,
    );
    expect(memberHoldsSystemCredential(SYSTEM_CREDENTIAL_KEYS.over18, { ...adultMember, ageYears: 17 })).toBe(
      false,
    );
    expect(memberHoldsSystemCredential(SYSTEM_CREDENTIAL_KEYS.over18, { ...adultMember, ageYears: 18 })).toBe(
      true,
    );
    expect(memberHoldsSystemCredential(SYSTEM_CREDENTIAL_KEYS.over21, { ...adultMember, ageYears: 20 })).toBe(
      false,
    );
    expect(memberHoldsSystemCredential(SYSTEM_CREDENTIAL_KEYS.over21, { ...adultMember, ageYears: 21 })).toBe(
      true,
    );
  });
});
