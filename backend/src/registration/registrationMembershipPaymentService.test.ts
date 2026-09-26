import { describe, expect, test } from 'bun:test';
import { PaymentServiceError } from '../services/paymentService.js';
import {
  offlinePaymentCheckoutExpireFailure,
  paymentUrlFromRegistrationMessagePayload,
  RegistrationMembershipPaymentValidationError,
  reusableRegistrationCheckoutUrl,
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

describe('existing registration payment URLs', () => {
  test('reads a payment URL from a stored outbound payload', () => {
    expect(
      paymentUrlFromRegistrationMessagePayload({
        paymentUrl: 'https://squareup.example/pay/abc',
      }),
    ).toBe('https://squareup.example/pay/abc');
    expect(
      paymentUrlFromRegistrationMessagePayload(
        JSON.stringify({ paymentUrl: ' https://squareup.example/pay/abc ' }),
      ),
    ).toBe('https://squareup.example/pay/abc');
    expect(paymentUrlFromRegistrationMessagePayload({ paymentUrl: '' })).toBeNull();
    expect(paymentUrlFromRegistrationMessagePayload({ amountDueMinor: 1000 })).toBeNull();
  });

  test('reuses only an open checkout that still matches the remaining balance', () => {
    const openUrl = 'https://squareup.example/pay/open';
    expect(
      reusableRegistrationCheckoutUrl({
        status: 'pending',
        amountMinor: 15000,
        hostedCheckoutUrl: openUrl,
        expectedAmountMinor: 15000,
      }),
    ).toBe(openUrl);
    expect(
      reusableRegistrationCheckoutUrl({
        status: 'succeeded',
        amountMinor: 33300,
        hostedCheckoutUrl: 'https://squareup.example/pay/paid',
        expectedAmountMinor: 15000,
      }),
    ).toBeNull();
    expect(
      reusableRegistrationCheckoutUrl({
        status: 'pending',
        amountMinor: 33300,
        hostedCheckoutUrl: openUrl,
        expectedAmountMinor: 15000,
      }),
    ).toBeNull();
    expect(
      reusableRegistrationCheckoutUrl({
        status: 'created',
        amountMinor: 15000,
        hostedCheckoutUrl: ` ${openUrl} `,
      }),
    ).toBe(openUrl);
  });
});
