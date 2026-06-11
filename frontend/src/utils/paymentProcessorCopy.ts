export type PaymentProvider = 'stripe' | 'paypal' | 'square';

let cachedDefaultPaymentProvider: PaymentProvider | null = null;

export function setCachedDefaultPaymentProvider(provider: unknown): void {
  if (provider === 'stripe' || provider === 'square' || provider === 'paypal') {
    cachedDefaultPaymentProvider = provider;
  }
}

export function getCachedDefaultPaymentProvider(): PaymentProvider | null {
  return cachedDefaultPaymentProvider;
}

export function paymentProcessorDisplayName(provider: PaymentProvider): string {
  if (provider === 'stripe') return 'Stripe';
  if (provider === 'square') return 'Square';
  return 'PayPal';
}

function hostedCheckoutProcessorLabel(provider: PaymentProvider | null): string | null {
  if (provider === 'stripe') return 'Stripe';
  if (provider === 'square') return 'Square';
  return null;
}

export function donationCheckoutIntro(provider: PaymentProvider | null = getCachedDefaultPaymentProvider()): string {
  const processor = hostedCheckoutProcessorLabel(provider);
  if (processor) {
    return `Donations are processed securely through ${processor} hosted checkout.`;
  }
  return 'Donations are processed securely through our hosted checkout page.';
}

export function donationCheckoutStepTwo(provider: PaymentProvider | null = getCachedDefaultPaymentProvider()): string {
  const processor = hostedCheckoutProcessorLabel(provider);
  if (processor) {
    return `Complete payment on ${processor}'s hosted page.`;
  }
  return 'Complete payment on our secure checkout page.';
}

export function registrationPaymentConfirmedMessage(
  provider: PaymentProvider | null = getCachedDefaultPaymentProvider(),
): string {
  const processor = hostedCheckoutProcessorLabel(provider);
  if (processor) {
    return `${processor} has confirmed your payment and your registration is confirmed.`;
  }
  return 'Your payment has been confirmed and your registration is confirmed.';
}

export function registrationPaymentFailedMessage(
  provider: PaymentProvider | null = getCachedDefaultPaymentProvider(),
): string {
  const processor = hostedCheckoutProcessorLabel(provider);
  if (processor) {
    return `${processor} did not complete this payment. Your registration remains unpaid and unconfirmed.`;
  }
  return 'Your payment was not completed. Your registration remains unpaid and unconfirmed.';
}

export function registrationPaymentPendingMessage(
  provider: PaymentProvider | null = getCachedDefaultPaymentProvider(),
): string {
  const processor = hostedCheckoutProcessorLabel(provider);
  if (processor) {
    return `Your payment was submitted. We are confirming it with ${processor}. This usually takes a few moments.`;
  }
  return 'Your payment was submitted. We are confirming it now. This usually takes a few moments.';
}
