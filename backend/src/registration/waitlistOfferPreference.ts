import type { WaitlistOfferResponsePreferenceSqlite } from '../db/drizzle-schema.js';

export type WaitlistOfferResponsePreference = WaitlistOfferResponsePreferenceSqlite;
export type RegistrationWindowState = 'closed' | 'priority' | 'open';

export const WAITLIST_OFFER_RESPONSE_PREFERENCE_LABELS: Record<WaitlistOfferResponsePreference, string> = {
  ask: 'Ask me',
  auto_accept: 'Accept automatically',
  auto_decline: 'Decline automatically',
};

export function timestampToMillis(value: Date | string | number | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const isoish = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoish) ? isoish : `${isoish}Z`;
  const ms = new Date(withZone).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * After a member registers, waitlists for leagues on their priority list are
 * confirmed (auto-accept). Waitlists for leagues they left off the list stay
 * queued but auto-decline. Members who never register stay at Ask.
 */
export function waitlistOfferPreferenceAfterRegistration(input: {
  leagueId: number;
  priorityLeagueIds: Iterable<number>;
}): WaitlistOfferResponsePreference {
  return new Set(input.priorityLeagueIds).has(input.leagueId) ? 'auto_accept' : 'auto_decline';
}

export function isEnteringPriorityRegistration(
  previousState: RegistrationWindowState | null | undefined,
  nextState: RegistrationWindowState,
): boolean {
  return nextState === 'priority' && previousState !== 'priority';
}

/**
 * When priority registration opens, existing auto-accept/auto-decline entries
 * flip to Ask. Entries already updated at or after the opening (for example a
 * registration that just confirmed the waitlist) are left alone.
 */
export function shouldResetWaitlistPreferenceForPriorityOpen(input: {
  preference: string | null | undefined;
  updatedAt: Date | string | number | null | undefined;
  priorityOpenedAt: Date | string | number;
}): boolean {
  if ((input.preference ?? 'ask') === 'ask') return false;
  const openedAt = timestampToMillis(input.priorityOpenedAt);
  if (openedAt == null) return false;
  const updatedAt = timestampToMillis(input.updatedAt);
  if (updatedAt == null) return true;
  return updatedAt < openedAt;
}
