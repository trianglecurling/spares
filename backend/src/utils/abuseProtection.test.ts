import { describe, expect, test, beforeEach } from 'bun:test';
import {
  assertProductionJwtSecret,
  authVerifyFailKey,
  clearAuthVerifyFailures,
  consumeSendBudget,
  consumeSlidingWindowLimit,
  DEFAULT_JWT_SECRET,
  isAuthVerifyLockedOut,
  isCalendarRangeWithinLimit,
  isIpLimitBypassed,
  normalizeClientIp,
  recordAuthVerifyFailure,
  resetAbuseProtectionStateForTests,
} from './abuseProtection.js';
import { abuseRouteRateLimits } from '../plugins/abuseRateLimits.js';

describe('abuseProtection', () => {
  beforeEach(() => {
    resetAbuseProtectionStateForTests();
  });

  test('default facility IP is on the IP limit bypass allowlist', () => {
    expect(isIpLimitBypassed('50.105.55.129')).toBe(true);
    expect(isIpLimitBypassed('::ffff:50.105.55.129')).toBe(true);
    expect(isIpLimitBypassed('1.2.3.4')).toBe(false);
    expect(normalizeClientIp('::ffff:50.105.55.129')).toBe('50.105.55.129');
  });

  test('assertProductionJwtSecret rejects default secret in production', () => {
    expect(() => assertProductionJwtSecret('production', DEFAULT_JWT_SECRET)).toThrow(/JWT_SECRET/);
    expect(() => assertProductionJwtSecret('production', 'a-strong-secret')).not.toThrow();
    expect(() => assertProductionJwtSecret('development', DEFAULT_JWT_SECRET)).not.toThrow();
  });

  test('calendar range rejects windows wider than 93 days', () => {
    const start = '2026-01-01T00:00:00.000Z';
    expect(isCalendarRangeWithinLimit(start, '2026-04-03T00:00:00.000Z')).toBe(true);
    expect(isCalendarRangeWithinLimit(start, '2026-04-05T00:00:00.000Z')).toBe(false);
    expect(isCalendarRangeWithinLimit('bad', '2026-01-02T00:00:00.000Z')).toBe(false);
  });

  test('verify lockout after repeated failures', () => {
    const key = authVerifyFailKey('1.2.3.4', 'user@example.com');
    for (let i = 0; i < 8; i++) recordAuthVerifyFailure(key);
    expect(isAuthVerifyLockedOut(key)).toBe(true);
    clearAuthVerifyFailures(key);
    expect(isAuthVerifyLockedOut(key)).toBe(false);
  });

  test('send budget enforces otp recipient cooldown', () => {
    const first = consumeSendBudget({ kind: 'otp', recipient: 'a@example.com', failOpen: false });
    const second = consumeSendBudget({ kind: 'otp', recipient: 'a@example.com', failOpen: false });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toContain('recipient_cooldown');
  });

  test('sliding window returns 429 after max', () => {
    expect(consumeSlidingWindowLimit('k', 2, 60_000).ok).toBe(true);
    expect(consumeSlidingWindowLimit('k', 2, 60_000).ok).toBe(true);
    expect(consumeSlidingWindowLimit('k', 2, 60_000).ok).toBe(false);
  });

  test('auth route rate limit configs match launch targets', () => {
    expect(abuseRouteRateLimits.authRequestCode.max).toBe(5);
    expect(abuseRouteRateLimits.authVerify.max).toBe(10);
    expect(abuseRouteRateLimits.authToken.max).toBe(10);
    expect(abuseRouteRateLimits.authToken.timeWindow).toBe('15 minutes');
    expect(abuseRouteRateLimits.contact.max).toBe(5);
    expect(abuseRouteRateLimits.mailingList.max).toBe(5);
    expect(abuseRouteRateLimits.feedback.max).toBe(5);
    expect(abuseRouteRateLimits.eventRegister.max).toBe(10);
    expect(abuseRouteRateLimits.guestRegistration.max).toBe(10);
  });
});
