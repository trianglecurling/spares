import { describe, expect, test } from 'bun:test';
import {
  emailsMatchForSpecialLink,
  specialLinkLoginSearch,
  specialLinkTokenFromSearch,
} from './registrationSpecialLink';

describe('registration special link helpers', () => {
  test('reads the slk query token', () => {
    expect(specialLinkTokenFromSearch('?slk=abc-123')).toBe('abc-123');
    expect(specialLinkTokenFromSearch('slk=abc-123&x=1')).toBe('abc-123');
    expect(specialLinkTokenFromSearch('')).toBeNull();
  });

  test('matches invite emails case-insensitively', () => {
    expect(emailsMatchForSpecialLink('Invitee@example.com', 'invitee@example.com')).toBe(true);
    expect(emailsMatchForSpecialLink('invitee@example.com', 'other@example.com')).toBe(false);
    expect(emailsMatchForSpecialLink('invitee@example.com', null)).toBe(false);
  });

  test('builds a login return search string', () => {
    expect(specialLinkLoginSearch('a b')).toBe('?slk=a%20b');
  });
});
