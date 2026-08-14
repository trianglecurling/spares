import { describe, expect, test } from 'bun:test';
import {
  NAME_TAG_NAME_MAX_LENGTH,
  defaultNameTagPrintName,
  nameTagIsComplete,
  nameTagPronounsAreIncludable,
  nameTagStepIsComplete,
  nameTagValidationMessage,
  resolveNameTagIncludePronounsForSave,
} from './nameTag.js';

describe('name tag', () => {
  test('pronouns are not includable when prefer not to say', () => {
    expect(nameTagPronounsAreIncludable('')).toBe(false);
    expect(nameTagPronounsAreIncludable('Prefer not to say')).toBe(false);
    expect(nameTagPronounsAreIncludable('She/Her')).toBe(true);
    expect(nameTagPronounsAreIncludable('Xe/Xem')).toBe(true);
  });

  test('locked pronouns force include to false', () => {
    expect(resolveNameTagIncludePronounsForSave('Prefer not to say', true)).toBe(false);
    expect(resolveNameTagIncludePronounsForSave('He/Him', true)).toBe(true);
    expect(resolveNameTagIncludePronounsForSave('He/Him', false)).toBe(false);
    expect(resolveNameTagIncludePronounsForSave('He/Him', null)).toBe(false);
  });

  test('print name defaults to first and last name', () => {
    expect(defaultNameTagPrintName('Jamie', 'Lee')).toBe('Jamie Lee');
    expect(defaultNameTagPrintName(' Jamie ', '  Lee ')).toBe('Jamie Lee');
  });

  test('completeness requires a name and a yes/no answer', () => {
    expect(nameTagIsComplete('', false)).toBe(false);
    expect(nameTagIsComplete('Jamie', null)).toBe(false);
    expect(nameTagIsComplete('Jamie', false)).toBe(true);
    expect(nameTagIsComplete('Jamie', 1)).toBe(true);
  });

  test('returning members complete the step by declining or buying 1–3 tags', () => {
    expect(
      nameTagStepIsComplete({
        isReturningMember: true,
        name: '',
        includePronouns: null,
        replacementQuantity: null,
      }),
    ).toBe(false);
    expect(
      nameTagStepIsComplete({
        isReturningMember: true,
        name: '',
        includePronouns: null,
        replacementQuantity: 0,
      }),
    ).toBe(true);
    expect(
      nameTagStepIsComplete({
        isReturningMember: true,
        name: '',
        includePronouns: false,
        replacementQuantity: 2,
      }),
    ).toBe(false);
    expect(
      nameTagStepIsComplete({
        isReturningMember: true,
        name: 'Jamie',
        includePronouns: false,
        replacementQuantity: 2,
      }),
    ).toBe(true);
  });

  test('validation covers empty name and missing radio', () => {
    expect(nameTagValidationMessage({ name: '', includePronouns: false })).toBe(
      'Enter the name to print on your name tag.',
    );
    expect(
      nameTagValidationMessage({
        name: 'A'.repeat(NAME_TAG_NAME_MAX_LENGTH + 1),
        includePronouns: false,
      }),
    ).toContain(`${NAME_TAG_NAME_MAX_LENGTH} characters`);
    expect(
      nameTagValidationMessage({
        name: 'Jamie',
        includePronouns: null,
        preferredPronouns: 'They/Them',
      }),
    ).toBe('Choose whether to include your pronouns on your name tag.');
    expect(
      nameTagValidationMessage({
        name: 'Jamie',
        includePronouns: null,
        preferredPronouns: 'Prefer not to say',
      }),
    ).toBeNull();
  });
});
