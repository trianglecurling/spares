import { describe, expect, test } from 'bun:test';
import {
  ROSTER_PAYMENT_DUE_UPON_RECEIPT,
  formatRosterConfirmationPaymentDueText,
  isRegistrationPaymentDeadlinePassed,
} from './registrationPaymentDeadline.js';

describe('roster confirmation payment due text', () => {
  test('uses the calendar date while the deadline is still ahead', () => {
    const deadline = new Date('2026-09-20T23:59:00-04:00');
    const now = new Date('2026-09-14T12:00:00-04:00');
    expect(isRegistrationPaymentDeadlinePassed(deadline, now)).toBe(false);
    expect(formatRosterConfirmationPaymentDueText(deadline, now)).toBe('Sunday, September 20, 2026');
  });

  test('switches to upon receipt after the deadline has passed', () => {
    const deadline = new Date('2026-09-13T23:59:00-04:00');
    const now = new Date('2026-09-14T00:00:00-04:00');
    expect(isRegistrationPaymentDeadlinePassed(deadline, now)).toBe(true);
    expect(formatRosterConfirmationPaymentDueText(deadline, now)).toBe(ROSTER_PAYMENT_DUE_UPON_RECEIPT);
  });

  test('treats the exact deadline instant as passed', () => {
    const deadline = new Date('2026-09-13T23:59:00-04:00');
    expect(isRegistrationPaymentDeadlinePassed(deadline, deadline)).toBe(true);
  });

  test('returns null when no deadline is configured', () => {
    expect(formatRosterConfirmationPaymentDueText(null, new Date('2026-09-14T12:00:00-04:00'))).toBeNull();
  });
});
