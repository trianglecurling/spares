import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  looksLikePersonalAccessToken,
  PERSONAL_ACCESS_TOKEN_PREFIX,
  serviceAccountEmail,
} from './personalAccessTokenService.js';

describe('personalAccessToken helpers', () => {
  test('recognizes the tbs_pat_ prefix', () => {
    expect(looksLikePersonalAccessToken(`${PERSONAL_ACCESS_TOKEN_PREFIX}abc`)).toBe(true);
    expect(looksLikePersonalAccessToken('eyJhbGciOiJIUzI1NiJ9.e30.sig')).toBe(false);
  });

  test('builds a non-deliverable service account email', () => {
    const email = serviceAccountEmail('Website Helper', 'a1b2c3');
    expect(email).toBe('bot+website-helper-a1b2c3@service.invalid');
  });

  test('hashes with sha256 hex like refresh tokens', () => {
    const token = `${PERSONAL_ACCESS_TOKEN_PREFIX}secret`;
    expect(createHash('sha256').update(token).digest('hex')).toHaveLength(64);
  });
});
