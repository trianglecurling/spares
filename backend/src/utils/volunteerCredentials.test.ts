import { describe, expect, test } from 'bun:test';
import {
  heldVolunteerCredentialIdsOn,
  volunteerCredentialIsValidOn,
  volunteerProgramVisibleGivenCredentials,
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

describe('volunteerProgramVisibleGivenCredentials', () => {
  const iceTech = { id: 1 };
  const firstAid = { id: 2 };
  const bar = { id: 3 };

  test('keeps programs with no roles', () => {
    expect(volunteerProgramVisibleGivenCredentials({ roles: [] }, [])).toBe(true);
  });

  test('keeps programs that have any role with no credential requirement', () => {
    expect(
      volunteerProgramVisibleGivenCredentials(
        {
          roles: [
            { requiredCredentials: [iceTech] },
            { requiredCredentials: [] },
          ],
        },
        []
      )
    ).toBe(true);
  });

  test('hides programs when the member does not qualify for any role', () => {
    expect(
      volunteerProgramVisibleGivenCredentials(
        {
          roles: [
            { requiredCredentials: [iceTech] },
            { requiredCredentials: [firstAid] },
          ],
        },
        [bar.id]
      )
    ).toBe(false);
    expect(
      volunteerProgramVisibleGivenCredentials(
        {
          roles: [{ requiredCredentials: [iceTech] }],
        },
        []
      )
    ).toBe(false);
  });

  test('shows programs when the member qualifies for at least one role', () => {
    expect(
      volunteerProgramVisibleGivenCredentials(
        {
          roles: [
            { requiredCredentials: [iceTech] },
            { requiredCredentials: [firstAid] },
          ],
        },
        [firstAid.id]
      )
    ).toBe(true);
  });

  test('hides a multi-credential role when the member holds only some of its required credentials', () => {
    expect(
      volunteerProgramVisibleGivenCredentials(
        {
          roles: [{ requiredCredentials: [iceTech, firstAid] }],
        },
        [iceTech.id]
      )
    ).toBe(false);
  });

  test('shows a multi-credential role when the member holds every required credential', () => {
    expect(
      volunteerProgramVisibleGivenCredentials(
        {
          roles: [{ requiredCredentials: [iceTech, firstAid] }],
        },
        [iceTech.id, firstAid.id]
      )
    ).toBe(true);
  });
});
