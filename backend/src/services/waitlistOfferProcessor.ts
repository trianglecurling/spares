import { autoDeclineExpiredWaitlistOffers } from '../registration/waitlistStaffService.js';
import { syncWaitlistOfferPreferencesForPriorityOpen } from '../registration/waitlistPreferenceReset.js';

let processorStarted = false;

export function startWaitlistOfferProcessor(): void {
  if (processorStarted) return;
  processorStarted = true;
  setInterval(() => {
    autoDeclineExpiredWaitlistOffers().catch((error) => {
      console.error('Error in waitlist offer processor:', error);
    });
    syncWaitlistOfferPreferencesForPriorityOpen().catch((error) => {
      console.error('Error resetting waitlist offer preferences for priority registration:', error);
    });
  }, 60 * 1000);
  console.log('Waitlist offer processor started (checking every 60 seconds)');
}
