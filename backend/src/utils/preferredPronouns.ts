export const PREFERRED_PRONOUN_PRESET_VALUES = ['He/Him', 'She/Her', 'They/Them', 'Prefer not to say'] as const;

export type PreferredPronounPreset = (typeof PREFERRED_PRONOUN_PRESET_VALUES)[number];

export const PREFERRED_PRONOUN_PREFER_NOT_TO_SAY = 'Prefer not to say';

/** Sentinel used only as a dropdown option; never stored. */
export const PREFERRED_PRONOUN_OTHER_VALUE = '__other__';

export const PREFERRED_PRONOUN_OTHER_LABEL = 'Other...';

export const PREFERRED_PRONOUN_MAX_LENGTH = 80;

const PRESET_SET = new Set<string>(PREFERRED_PRONOUN_PRESET_VALUES);

export function normalizePreferredPronouns(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

export function isPreferredPronounPreset(value: string): value is PreferredPronounPreset {
  return PRESET_SET.has(value);
}

/** Strip UI sentinels and cap length while the user is typing. Empty stays empty. */
export function sanitizePreferredPronounsInput(value: string | null | undefined): string {
  const normalized = normalizePreferredPronouns(value);
  if (
    !normalized ||
    normalized === PREFERRED_PRONOUN_OTHER_VALUE ||
    normalized === PREFERRED_PRONOUN_OTHER_LABEL
  ) {
    return '';
  }
  return normalized.slice(0, PREFERRED_PRONOUN_MAX_LENGTH);
}

/** Persist empty / Other as Prefer not to say. */
export function resolvePreferredPronounsForSave(value: string | null | undefined): string {
  return sanitizePreferredPronounsInput(value) || PREFERRED_PRONOUN_PREFER_NOT_TO_SAY;
}

export function preferredPronounsValidationMessage(value: string | null | undefined): string | null {
  const normalized = normalizePreferredPronouns(value);
  if (
    !normalized ||
    normalized === PREFERRED_PRONOUN_OTHER_VALUE ||
    normalized === PREFERRED_PRONOUN_OTHER_LABEL
  ) {
    return null;
  }
  if (normalized.length > PREFERRED_PRONOUN_MAX_LENGTH) {
    return `Preferred pronouns must be ${PREFERRED_PRONOUN_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}
