import type { WaitlistOfferResponsePreferenceSqlite } from '../db/drizzle-schema.js';

export type WaitlistOfferResponsePreference = WaitlistOfferResponsePreferenceSqlite;

export const WAITLIST_OFFER_RESPONSE_PREFERENCE_LABELS: Record<WaitlistOfferResponsePreference, string> = {
  ask: 'Ask me',
  auto_accept: 'Accept automatically',
  auto_decline: 'Decline automatically',
};