import { describe, expect, test } from 'bun:test';
import {
  isPriorityCancellableRegistrationStatus,
  isPriorityEditableRegistrationStatus,
} from './registrationPriorityEdit.js';

describe('registration priority edit eligibility', () => {
  test('confirmed registrations can be cancelled but not edited during priority', () => {
    expect(isPriorityCancellableRegistrationStatus('confirmed')).toBe(true);
    expect(isPriorityEditableRegistrationStatus('confirmed')).toBe(false);
  });

  test('paid registrations remain editable and cancellable during priority', () => {
    expect(isPriorityCancellableRegistrationStatus('paid')).toBe(true);
    expect(isPriorityEditableRegistrationStatus('paid')).toBe(true);
  });

  test('draft and cancelled registrations are neither editable nor cancellable', () => {
    for (const status of ['identity_incomplete', 'shell_complete', 'cancelled']) {
      expect(isPriorityCancellableRegistrationStatus(status)).toBe(false);
      expect(isPriorityEditableRegistrationStatus(status)).toBe(false);
    }
  });
});
