import { describe, expect, test } from 'bun:test';
import { registrationStatusCommitsRoster } from './registrationRosterService.js';

describe('registrationRosterService', () => {
  test('registrationStatusCommitsRoster is true for completed non-checkout statuses', () => {
    expect(registrationStatusCommitsRoster('confirmed')).toBe(true);
    expect(registrationStatusCommitsRoster('paid')).toBe(true);
    expect(registrationStatusCommitsRoster('awaiting_placement')).toBe(true);
    expect(registrationStatusCommitsRoster('awaiting_staff_review')).toBe(true);
  });

  test('registrationStatusCommitsRoster is false while checkout is still required', () => {
    expect(registrationStatusCommitsRoster('awaiting_payment')).toBe(false);
    expect(registrationStatusCommitsRoster('payment_started')).toBe(false);
    expect(registrationStatusCommitsRoster('shell_complete')).toBe(false);
    expect(registrationStatusCommitsRoster('cancelled')).toBe(false);
  });
});
