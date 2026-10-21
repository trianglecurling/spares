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
export type ExpenseReportStatus = 'pending_review' | 'processing' | 'approved' | 'complete';

export const FINANCE_CONTACT_EMAIL = 'finance@trianglecurling.com';

export const EXPENSE_STATUS_OPTIONS = [
  { value: 'pending_review', label: 'Pending review' },
  { value: 'processing', label: 'Processing' },
  { value: 'approved', label: 'Approved' },
  { value: 'complete', label: 'Complete' },
] as const;

export function expenseReportRequiresReimbursement(report: {
  usedClubCreditCard?: boolean | null;
  requestedAmountMinor: number;
}): boolean {
  return report.usedClubCreditCard !== true && report.requestedAmountMinor > 0;
}

/** Statuses staff can set on this report. A reimbursement becomes Complete when its check is issued. */
export function expenseWorkflowStatusOptions(report: {
  status?: string | null;
  usedClubCreditCard?: boolean | null;
  requestedAmountMinor: number;
}): Array<(typeof EXPENSE_STATUS_OPTIONS)[number]> {
  const allowed: ExpenseReportStatus[] = expenseReportRequiresReimbursement(report)
    ? ['pending_review', 'processing', 'approved']
    : ['pending_review', 'processing', 'complete'];
  if (
    report.status &&
    !allowed.includes(report.status as ExpenseReportStatus) &&
    EXPENSE_STATUS_OPTIONS.some((option) => option.value === report.status)
  ) {
    allowed.push(report.status as ExpenseReportStatus);
  }
  return EXPENSE_STATUS_OPTIONS.filter((option) => allowed.includes(option.value));
}

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
  reimbursementCheck?: {
    id: number;
    checkNumber: string;
    amountMinor: number;
    currency: string;
    issuedAt: string;
  } | null;
  manageUrl?: string;
  accessToken?: string;
};

export type ReimbursementCheckPreview = {
  payeeName: string;
  payeePhone: string | null;
  payeeAddress: {
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  } | null;
  amountMinor: number;
  currency: string;
  reports: Array<{
    id: number;
    kind: string;
    submittedAt: string;
    amountMinor: number;
    currency: string;
    description: string | null;
  }>;
};

export type ExpenseReportListItem = {
  id: number;
  kind: ExpenseReportKind | string;
  status: ExpenseReportStatus | string;
  statusLabel: string;
  memberId: number | null;
  submitterName: string;
  submitterEmail: string;
  totalAmountMinor: number;
  requestedAmountMinor: number;
  requestedCurrency: string;
  usedClubCreditCard: boolean;
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

const MAX_REIMBURSEMENT_CHECK_REPORTS = 500;

export type ReimbursementCheckSelectionReport = {
  id: number;
  status: string;
  memberId: number | null;
  submitterName: string;
  submitterEmail: string;
  requestedAmountMinor: number;
  requestedCurrency: string;
  usedClubCreditCard: boolean;
  submittedAt: string;
};

function reimbursementReportPhrase(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function reimbursementPersonKey(report: ReimbursementCheckSelectionReport): string {
  if (report.memberId != null) return `member:${report.memberId}`;
  return `email:${report.submitterEmail.trim().toLowerCase()}`;
}

/** Why these reports cannot share a reimbursement check. Null when a check can be issued. */
export function reimbursementCheckSelectionError(
  reports: ReimbursementCheckSelectionReport[]
): string | null {
  if (reports.length === 0) return 'Select at least one expense report.';
  if (reports.length > MAX_REIMBURSEMENT_CHECK_REPORTS) {
    return `A reimbursement check can cover at most ${MAX_REIMBURSEMENT_CHECK_REPORTS} reports.`;
  }

  const phrase = (singular: string, plural: string) =>
    reimbursementReportPhrase(reports.length, singular, plural);

  if (reports.some((report) => report.usedClubCreditCard || report.requestedAmountMinor <= 0)) {
    return phrase(
      'This report does not request a reimbursement.',
      'One of these reports does not request a reimbursement.'
    );
  }
  if (reports.some((report) => report.status === 'pending_review' || report.status === 'processing')) {
    return phrase(
      'Approve this report before issuing a check. Set the status to Approved first.',
      'Approve each report before issuing a check. Set the status to Approved first.'
    );
  }
  if (reports.some((report) => report.status === 'complete' || report.status === 'check_mailed')) {
    return phrase('This report is already complete.', 'One of these reports is already complete.');
  }
  if (reports.some((report) => report.status !== 'approved')) {
    return phrase(
      'This report cannot be included on a reimbursement check.',
      'One of these reports cannot be included on a reimbursement check.'
    );
  }

  const personKeys = new Set(reports.map(reimbursementPersonKey));
  if (personKeys.size !== 1) return 'A reimbursement check can cover only one person.';

  const currencies = new Set(reports.map((report) => report.requestedCurrency.trim().toLowerCase()));
  if (currencies.size !== 1 || currencies.has('')) return 'These reports request different currencies.';

  const payee = [...reports].sort((left, right) => {
    const byDate = right.submittedAt.localeCompare(left.submittedAt);
    if (byDate !== 0) return byDate;
    return right.id - left.id;
  })[0];
  if (!payee?.submitterName.trim() || !payee.submitterEmail.trim()) {
    return 'The submitter name and email are required to issue a check.';
  }
  return null;
}
