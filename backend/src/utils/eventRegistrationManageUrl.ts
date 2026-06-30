import { config } from '../config.js';

export function eventRegistrationManageUrl(accessToken: string): string {
  const base = config.frontendUrl.replace(/\/+$/, '');
  return `${base}/events/registrations/manage/${encodeURIComponent(accessToken)}`;
}
