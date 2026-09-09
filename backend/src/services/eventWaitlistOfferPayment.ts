export type EventWaitlistOfferPaymentDisposition =
  | 'accept'
  | 'already_accepted'
  | 'needs_staff_refund';

/**
 * What to do when a waitlist-offer payment succeeds.
 * Refunds are never automatic: declined/superseded payments stay paid for staff to refund.
 */
export function dispositionForWaitlistOfferPayment(
  status: string,
): EventWaitlistOfferPaymentDisposition | null {
  if (status === 'pending') return 'accept';
  if (status === 'accepted') return 'already_accepted';
  if (status === 'declined' || status === 'superseded') return 'needs_staff_refund';
  return null;
}
