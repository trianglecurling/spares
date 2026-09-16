import { describe, expect, test } from 'bun:test';
import {
  frontendOriginFromRequestHeaders,
  isLoopbackFrontendUrl,
  normalizeFrontendBaseUrl,
  pickPublicFrontendBaseUrl,
} from './frontendUrl.js';

describe('frontendUrl', () => {
  test('normalizeFrontendBaseUrl strips trailing slashes', () => {
    expect(normalizeFrontendBaseUrl('https://tccnc.club/')).toBe('https://tccnc.club');
  });

  test('frontendOriginFromRequestHeaders prefers Origin', () => {
    expect(
      frontendOriginFromRequestHeaders({
        origin: 'https://preview.tccnc.club',
        referer: 'https://tccnc.club/donate',
      })
    ).toBe('https://preview.tccnc.club');
  });

  test('frontendOriginFromRequestHeaders falls back to Referer', () => {
    expect(
      frontendOriginFromRequestHeaders({
        referer: 'https://preview.tccnc.club/registration/success?registration_id=1',
      })
    ).toBe('https://preview.tccnc.club');
  });

  test('frontendOriginFromRequestHeaders supports X-Forwarded-Host', () => {
    expect(
      frontendOriginFromRequestHeaders({
        'x-forwarded-host': 'preview.tccnc.club',
        'x-forwarded-proto': 'https',
      })
    ).toBe('https://preview.tccnc.club');
  });
});

describe('pickPublicFrontendBaseUrl', () => {
  test('does not use localhost when the request came from the public site', () => {
    expect(
      pickPublicFrontendBaseUrl({
        configured: 'http://localhost:5173',
        requestHeaders: { origin: 'https://tccnc.club' },
      })
    ).toBe('https://tccnc.club');
  });

  test('uses a configured public FRONTEND_URL even without a request', () => {
    expect(
      pickPublicFrontendBaseUrl({
        configured: 'https://spares.tccnc.club',
      })
    ).toBe('https://spares.tccnc.club');
  });

  test('prefers a remembered public origin over a loopback FRONTEND_URL', () => {
    expect(
      pickPublicFrontendBaseUrl({
        configured: 'http://localhost:5173',
        remembered: 'https://tccnc.club',
      })
    ).toBe('https://tccnc.club');
  });

  test('prefers a non-loopback alias when FRONTEND_URL is localhost', () => {
    expect(
      pickPublicFrontendBaseUrl({
        configured: 'http://localhost:5173',
        aliases: ['https://tccnc.club'],
      })
    ).toBe('https://tccnc.club');
  });
});

describe('isLoopbackFrontendUrl', () => {
  test('detects local Vite and loopback hosts', () => {
    expect(isLoopbackFrontendUrl('http://localhost:5173')).toBe(true);
    expect(isLoopbackFrontendUrl('https://tccnc.club')).toBe(false);
  });
});
