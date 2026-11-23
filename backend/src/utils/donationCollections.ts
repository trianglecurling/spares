export const DONATION_COLLECTION_SOURCE = 'donation_collection';
export const MIN_DONATION_AMOUNT_MINOR = 100;
export const MAX_DONATION_AMOUNT_MINOR = 5_000_000;

export type DonationCollectionWindowStatus = 'upcoming' | 'open' | 'ended';

export function donationCollectionFeeNote(causeName: string): string {
  return `Your full donation amount will be collected for ${causeName.trim()}, less any credit card processing fees (about 3%).`;
}

export function defaultDonationCollectionItemName(causeName: string): string {
  return `Donation — ${causeName.trim()}`;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function truncateDonationCheckoutText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export function isDonationCollectionMetadata(metadata: Record<string, unknown>): boolean {
  if (asString(metadata.source) === DONATION_COLLECTION_SOURCE) return true;
  const id = metadata.donationCollectionId ?? metadata.donation_collection_id;
  return typeof id === 'number' && Number.isFinite(id) && id > 0;
}

export function donationCheckoutItemDescription(metadata: Record<string, unknown>): string {
  const customName = asString(metadata.paymentItemName ?? metadata.payment_item_name);
  if (customName) return truncateDonationCheckoutText(customName, 512);
  if (!isDonationCollectionMetadata(metadata)) return 'Donation to Triangle Curling Club';
  const causeName = asString(metadata.causeName ?? metadata.cause_name);
  if (causeName) return truncateDonationCheckoutText(defaultDonationCollectionItemName(causeName), 512);
  const collectionName = asString(metadata.donationCollectionName ?? metadata.donation_collection_name);
  if (collectionName) return truncateDonationCheckoutText(`Donation — ${collectionName}`, 512);
  return 'Donation';
}

export function donationCollectionWindowStatus(
  today: string,
  startDate: string,
  endDate: string
): DonationCollectionWindowStatus {
  if (today < startDate) return 'upcoming';
  if (today > endDate) return 'ended';
  return 'open';
}

export function normalizeDonorPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 40) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return trimmed;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatDonationMoney(amountMinor: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export function donationCollectionConfirmationContent(input: {
  donorName: string;
  causeName: string;
  collectionName: string;
  amountMinor: number;
  currency: string;
  receivedAtLabel: string;
  receiptUrl: string;
}): { subject: string; html: string; text: string } {
  const causeName = input.causeName.trim();
  const collectionName = input.collectionName.trim();
  const amount = formatDonationMoney(input.amountMinor, input.currency);
  const feeNote = donationCollectionFeeNote(causeName);
  const collectionLine =
    collectionName && collectionName !== causeName
      ? `This gift was made through the ${collectionName} donation collection.`
      : null;

  const text = [
    `Dear ${input.donorName},`,
    '',
    `Thank you for your donation of ${amount} for ${causeName}. We received it on ${input.receivedAtLabel}.`,
    collectionLine,
    '',
    feeNote,
    '',
    `View your receipt: ${input.receiptUrl}`,
    '',
    'Triangle Curling Club',
  ]
    .filter((line) => line != null)
    .join('\n');

  const collectionHtml = collectionLine ? `<p>${escapeHtml(collectionLine)}</p>` : '';
  const html = `
    <p>Dear ${escapeHtml(input.donorName)},</p>
    <p>Thank you for your donation of ${escapeHtml(amount)} for ${escapeHtml(causeName)}. We received it on ${escapeHtml(input.receivedAtLabel)}.</p>
    ${collectionHtml}
    <p>${escapeHtml(feeNote)}</p>
    <p><a href="${escapeHtml(input.receiptUrl)}">View your receipt</a></p>
    <p>Triangle Curling Club</p>
  `;

  return {
    subject: `Donation confirmation - ${causeName}`,
    html,
    text,
  };
}
