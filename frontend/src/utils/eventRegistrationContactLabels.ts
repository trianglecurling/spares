export const DEFAULT_CONTACT_FIRST_NAME_LABEL = 'First name';
export const DEFAULT_CONTACT_LAST_NAME_LABEL = 'Last name';
export const DEFAULT_CONTACT_EMAIL_LABEL = 'Email address';

export type EventContactFieldLabels = {
  contactFirstNameLabel?: string | null;
  contactLastNameLabel?: string | null;
  contactEmailLabel?: string | null;
};

export function resolveContactFieldLabel(
  override: string | null | undefined,
  fallback: string,
): string {
  const trimmed = override?.trim();
  return trimmed || fallback;
}

export function resolveEventContactFieldLabels(labels?: EventContactFieldLabels | null) {
  return {
    firstName: resolveContactFieldLabel(labels?.contactFirstNameLabel, DEFAULT_CONTACT_FIRST_NAME_LABEL),
    lastName: resolveContactFieldLabel(labels?.contactLastNameLabel, DEFAULT_CONTACT_LAST_NAME_LABEL),
    email: resolveContactFieldLabel(labels?.contactEmailLabel, DEFAULT_CONTACT_EMAIL_LABEL),
  };
}

/** Empty/whitespace becomes null for API persistence. */
export function normalizeContactFieldLabelOverride(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
