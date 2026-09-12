import { describe, expect, test } from 'bun:test';
import {
  distinctGuardianEmail,
  formatEmailWithParent,
  mailtoHrefForMemberEmail,
  memberContactEmails,
  namedCopyEmailEntries,
  parentEmailForMinor,
  parentEmailLookupFromMembers,
  registrationParentCopyEmail,
} from './memberParentEmail.js';

describe('distinctGuardianEmail', () => {
  test('returns the guardian email when it differs', () => {
    expect(distinctGuardianEmail('kid@example.com', 'parent@example.com')).toBe('parent@example.com');
  });

  test('returns null when the member already uses the parent inbox', () => {
    expect(distinctGuardianEmail('Parent@example.com', 'parent@example.com')).toBeNull();
    expect(distinctGuardianEmail('parent@example.com', ' parent@example.com ')).toBeNull();
  });

  test('returns null when the guardian email is missing or invalid', () => {
    expect(distinctGuardianEmail('kid@example.com', null)).toBeNull();
    expect(distinctGuardianEmail('kid@example.com', 'not-an-email')).toBeNull();
  });
});

describe('parentEmailForMinor', () => {
  test('includes a distinct parent email for a member under 18', () => {
    expect(
      parentEmailForMinor({
        email: 'kid@example.com',
        guardianEmail: 'parent@example.com',
        dateOfBirth: '2015-01-15',
      }),
    ).toBe('parent@example.com');
  });

  test('does not add a parent email for an adult', () => {
    expect(
      parentEmailForMinor({
        email: 'adult@example.com',
        guardianEmail: 'parent@example.com',
        dateOfBirth: '1990-01-15',
      }),
    ).toBeNull();
  });

  test('does not add a parent email when the minor uses the parent inbox', () => {
    expect(
      parentEmailForMinor({
        email: 'parent@example.com',
        guardianEmail: 'parent@example.com',
        dateOfBirth: '2015-01-15',
      }),
    ).toBeNull();
  });

  test('respects an explicit isMinor flag', () => {
    expect(
      parentEmailForMinor({
        email: 'kid@example.com',
        guardianEmail: 'parent@example.com',
        isMinor: true,
      }),
    ).toBe('parent@example.com');
    expect(
      parentEmailForMinor({
        email: 'kid@example.com',
        guardianEmail: 'parent@example.com',
        dateOfBirth: '2015-01-15',
        isMinor: false,
      }),
    ).toBeNull();
  });
});

describe('registrationParentCopyEmail', () => {
  test('prefers the registration guardian email over the member record', () => {
    expect(
      registrationParentCopyEmail({
        memberEmail: 'kid@example.com',
        dateOfBirth: '2015-01-15',
        memberGuardianEmail: 'old-parent@example.com',
        registrationGuardianEmail: 'current-parent@example.com',
      }),
    ).toBe('current-parent@example.com');
  });

  test('falls back to the member guardian email', () => {
    expect(
      registrationParentCopyEmail({
        memberEmail: 'kid@example.com',
        dateOfBirth: '2015-01-15',
        memberGuardianEmail: 'parent@example.com',
        registrationGuardianEmail: null,
      }),
    ).toBe('parent@example.com');
  });

  test('omits a parent copy for adults', () => {
    expect(
      registrationParentCopyEmail({
        memberEmail: 'adult@example.com',
        dateOfBirth: '1990-01-15',
        memberGuardianEmail: 'parent@example.com',
        registrationGuardianEmail: 'parent@example.com',
      }),
    ).toBeNull();
  });
});

describe('memberContactEmails', () => {
  test('omits parentEmail when the member email is empty', () => {
    expect(
      memberContactEmails({
        email: null,
        guardian_email: 'parent@example.com',
        date_of_birth: '2015-01-15',
      }),
    ).toEqual({ email: null, parentEmail: null });
  });

  test('maps snake_case member rows', () => {
    expect(
      memberContactEmails({
        email: 'kid@example.com',
        guardian_email: 'parent@example.com',
        date_of_birth: '2015-01-15T00:00:00.000Z',
      }),
    ).toEqual({ email: 'kid@example.com', parentEmail: 'parent@example.com' });
  });
});

describe('formatEmailWithParent', () => {
  test('appends a distinct parent email', () => {
    expect(formatEmailWithParent('kid@example.com', 'parent@example.com')).toBe(
      'kid@example.com (parent: parent@example.com)',
    );
  });

  test('leaves a shared inbox unchanged', () => {
    expect(formatEmailWithParent('parent@example.com', 'parent@example.com')).toBe('parent@example.com');
  });
});

describe('mailtoHrefForMemberEmail', () => {
  test('CCs a distinct parent', () => {
    expect(mailtoHrefForMemberEmail('kid@example.com', 'parent@example.com')).toBe(
      'mailto:kid@example.com?cc=parent%40example.com',
    );
  });

  test('omits cc when there is no distinct parent', () => {
    expect(mailtoHrefForMemberEmail('parent@example.com', 'parent@example.com')).toBe(
      'mailto:parent@example.com',
    );
  });
});

describe('namedCopyEmailEntries', () => {
  test('adds a parent recipient without duplicating a shared inbox', () => {
    expect(
      namedCopyEmailEntries([
        { name: 'Kid Example', email: 'kid@example.com', parentEmail: 'parent@example.com' },
        { name: 'Same Inbox', email: 'parent@example.com', parentEmail: 'parent@example.com' },
        { name: 'Kid Example', email: 'kid@example.com', parentEmail: 'parent@example.com' },
      ]),
    ).toEqual([
      '"Kid Example" <kid@example.com>',
      '"Kid Example (parent)" <parent@example.com>',
    ]);
  });
});

describe('parentEmailLookupFromMembers', () => {
  test('indexes distinct parent emails by member address', () => {
    const lookup = parentEmailLookupFromMembers([
      { email: 'kid@example.com', parentEmail: 'parent@example.com' },
      { email: 'parent@example.com', parentEmail: 'parent@example.com' },
    ]);
    expect(lookup.get('kid@example.com')).toBe('parent@example.com');
    expect(lookup.has('parent@example.com')).toBe(false);
  });
});
