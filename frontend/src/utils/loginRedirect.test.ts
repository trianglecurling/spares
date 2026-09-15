import { describe, expect, test } from 'bun:test';
import {
  buildLoginPath,
  buildUnauthenticatedRedirect,
  decodeRedirectParam,
  isSafeInternalRedirect,
  locationToRedirectPath,
  resolvePostLoginRedirect,
} from './loginRedirect';

describe('isSafeInternalRedirect', () => {
  test('allows in-app paths including query strings', () => {
    expect(isSafeInternalRedirect('/spare-request/respond?requestId=12')).toBe(true);
    expect(isSafeInternalRedirect('/dashboard')).toBe(true);
  });

  test('rejects open redirects and login loops', () => {
    expect(isSafeInternalRedirect('https://evil.example/phish')).toBe(false);
    expect(isSafeInternalRedirect('//evil.example')).toBe(false);
    expect(isSafeInternalRedirect('/login')).toBe(false);
    expect(isSafeInternalRedirect('/login?redirect=%2Fdashboard')).toBe(false);
  });
});

describe('decodeRedirectParam', () => {
  test('accepts a once-encoded leading slash from email clients', () => {
    expect(decodeRedirectParam('%2Fspare-request%2Frespond%3FrequestId%3D9')).toBe(
      '/spare-request/respond?requestId=9'
    );
  });
});

describe('locationToRedirectPath', () => {
  test('keeps search params from ProtectedRoute location state', () => {
    expect(
      locationToRedirectPath({
        pathname: '/spare-request/respond',
        search: '?requestId=7',
      })
    ).toBe('/spare-request/respond?requestId=7');
  });
});

describe('resolvePostLoginRedirect', () => {
  test('prefers the redirect query param', () => {
    expect(
      resolvePostLoginRedirect(
        new URLSearchParams('redirect=%2Fdashboard%3Ftab%3Dspares'),
        { from: { pathname: '/other' } }
      )
    ).toBe('/dashboard?tab=spares');
  });

  test('reattaches a sibling requestId when an email client unwraps the nested query', () => {
    expect(
      resolvePostLoginRedirect(
        new URLSearchParams('redirect=/spare-request/respond&requestId=42'),
        null
      )
    ).toBe('/spare-request/respond?requestId=42');
  });

  test('falls back to location state including search', () => {
    expect(
      resolvePostLoginRedirect(new URLSearchParams(), {
        from: { pathname: '/spare-request/decline', search: '?requestId=3' },
      })
    ).toBe('/spare-request/decline?requestId=3');
  });
});

describe('buildUnauthenticatedRedirect', () => {
  test('puts the full destination in the login query string', () => {
    expect(
      buildUnauthenticatedRedirect('/login', {
        pathname: '/spare-request/respond',
        search: '?requestId=5',
      })
    ).toBe('/login?redirect=%2Fspare-request%2Frespond%3FrequestId%3D5');
  });

  test('leaves custom unauthenticated destinations unchanged', () => {
    expect(
      buildUnauthenticatedRedirect('/calendar/public', {
        pathname: '/calendar',
        search: '',
      })
    ).toBe('/calendar/public');
  });
});

describe('buildLoginPath', () => {
  test('encodes nested query strings', () => {
    expect(buildLoginPath('/spare-request/respond?requestId=1')).toBe(
      '/login?redirect=%2Fspare-request%2Frespond%3FrequestId%3D1'
    );
  });
});
