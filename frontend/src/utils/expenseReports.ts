import type { StructuredPostalAddress } from './structuredPostalAddress';
import { formatClubDateTime } from './clubTime';

export const CHARITABLE_MILEAGE_RATE_CENTS_PER_MILE = 14;
export const DURABLE_GOOD_THRESHOLD_MINOR = 20_000;
export const MAX_EXPENSE_ITEMS = 10;
export const MAX_EXPENSE_DOCUMENTS = 10;

export const EXPENSE_DOCUMENT_TYPE_OPTIONS = [
  { value: 'receipt', label: 'Receipt' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'other_supporting_evidence', label: 'Other supporting evidence' },
] as const;

export type ExpenseDocumentType = (typeof EXPENSE_DOCUMENT_TYPE_OPTIONS)[number]['value'];

export const EXPENSE_DOCUMENT_TYPE_LABELS: Record<ExpenseDocumentType, string> = {
  receipt: 'Receipt',
  invoice: 'Invoice',
  other_supporting_evidence: 'Other supporting evidence',
};

export const EXPENSE_TRIP_PURPOSE_OPTIONS = [
  { value: 'bar', label: 'Bar' },
  { value: 'bonspiel', label: 'Bonspiel' },
  { value: 'building_maintenance', label: 'Building maintenance' },
  { value: 'ice_maintenance', label: 'Ice maintenance' },
  { value: 'instruction', label: 'Instruction (e.g. LtCs)' },
  { value: 'rental', label: 'Rental' },
  { value: 'supply_pickup_delivery', label: 'Supply pickup/delivery' },
  { value: 'other', label: 'Other (specify)' },
] as const;

export type ExpenseReportKind = 'expense' | 'mileage';
export type ExpenseReportStatus = 'pending_review' | 'processing' | 'check_mailed' | 'complete';

export const FINANCE_CONTACT_EMAIL = 'finance@trianglecurling.com';

export const EXPENSE_STATUS_OPTIONS = [
  { value: 'pending_review', label: 'Pending review' },
  { value: 'processing', label: 'Processing' },
  { value: 'check_mailed', label: 'Check mailed' },
  { value: 'complete', label: 'Complete' },
] as const;

export type ExpenseDocumentView = {
  id: number;
  documentType?: ExpenseDocumentType | string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sortOrder: number;
};

export type ExpenseItemView = {
  id: number;
  name: string;
  expenseDate: string;
  amountMinor: number;
  currency: string;
  currencyOther: string | null;
  includesDurableGood: boolean;
  noReceiptExplanation: string | null;
  sortOrder: number;
  documents: ExpenseDocumentView[];
};

export type ExpenseReportNoteView = {
  id: number;
  authorName: string;
  body: string;
  createdAt: string;
};

export type ExpenseReportChangeView = {
  id: number;
  actorName: string;
  kind: 'fields' | 'status' | string;
  summary: string;
  details: Array<{ field: string; from: string; to: string }> | null;
  createdAt: string;
};

export type ExpenseAdminSummary = {
  unprocessedCount: number;
  awaitingReimbursementCount: number;
  monthToDateAmountMinor: number;
};

export type ExpenseReportView = {
  id: number;
  kind: ExpenseReportKind | string;
  status: ExpenseReportStatus | string;
  statusLabel: string;
  memberId: number | null;
  submitterName: string;
  submitterEmail: string;
  submitterPhone: string | null;
  mailingAddress: StructuredPostalAddress | null;
  committeeId: number | null;
  committeeName: string | null;
  committeeCustom: string | null;
  purpose: string | null;
  requestedAmountMinor: number;
  requestedCurrency: string;
  amountJustification: string | null;
  usedClubCreditCard: boolean | null;
  clubCreditCardOwnerMemberId: number | null;
  clubCreditCardOwnerName: string | null;
  comments: string | null;
  activityDate: string | null;
  fromKind: string | null;
  fromOther: string | null;
  toKind: string | null;
  toOther: string | null;
  roundTripMiles: number | null;
  tripPurpose: string | null;
  tripPurposeOther: string | null;
  expenses: ExpenseItemView[];
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  statusChangedByName?: string | null;
  statusChangedAt?: string | null;
  lastUpdatedByName?: string | null;
  notes?: ExpenseReportNoteView[];
  changes?: ExpenseReportChangeView[];
  manageUrl?: string;
  accessToken?: string;
};

export type ExpenseReportListItem = {
  id: number;
  kind: ExpenseReportKind | string;
  status: ExpenseReportStatus | string;
  statusLabel: string;
  submitterName: string;
  submitterEmail: string;
  requestedAmountMinor: number;
  requestedCurrency: string;
  submittedAt: string;
};

export type ExpenseFieldError = { field: string; message: string };

export function dollarsToMinor(value: string): number {
  const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function minorToDollarsInput(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function formatExpenseMoney(amountMinor: number, currency = 'usd'): string {
  const code = /^[a-z]{3}$/i.test(currency) ? currency.toUpperCase() : 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function mileageCapCents(miles: number): number {
  return Math.round(miles * CHARITABLE_MILEAGE_RATE_CENTS_PER_MILE);
}

export function expenseKindLabel(kind: string): string {
  return kind === 'mileage' ? 'Mileage' : 'Expense';
}

export function asExpenseDocumentType(value: string | null | undefined): ExpenseDocumentType {
  if (value === 'invoice' || value === 'other_supporting_evidence') return value;
  return 'receipt';
}

export function expenseDocumentTypeLabel(value: string | null | undefined): string {
  return EXPENSE_DOCUMENT_TYPE_LABELS[asExpenseDocumentType(value)];
}

export function formatSubmittedAt(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return formatClubDateTime(date) || value.slice(0, 10);
}
