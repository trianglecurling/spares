import { describe, expect, test } from 'bun:test';
import {
  invoiceStatusAfterRegistrationCancel,
  isPriorityCancellableRegistrationStatus,
  isPriorityEditableRegistrationStatus,
} from './registrationPriorityEdit.js';

describe('registration priority edit eligibility', () => {
  test('confirmed registrations can be canceled but not edited during priority', () => {
    expect(isPriorityCancellableRegistrationStatus('confirmed')).toBe(true);
    expect(isPriorityEditableRegistrationStatus('confirmed')).toBe(false);
  });

  test('paid registrations remain editable and cancellable during priority', () => {
    expect(isPriorityCancellableRegistrationStatus('paid')).toBe(true);
    expect(isPriorityEditableRegistrationStatus('paid')).toBe(true);
  });

  test('draft and canceled registrations are neither editable nor cancelable', () => {
    for (const status of ['identity_incomplete', 'shell_complete', 'cancelled']) {
      expect(isPriorityCancellableRegistrationStatus(status)).toBe(false);
      expect(isPriorityEditableRegistrationStatus(status)).toBe(false);
    }
  });
});

describe('invoiceStatusAfterRegistrationCancel', () => {
  test('marks the invoice refunded only when a refund was issued', () => {
    expect(invoiceStatusAfterRegistrationCancel({ refundIssued: true, currentStatus: 'paid' })).toBe('refunded');
    expect(invoiceStatusAfterRegistrationCancel({ refundIssued: false, currentStatus: 'paid' })).toBe('paid');
    expect(invoiceStatusAfterRegistrationCancel({ refundIssued: false, currentStatus: 'awaiting_payment' })).toBe(
      'cancelled',
    );
  });
});
