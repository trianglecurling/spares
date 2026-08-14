import {
  PREFERRED_PRONOUN_PREFER_NOT_TO_SAY,
  resolvePreferredPronounsForSave,
} from './preferredPronouns.js';

export const NAME_TAG_NAME_MAX_LENGTH = 40;

export const NAME_TAG_PRONOUNS_LOCKED_MESSAGE =
  'To include pronouns, go back to the previous screen to specify.';

export const NAME_TAG_PRINT_GUIDANCE =
  'Enter the name you\u2019d like printed on your name tag. This should be the name you genuinely go by \u2014 a shortened or familiar form of your legal name is welcome, but joke names, handles, or stage names are not.';

export const NAME_TAG_INTRO = `All new members will receive a Triangle Curling name tag. ${NAME_TAG_PRINT_GUIDANCE}`;

export const NAME_TAG_REPLACEMENT_QUANTITIES = [1, 2, 3] as const;

export type NameTagReplacementPurchaseQuantity = (typeof NAME_TAG_REPLACEMENT_QUANTITIES)[number];
export type NameTagReplacementQuantity = 0 | NameTagReplacementPurchaseQuantity;

export function nameTagReplacementPurchaseQuestion(priceLabel: string): string {
  return `Would you like to purchase a replacement name tag for ${priceLabel}?`;
}

export function replacementNameTagLineDescription(quantity: number): string {
  return quantity === 1 ? 'Replacement name tag' : `Replacement name tag (\u00d7${quantity})`;
}

export function normalizeNameTagName(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

export function defaultNameTagPrintName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return normalizeNameTagName(`${firstName ?? ''} ${lastName ?? ''}`).slice(0, NAME_TAG_NAME_MAX_LENGTH);
}

export function nameTagPronounsAreIncludable(preferredPronouns: string | null | undefined): boolean {
  return resolvePreferredPronounsForSave(preferredPronouns) !== PREFERRED_PRONOUN_PREFER_NOT_TO_SAY;
}

export function resolveNameTagIncludePronounsForSave(
  preferredPronouns: string | null | undefined,
  includePronouns: boolean | null | undefined,
): boolean {
  if (!nameTagPronounsAreIncludable(preferredPronouns)) return false;
  return includePronouns === true;
}

export function nameTagIsComplete(
  name: string | null | undefined,
  includePronouns: boolean | number | null | undefined,
): boolean {
  if (!normalizeNameTagName(name)) return false;
  return includePronouns === true || includePronouns === false || includePronouns === 0 || includePronouns === 1;
}

export function nameTagIncludePronounsFromStored(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return null;
}

export function nameTagValidationMessage(input: {
  name: string | null | undefined;
  includePronouns: boolean | null | undefined;
  preferredPronouns?: string | null;
}): string | null {
  const name = normalizeNameTagName(input.name);
  if (!name) return 'Enter the name to print on your name tag.';
  if (name.length > NAME_TAG_NAME_MAX_LENGTH) {
    return `Name tag name must be ${NAME_TAG_NAME_MAX_LENGTH} characters or fewer.`;
  }
  if (!nameTagPronounsAreIncludable(input.preferredPronouns)) {
    return null;
  }
  if (input.includePronouns !== true && input.includePronouns !== false) {
    return 'Choose whether to include your pronouns on your name tag.';
  }
  return null;
}

export function parseNameTagReplacementQuantity(value: unknown): NameTagReplacementQuantity | null {
  if (value === 0 || value === '0') return 0;
  if (value === 1 || value === '1') return 1;
  if (value === 2 || value === '2') return 2;
  if (value === 3 || value === '3') return 3;
  return null;
}

export function nameTagStepIsComplete(input: {
  isReturningMember: boolean;
  name: string | null | undefined;
  includePronouns: boolean | number | null | undefined;
  replacementQuantity: unknown;
}): boolean {
  if (!input.isReturningMember) {
    return nameTagIsComplete(input.name, input.includePronouns);
  }
  const quantity = parseNameTagReplacementQuantity(input.replacementQuantity);
  if (quantity === 0) return true;
  if (quantity === 1 || quantity === 2 || quantity === 3) {
    return nameTagIsComplete(input.name, input.includePronouns);
  }
  return false;
}

export function nameTagStepValidationMessage(input: {
  isReturningMember: boolean;
  name: string | null | undefined;
  includePronouns: boolean | null | undefined;
  preferredPronouns?: string | null;
  replacementQuantity: unknown;
}): string | null {
  if (!input.isReturningMember) {
    return nameTagValidationMessage(input);
  }
  const quantity = parseNameTagReplacementQuantity(input.replacementQuantity);
  if (quantity === null) {
    return 'Choose whether to purchase a replacement name tag.';
  }
  if (quantity === 0) return null;
  return nameTagValidationMessage(input);
}
