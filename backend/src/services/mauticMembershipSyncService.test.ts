import { describe, expect, test } from 'bun:test';
import {
  buildDesiredEmailsFromRows,
  decideEmailChangeContactAction,
  seasonMembersSegmentName,
  shouldRemoveEmailFromSegment,
  type ActiveMembershipEmailRow,
} from './mauticMembershipSyncService.js';

describe('buildDesiredEmailsFromRows', () => {
  test('dedupes shared emails and only includes active memberships', () => {
    const rows: ActiveMembershipEmailRow[] = [
      {
        memberId: 1,
        email: 'Family@Example.com',
        firstName: 'Parent',
        lastName: 'Smith',
        name: 'Parent Smith',
        status: 'active',
      },
      {
        memberId: 2,
        email: ' family@example.com ',
        firstName: 'Child',
        lastName: 'Smith',
        name: 'Child Smith',
        status: 'active',
      },
      {
        memberId: 3,
        email: 'cancelled@example.com',
        firstName: 'Gone',
        lastName: 'Member',
        name: 'Gone Member',
        status: 'cancelled',
      },
      {
        memberId: 4,
        email: '',
        firstName: 'Blank',
        lastName: 'Email',
        name: 'Blank Email',
        status: 'active',
      },
      {
        memberId: 5,
        email: 'unique@example.com',
        firstName: null,
        lastName: null,
        name: 'Unique Curler',
        status: 'active',
      },
    ];

    const desired = buildDesiredEmailsFromRows(rows);
    expect([...desired.keys()].sort()).toEqual(['family@example.com', 'unique@example.com']);
    expect(desired.get('family@example.com')).toEqual({
      email: 'family@example.com',
      firstname: 'Parent',
      lastname: 'Smith',
    });
    expect(desired.get('unique@example.com')).toEqual({
      email: 'unique@example.com',
      firstname: 'Unique',
      lastname: 'Curler',
    });
  });
});

describe('shouldRemoveEmailFromSegment', () => {
  test('keeps contact when another active holder remains', () => {
    expect(shouldRemoveEmailFromSegment(true)).toBe(false);
  });

  test('removes contact when no other active holders remain', () => {
    expect(shouldRemoveEmailFromSegment(false)).toBe(true);
  });
});

describe('decideEmailChangeContactAction', () => {
  test('skips when email did not change', () => {
    expect(
      decideEmailChangeContactAction({
        oldEmailNormalized: 'a@example.com',
        newEmailNormalized: 'a@example.com',
        oldEmailSharedWithOtherMembers: false,
        existingNewEmailContactId: null,
        existingOldEmailContactId: 10,
      }),
    ).toEqual({ action: 'skip' });
  });

  test('finds or creates new contact when old email is shared (parent/child)', () => {
    expect(
      decideEmailChangeContactAction({
        oldEmailNormalized: 'family@example.com',
        newEmailNormalized: 'child@example.com',
        oldEmailSharedWithOtherMembers: true,
        existingNewEmailContactId: null,
        existingOldEmailContactId: 42,
      }),
    ).toEqual({ action: 'find_or_create_new' });
  });

  test('patches existing contact when sole owner and new email is unused in Mautic', () => {
    expect(
      decideEmailChangeContactAction({
        oldEmailNormalized: 'old@example.com',
        newEmailNormalized: 'new@example.com',
        oldEmailSharedWithOtherMembers: false,
        existingNewEmailContactId: null,
        existingOldEmailContactId: 7,
      }),
    ).toEqual({ action: 'patch_existing', oldContactId: 7 });
  });

  test('reuses existing new-email contact without patching the old one', () => {
    expect(
      decideEmailChangeContactAction({
        oldEmailNormalized: 'old@example.com',
        newEmailNormalized: 'new@example.com',
        oldEmailSharedWithOtherMembers: false,
        existingNewEmailContactId: 99,
        existingOldEmailContactId: 7,
      }),
    ).toEqual({ action: 'find_or_create_new' });
  });
});

describe('seasonMembersSegmentName', () => {
  test('prefixes AUTO: for created and renamed segments', () => {
    expect(seasonMembersSegmentName('2026-27')).toBe('AUTO: 2026-27 members');
  });
});
