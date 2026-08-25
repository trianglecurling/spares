import { config } from '../config.js';

export function expenseReportManageUrl(accessToken: string): string {
  const base = config.frontendUrl.replace(/\/+$/, '');
  return `${base}/expenses/manage/${encodeURIComponent(accessToken)}`;
}
