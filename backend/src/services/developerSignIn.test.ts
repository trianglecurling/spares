import { describe, expect, test } from 'bun:test';
import {
  developerSignInErrorMessage,
  developerSignInErrorStatus,
  evaluateDeveloperSignIn,
} from './developerSignIn.js';

describe('evaluateDeveloperSignIn', () => {
  const target = { id: 42, account_kind: 'person' as const };

  test('allows a server admin to sign in as another person', () => {
    expect(
      evaluateDeveloperSignIn({
        actorIsServerAdmin: true,
        actorIsImpersonating: false,
        actorMemberId: 1,
        target,
      })
    ).toBeNull();
  });

  test('refuses delegated impersonation sessions', () => {
    expect(
      evaluateDeveloperSignIn({
        actorIsServerAdmin: true,
        actorIsImpersonating: true,
        actorMemberId: 1,
        target,
      })
    ).toBe('impersonating');
  });

  test('refuses non-server-admins', () => {
    expect(
      evaluateDeveloperSignIn({
        actorIsServerAdmin: false,
        actorIsImpersonating: false,
        actorMemberId: 1,
        target,
      })
    ).toBe('not_server_admin');
  });

  test('refuses missing members', () => {
    expect(
      evaluateDeveloperSignIn({
        actorIsServerAdmin: true,
        actorIsImpersonating: false,
        actorMemberId: 1,
        target: null,
      })
    ).toBe('target_not_found');
  });

  test('refuses service accounts', () => {
    expect(
      evaluateDeveloperSignIn({
        actorIsServerAdmin: true,
        actorIsImpersonating: false,
        actorMemberId: 1,
        target: { id: 9, account_kind: 'service' },
      })
    ).toBe('service_account');
  });

  test('refuses signing in as the current member', () => {
    expect(
      evaluateDeveloperSignIn({
        actorIsServerAdmin: true,
        actorIsImpersonating: false,
        actorMemberId: 42,
        target,
      })
    ).toBe('same_member');
  });
});

describe('developerSignInErrorStatus', () => {
  test('maps denials to API statuses', () => {
    expect(developerSignInErrorStatus('impersonating')).toBe(403);
    expect(developerSignInErrorStatus('not_server_admin')).toBe(403);
    expect(developerSignInErrorStatus('target_not_found')).toBe(404);
    expect(developerSignInErrorStatus('service_account')).toBe(400);
    expect(developerSignInErrorStatus('same_member')).toBe(400);
  });
});

describe('developerSignInErrorMessage', () => {
  test('keeps permission denials generic', () => {
    expect(developerSignInErrorMessage('impersonating')).toBe('Forbidden');
    expect(developerSignInErrorMessage('not_server_admin')).toBe('Forbidden');
  });
});
