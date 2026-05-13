import { autoAcceptExpiredWaitlistOffers } from '../registration/waitlistStaffService.js';

let processorStarted = false;

export function startWaitlistOfferProcessor(): void {
  if (processorStarted) return;
  processorStarted = true;
  setInterval(() => {
    autoAcceptExpiredWaitlistOffers().catch((error) => {
      console.error('Error in waitlist offer processor:', error);
    });
  }, 60 * 1000);
  console.log('Waitlist offer processor started (checking every 60 seconds)');
}
