import { describe, expect, test } from 'bun:test';
import {
  OUTBOUND_EMAIL_RETENTION_DAYS,
  serializeOutboundEmailTimestamp,
  shouldLogOutboundEmail,
} from './outboundEmailLogService.js';

describe('shouldLogOutboundEmail', () => {
  test('skips login-code emails', () => {
    expect(shouldLogOutboundEmail({ budgetKind: 'otp' })).toBe(false);
  });

  test('logs other outbound email kinds', () => {
    expect(shouldLogOutboundEmail({})).toBe(true);
    expect(shouldLogOutboundEmail({ budgetKind: 'staff' })).toBe(true);
    expect(shouldLogOutboundEmail({ budgetKind: 'public' })).toBe(true);
    expect(shouldLogOutboundEmail({ budgetKind: 'contact_confirm' })).toBe(true);
  });
});

describe('outbound email retention', () => {
  test('keeps 30 days of mail', () => {
    expect(OUTBOUND_EMAIL_RETENTION_DAYS).toBe(30);
  });
});

describe('serializeOutboundEmailTimestamp', () => {
  test('serializes Date values to ISO', () => {
    const date = new Date('2026-08-26T14:30:00.000Z');
    expect(serializeOutboundEmailTimestamp(date)).toBe('2026-08-26T14:30:00.000Z');
  });

  test('accepts sqlite datetime strings', () => {
    const serialized = serializeOutboundEmailTimestamp('2026-08-26 14:30:00');
    expect(Number.isNaN(new Date(serialized).getTime())).toBe(false);
    expect(serialized.startsWith('2026-08-26')).toBe(true);
  });
});
