import type { ChoiceRenderableOption } from '../components/ChoiceInput';

/** Stable slug used in `/contact?recipient=` links and contact form submissions. */
export type ContactRecipientSlug = string;

export type PublicContactRecipientOption = {
  id: number;
  slug: string;
  label: string;
  sortOrder: number;
};

export function toContactRecipientChoiceOptions(
  recipients: PublicContactRecipientOption[],
): ChoiceRenderableOption<string>[] {
  return recipients.map((recipient) => ({
    value: recipient.slug,
    label: recipient.label,
  }));
}

export function isKnownContactRecipientSlug(
  slug: string | null | undefined,
  recipients: PublicContactRecipientOption[],
): slug is string {
  if (slug == null || slug.trim() === '') return false;
  return recipients.some((recipient) => recipient.slug === slug);
}

export function resolveContactRecipientSlug(
  slug: string | null | undefined,
  recipients: PublicContactRecipientOption[],
  fallbackSlug?: string,
): string {
  if (isKnownContactRecipientSlug(slug, recipients)) {
    return slug;
  }
  if (fallbackSlug && isKnownContactRecipientSlug(fallbackSlug, recipients)) {
    return fallbackSlug;
  }
  return recipients[0]?.slug ?? 'general';
}

export function buildContactPageLink(recipientSlug: string): string {
  return `/contact?recipient=${encodeURIComponent(recipientSlug)}#send-message`;
}
