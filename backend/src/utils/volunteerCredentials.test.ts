import { describe, expect, test } from 'bun:test';
import {
  heldVolunteerCredentialIdsOn,
  volunteerCredentialIsValidOn,
} from './volunteerCredentials.js';

describe('volunteerCredentialIsValidOn', () => {
  test('treats a missing expiration as always valid', () => {
    expect(volunteerCredentialIsValidOn(null, '2026-08-24')).toBe(true);
    expect(volunteerCredentialIsValidOn(undefined, '2026-08-24')).toBe(true);
    expect(volunteerCredentialIsValidOn('', '2026-08-24')).toBe(true);
  });

  test('is valid through the expiration date', () => {
    expect(volunteerCredentialIsValidOn('2026-09-01', '2026-08-31')).toBe(true);
    expect(volunteerCredentialIsValidOn('2026-09-01', '2026-09-01')).toBe(true);
    expect(volunteerCredentialIsValidOn('2026-09-01', '2026-09-02')).toBe(false);
  });
});

describe('heldVolunteerCredentialIdsOn', () => {
  const grants = [
    { credentialId: 1, expiresAt: null },
    { credentialId: 2, expiresAt: '2026-09-01' },
    { credentialId: 3, expiresAt: '2026-08-01' },
  ];

  test('includes unexpired grants as of the given date', () => {
    expect([...heldVolunteerCredentialIdsOn(grants, '2026-09-01')].sort()).toEqual([1, 2]);
  });

  test('drops grants that have already expired', () => {
    expect([...heldVolunteerCredentialIdsOn(grants, '2026-09-02')].sort()).toEqual([1]);
  });
});
