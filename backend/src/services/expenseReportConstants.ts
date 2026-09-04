export const CHARITABLE_MILEAGE_RATE_CENTS_PER_MILE = 14;
export const DURABLE_GOOD_THRESHOLD_MINOR = 20_000;
export const CLUB_CREDIT_CARD_HOLDER_CREDENTIAL_NAME = 'Club Credit Card Holder';
export const MAX_EXPENSE_ITEMS = 10;
export const MAX_EXPENSE_DOCUMENTS = 10;
export const FINANCE_CONTACT_EMAIL = 'finance@trianglecurling.com';

export const EXPENSE_REPORT_STATUSES = ['pending_review', 'processing', 'check_mailed', 'complete'] as const;
export const EXPENSE_REPORT_KINDS = ['expense', 'mileage'] as const;
export const EXPENSE_RECEIPT_CURRENCIES = ['usd', 'cad', 'other'] as const;
export const EXPENSE_DOCUMENT_TYPES = ['receipt', 'invoice', 'other_supporting_evidence'] as const;

export const EXPENSE_DOCUMENT_TYPE_LABELS: Record<(typeof EXPENSE_DOCUMENT_TYPES)[number], string> = {
  receipt: 'Receipt',
  invoice: 'Invoice',
  other_supporting_evidence: 'Other supporting evidence',
};
export const EXPENSE_TRIP_PURPOSES = [
  'bar',
  'bonspiel',
  'building_maintenance',
  'ice_maintenance',
  'instruction',
  'rental',
  'supply_pickup_delivery',
  'other',
] as const;

export const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const EXPENSE_STATUS_LABELS: Record<(typeof EXPENSE_REPORT_STATUSES)[number], string> = {
  pending_review: 'Pending review',
  processing: 'Processing',
  check_mailed: 'Check mailed',
  complete: 'Complete',
};

export const EXPENSE_TRIP_PURPOSE_LABELS: Record<(typeof EXPENSE_TRIP_PURPOSES)[number], string> = {
  bar: 'Bar',
  bonspiel: 'Bonspiel',
  building_maintenance: 'Building maintenance',
  ice_maintenance: 'Ice maintenance',
  instruction: 'Instruction (e.g. LtCs)',
  rental: 'Rental',
  supply_pickup_delivery: 'Supply pickup/delivery',
  other: 'Other',
};
