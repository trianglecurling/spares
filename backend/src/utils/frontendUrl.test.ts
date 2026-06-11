import { describe, expect, test } from 'bun:test';
import { frontendOriginFromRequestHeaders, normalizeFrontendBaseUrl } from './frontendUrl.js';

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
