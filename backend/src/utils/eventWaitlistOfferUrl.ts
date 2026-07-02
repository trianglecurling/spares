import { config } from '../config.js';

export function eventWaitlistOfferUrl(responseToken: string): string {
  const base = config.frontendUrl.replace(/\/+$/, '');
  return `${base}/events/waitlist-offers/${encodeURIComponent(responseToken)}`;
}
