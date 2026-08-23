import { describe, expect, test } from 'bun:test';
import { PaymentServiceError } from '../services/paymentService.js';
import {
  offlinePaymentCheckoutExpireFailure,
  RegistrationMembershipPaymentValidationError,
} from './registrationMembershipPaymentService.js';

describe('offlinePaymentCheckoutExpireFailure', () => {
  test('maps an already-completed checkout to a staff-facing validation error', () => {
    const mapped = offlinePaymentCheckoutExpireFailure(
      new PaymentServiceError('This payment has already been completed.', 409),
    );
    expect(mapped).toBeInstanceOf(RegistrationMembershipPaymentValidationError);
    expect(mapped?.details.payment).toBe(
      'This registration was already paid online. Refresh the page before recording an offline payment.',
    );
  });

  test('maps other payment-service failures to their provider message', () => {
    const mapped = offlinePaymentCheckoutExpireFailure(
      new PaymentServiceError('Payment provider stripe cannot expire checkout sessions.', 501),
    );
    expect(mapped?.details.payment).toBe('Payment provider stripe cannot expire checkout sessions.');
  });

  test('leaves unrelated errors untouched', () => {
    expect(offlinePaymentCheckoutExpireFailure(new Error('network down'))).toBeNull();
  });
});
