import { describe, expect, test } from 'bun:test';
import { shouldForceDevOutbound } from './devOutbound.js';

describe('shouldForceDevOutbound', () => {
  test('forces Mailpit for the default local runtime', () => {
    expect(
      shouldForceDevOutbound({
        nodeEnv: 'development',
        frontendUrl: 'http://localhost:5173',
      })
    ).toBe(true);
  });

  test('forces Mailpit when NODE_ENV is unset-style development even with a public site URL', () => {
    expect(
      shouldForceDevOutbound({
        nodeEnv: 'development',
        frontendUrl: 'https://trianglecurling.com',
      })
    ).toBe(true);
  });

  test('forces Mailpit if production NODE_ENV is paired with a loopback FRONTEND_URL', () => {
    expect(
      shouldForceDevOutbound({
        nodeEnv: 'production',
        frontendUrl: 'http://localhost:5173',
      })
    ).toBe(true);
  });

  test('allows Azure/SMTP only for a production runtime with a public FRONTEND_URL', () => {
    expect(
      shouldForceDevOutbound({
        nodeEnv: 'production',
        frontendUrl: 'https://trianglecurling.com',
      })
    ).toBe(false);
  });
});
