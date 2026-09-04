import { describe, expect, test } from 'bun:test';
import {
  isHeldLeagueProcessingMessageType,
  registrationStatusHidesPaymentLinkDuringProcessing,
} from './registrationLeagueProcessing.js';

describe('league processing hold helpers', () => {
  test('holds waitlist and deferred payment-link message types', () => {
    expect(isHeldLeagueProcessingMessageType('waitlist_joined')).toBe(true);
    expect(isHeldLeagueProcessingMessageType('waitlist_offer_permanent')).toBe(true);
    expect(isHeldLeagueProcessingMessageType('waitlist_offer_temporary_sabbatical_fill')).toBe(true);
    expect(isHeldLeagueProcessingMessageType('waitlist_offer_accepted')).toBe(true);
    expect(isHeldLeagueProcessingMessageType('waitlist_offer_declined')).toBe(true);
    expect(isHeldLeagueProcessingMessageType('deferred_registration_payment_link')).toBe(true);
  });

  test('does not hold unrelated registration mail', () => {
    expect(isHeldLeagueProcessingMessageType('registration_submitted_deferred_payment')).toBe(false);
    expect(isHeldLeagueProcessingMessageType('waitlist_changed_by_staff')).toBe(false);
  });

  test('hides member payment links only for placement-pending statuses', () => {
    expect(registrationStatusHidesPaymentLinkDuringProcessing('awaiting_placement')).toBe(true);
    expect(registrationStatusHidesPaymentLinkDuringProcessing('awaiting_staff_review')).toBe(true);
    expect(registrationStatusHidesPaymentLinkDuringProcessing('awaiting_payment')).toBe(true);
    expect(registrationStatusHidesPaymentLinkDuringProcessing('payment_started')).toBe(false);
    expect(registrationStatusHidesPaymentLinkDuringProcessing('paid')).toBe(false);
  });
});
