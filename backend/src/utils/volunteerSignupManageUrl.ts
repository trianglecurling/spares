import { config } from '../config.js';

export function volunteerSignupManageUrl(accessToken: string): string {
  const base = config.frontendUrl.replace(/\/+$/, '');
  return `${base}/volunteering/public/signups/manage/${encodeURIComponent(accessToken)}`;
}

export function volunteerPublicProgramUrl(programSlug: string): string {
  const base = config.frontendUrl.replace(/\/+$/, '');
  return `${base}/volunteering/public/programs/${encodeURIComponent(programSlug)}`;
}
