import { describe, expect, test } from 'bun:test';
import { generateAuthCode, generateTempAuthToken } from './auth.js';
import { isMemberIdBoundToContact, parseTempAuthContact } from './authSelectMember.js';

describe('authSelectMember binding', () => {
  test('parseTempAuthContact requires temp: prefix and non-empty contact', () => {
    expect(parseTempAuthContact('temp:alice@example.com')).toBe('alice@example.com');
    expect(parseTempAuthContact('temp:+15551234567')).toBe('+15551234567');
    expect(parseTempAuthContact('alice@example.com')).toBeNull();
    expect(parseTempAuthContact('temp:')).toBeNull();
    expect(parseTempAuthContact('temp:   ')).toBeNull();
  });

  test('isMemberIdBoundToContact rejects members outside the verified contact set', () => {
    const allowed = [10, 20, 30];
    expect(isMemberIdBoundToContact(20, allowed)).toBe(true);
    expect(isMemberIdBoundToContact(99, allowed)).toBe(false);
  });

  test('OTP is 6 digits and temp token is opaque', () => {
    const code = generateAuthCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(Number(code)).toBeGreaterThanOrEqual(100000);
    expect(Number(code)).toBeLessThanOrEqual(999999);

    const temp = generateTempAuthToken();
    expect(temp.length).toBeGreaterThanOrEqual(32);
    expect(temp).not.toMatch(/^\d{6}$/);
  });
});
