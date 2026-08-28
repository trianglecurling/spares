import { describe, expect, test } from 'bun:test';
import {
  decodePublicKey,
  defaultPasskeyName,
  encodePublicKey,
  memberIdToUserHandle,
  normalizePasskeyName,
  originFromUrl,
  parseTransports,
  PASSKEY_NAME_MAX_LENGTH,
  serializeTransports,
  userHandleToMemberId,
} from './webauthnService.js';

describe('webauthn helpers', () => {
  test('round-trips member id as a user handle', () => {
    const handle = memberIdToUserHandle(42);
    expect(userHandleToMemberId(handle)).toBe(42);
    expect(userHandleToMemberId('42')).toBe(42);
    expect(userHandleToMemberId('nope')).toBeNull();
    expect(userHandleToMemberId(null)).toBeNull();
  });

  test('picks a default passkey name from authenticator attachment', () => {
    expect(defaultPasskeyName('platform')).toBe('This device');
    expect(defaultPasskeyName('cross-platform')).toBe('Security key');
    expect(defaultPasskeyName(null)).toBe('Passkey');
  });

  test('normalizes passkey names and truncates long values', () => {
    expect(normalizePasskeyName('  My Phone  ', 'Passkey')).toBe('My Phone');
    expect(normalizePasskeyName('   ', 'Passkey')).toBe('Passkey');
    expect(normalizePasskeyName('x'.repeat(PASSKEY_NAME_MAX_LENGTH + 10), 'Passkey')).toHaveLength(
      PASSKEY_NAME_MAX_LENGTH
    );
  });

  test('round-trips public keys and transports', () => {
    const bytes = new Uint8Array([1, 2, 255, 0]);
    expect(Array.from(decodePublicKey(encodePublicKey(bytes)))).toEqual([1, 2, 255, 0]);
    expect(parseTransports(serializeTransports(['internal', 'hybrid']))).toEqual(['internal', 'hybrid']);
    expect(parseTransports(null)).toBeUndefined();
    expect(parseTransports('not-json')).toBeUndefined();
  });

  test('extracts origins from frontend URLs', () => {
    expect(originFromUrl('https://members.example.com/path')).toBe('https://members.example.com');
    expect(originFromUrl('http://localhost:5173')).toBe('http://localhost:5173');
    expect(originFromUrl('not a url')).toBeNull();
  });
});
