import type { CurlingRegistrationSelectionKindSqlite, WaitlistOfferResponsePreferenceSqlite } from '../db/drizzle-schema.js';

export type WaitlistOfferResponsePreference = WaitlistOfferResponsePreferenceSqlite;

export const WAITLIST_OFFER_RESPONSE_PREFERENCE_LABELS: Record<WaitlistOfferResponsePreference, string> = {
  ask: 'Ask me',
  auto_accept: 'Accept automatically',
  auto_decline: 'Decline automatically',
};

export function offerPreferenceFromSelectionType(
  selectionType: CurlingRegistrationSelectionKindSqlite | string,
): WaitlistOfferResponsePreference | null {
  switch (selectionType) {
    case 'waitlist_add':
    case 'waitlist_replace':
    case 'waitlist_keep_auto_accept':
      return 'auto_accept';
    case 'waitlist_add_auto_decline':
    case 'waitlist_replace_auto_decline':
    case 'waitlist_keep_auto_decline':
      return 'auto_decline';
    default:
      return null;
  }
}

export function isWaitlistOfferPreferenceSelection(selectionType: string): boolean {
  return offerPreferenceFromSelectionType(selectionType) != null;
}
