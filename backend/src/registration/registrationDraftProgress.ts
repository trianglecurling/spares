/** Draft statuses only — submitted and later registrations are not resumable shell drafts. */
export const DRAFT_REGISTRATION_STATUSES = [
  'identity_incomplete',
  'policies_incomplete',
  'demographics_incomplete',
  'shell_complete',
] as const;

export const SUBMITTED_CURLER_REGISTRATION_STATUSES = [
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
  'paid',
  'confirmed',
] as const;

export type DraftRegistrationStatus = (typeof DRAFT_REGISTRATION_STATUSES)[number];
export type SubmittedCurlerRegistrationStatus = (typeof SUBMITTED_CURLER_REGISTRATION_STATUSES)[number];

export function isDraftRegistrationStatus(status: string): status is DraftRegistrationStatus {
  return (DRAFT_REGISTRATION_STATUSES as readonly string[]).includes(status);
}

export function isSubmittedCurlerRegistrationStatus(status: string): status is SubmittedCurlerRegistrationStatus {
  return (SUBMITTED_CURLER_REGISTRATION_STATUSES as readonly string[]).includes(status);
}

/** Picks the most recently touched in-progress draft; ignores submitted or cancelled rows. */
export function pickMostRecentInProgressDraft<T extends { status: string; updated_at: string }>(
  registrations: readonly T[],
): T | null {
  let latest: T | null = null;
  for (const registration of registrations) {
    if (!isDraftRegistrationStatus(registration.status)) continue;
    if (latest === null || registration.updated_at > latest.updated_at) {
      latest = registration;
    }
  }
  return latest;
}

export function hasBlockingInProgressDraft(existing: unknown | null | undefined): boolean {
  return existing != null;
}
