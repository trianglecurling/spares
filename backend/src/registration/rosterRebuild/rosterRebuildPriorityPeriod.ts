import { timestampToMillis } from '../waitlistOfferPreference.js';

/** Exclusive end of the Fall 2026 priority window when no `open` transition exists. */
export const FALLBACK_PRIORITY_PERIOD_END_ISO = '2026-09-04T00:01:00-04:00';

export type PriorityPeriodEndSource = 'open_transition' | 'fallback';

export type RegistrationStateTransitionLike = {
  id?: number;
  state: string;
  effectiveAt: Date | string | number | null;
};

export type PriorityPeriodEnd = {
  endMs: number;
  endIso: string;
  source: PriorityPeriodEndSource;
};

export function fallbackPriorityPeriodEndMs(): number {
  return Date.parse(FALLBACK_PRIORITY_PERIOD_END_ISO);
}

export function resolvePriorityPeriodEnd(transitions: RegistrationStateTransitionLike[]): PriorityPeriodEnd {
  const opens = transitions
    .map((row) => ({ row, ms: timestampToMillis(row.effectiveAt) }))
    .filter((row): row is { row: RegistrationStateTransitionLike; ms: number } => row.row.state === 'open' && row.ms != null)
    .sort((a, b) => a.ms - b.ms || (a.row.id ?? 0) - (b.row.id ?? 0));
  const first = opens[0];
  if (first) {
    return { endMs: first.ms, endIso: new Date(first.ms).toISOString(), source: 'open_transition' };
  }
  const endMs = fallbackPriorityPeriodEndMs();
  return { endMs, endIso: new Date(endMs).toISOString(), source: 'fallback' };
}

export function receivedDuringPriorityPeriod(
  receivedAt: Date | string | number | null | undefined,
  endMs: number,
): boolean {
  const ms = timestampToMillis(receivedAt);
  if (ms == null) return false;
  return ms < endMs;
}

export function isPriorityPeriodRegistration(registration: { receivedDuringPriorityPeriod: boolean }): boolean {
  return registration.receivedDuringPriorityPeriod;
}
