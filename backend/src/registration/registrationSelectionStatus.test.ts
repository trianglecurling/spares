import { describe, expect, test } from 'bun:test';
import { registrationSelectionStatusIsPreserved } from './registrationMembershipPaymentService.js';

describe('registrationSelectionStatusIsPreserved', () => {
  test('preserves terminal selection statuses that must not be re-confirmed on payment', () => {
    expect(registrationSelectionStatusIsPreserved('dropped')).toBe(true);
    expect(registrationSelectionStatusIsPreserved('not_placed')).toBe(true);
    expect(registrationSelectionStatusIsPreserved('cancelled')).toBe(true);
    expect(registrationSelectionStatusIsPreserved('declined')).toBe(true);
  });

  test('does not preserve active or pending statuses', () => {
    expect(registrationSelectionStatusIsPreserved('confirmed')).toBe(false);
    expect(registrationSelectionStatusIsPreserved('pending')).toBe(false);
    expect(registrationSelectionStatusIsPreserved('waitlisted')).toBe(false);
  });
});
