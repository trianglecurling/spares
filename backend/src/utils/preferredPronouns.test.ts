import { describe, expect, test } from 'bun:test';
import {
  PREFERRED_PRONOUN_OTHER_LABEL,
  PREFERRED_PRONOUN_OTHER_VALUE,
  PREFERRED_PRONOUN_PREFER_NOT_TO_SAY,
  normalizePreferredPronouns,
  preferredPronounsValidationMessage,
  resolvePreferredPronounsForSave,
  sanitizePreferredPronounsInput,
} from './preferredPronouns.js';

describe('preferred pronouns', () => {
  test('presets persist as selected', () => {
    expect(sanitizePreferredPronounsInput('She/Her')).toBe('She/Her');
    expect(resolvePreferredPronounsForSave('They/Them')).toBe('They/Them');
    expect(preferredPronounsValidationMessage('He/Him')).toBeNull();
  });

  test('custom values keep the typed text', () => {
    expect(sanitizePreferredPronounsInput('  Xe / Xem  ')).toBe('Xe / Xem');
    expect(resolvePreferredPronounsForSave('Xe/Xem')).toBe('Xe/Xem');
  });

  test('empty or Other persist as Prefer not to say', () => {
    expect(sanitizePreferredPronounsInput('')).toBe('');
    expect(sanitizePreferredPronounsInput(PREFERRED_PRONOUN_OTHER_VALUE)).toBe('');
    expect(sanitizePreferredPronounsInput(PREFERRED_PRONOUN_OTHER_LABEL)).toBe('');
    expect(resolvePreferredPronounsForSave('')).toBe(PREFERRED_PRONOUN_PREFER_NOT_TO_SAY);
    expect(resolvePreferredPronounsForSave(PREFERRED_PRONOUN_OTHER_VALUE)).toBe(
      PREFERRED_PRONOUN_PREFER_NOT_TO_SAY,
    );
    expect(preferredPronounsValidationMessage('')).toBeNull();
    expect(normalizePreferredPronouns('  He/Him  ')).toBe('He/Him');
  });
});
