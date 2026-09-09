import { describe, expect, test } from 'bun:test';
import { dispositionForWaitlistOfferPayment } from './eventWaitlistOfferPayment.js';

describe('dispositionForWaitlistOfferPayment', () => {
  test('pending offers are accepted', () => {
    expect(dispositionForWaitlistOfferPayment('pending')).toBe('accept');
  });

  test('already-accepted offers are a no-op (do not refund)', () => {
    expect(dispositionForWaitlistOfferPayment('accepted')).toBe('already_accepted');
  });

  test('declined or superseded payments wait for a staff refund', () => {
    expect(dispositionForWaitlistOfferPayment('declined')).toBe('needs_staff_refund');
    expect(dispositionForWaitlistOfferPayment('superseded')).toBe('needs_staff_refund');
  });

  test('unknown statuses are ignored', () => {
    expect(dispositionForWaitlistOfferPayment('expired')).toBeNull();
    expect(dispositionForWaitlistOfferPayment('')).toBeNull();
  });
});
