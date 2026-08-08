import { describe, expect, test } from 'bun:test';
import { registrationStatusCommitsRoster } from './registrationRosterService.js';

describe('registrationRosterService', () => {
  test('registrationStatusCommitsRoster is true for submitted and unpaid statuses', () => {
    expect(registrationStatusCommitsRoster('confirmed')).toBe(true);
    expect(registrationStatusCommitsRoster('paid')).toBe(true);
    expect(registrationStatusCommitsRoster('awaiting_placement')).toBe(true);
    expect(registrationStatusCommitsRoster('awaiting_staff_review')).toBe(true);
    expect(registrationStatusCommitsRoster('awaiting_payment')).toBe(true);
    expect(registrationStatusCommitsRoster('payment_started')).toBe(true);
    expect(registrationStatusCommitsRoster('submitted')).toBe(true);
  });

  test('registrationStatusCommitsRoster is false for drafts and canceled registrations', () => {
    expect(registrationStatusCommitsRoster('shell_complete')).toBe(false);
    expect(registrationStatusCommitsRoster('cancelled')).toBe(false);
    expect(registrationStatusCommitsRoster('identity_incomplete')).toBe(false);
  });
});
