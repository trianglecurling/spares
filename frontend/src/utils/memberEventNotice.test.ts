import { describe, expect, test } from 'bun:test';
import { memberEventNotice } from './memberEventNotice';

const loginHref = '/login?redirect=%2Fevents%2Fspiel';

describe('memberEventNotice', () => {
  test('stays hidden when the viewer can register', () => {
    expect(
      memberEventNotice(
        { visibility: 'active_members', viewerCanRegister: true, viewerAuthenticated: true },
        loginHref,
      ),
    ).toBeNull();
    expect(
      memberEventNotice({ visibility: 'public', viewerCanRegister: true, viewerAuthenticated: false }, loginHref),
    ).toBeNull();
  });

  test('asks guests to log in for member events', () => {
    expect(
      memberEventNotice(
        { visibility: 'active_members', viewerCanRegister: false, viewerAuthenticated: false },
        loginHref,
      ),
    ).toEqual({
      message: 'This event is available to Triangle Curling members only.',
      loginHref,
    });
  });

  test('omits the login link when the viewer is already signed in', () => {
    expect(
      memberEventNotice(
        { visibility: 'ice_members', viewerCanRegister: false, viewerAuthenticated: true },
        loginHref,
      ),
    ).toEqual({
      message: 'This event is available to Triangle Curling ice members only.',
      loginHref: null,
    });
  });
});
