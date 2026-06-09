import { config } from '../config.js';

export function paymentDetailsUrl(orderToken: string): string {
  const base = config.frontendUrl.replace(/\/+$/, '');
  return `${base}/payments/${encodeURIComponent(orderToken)}`;
}
