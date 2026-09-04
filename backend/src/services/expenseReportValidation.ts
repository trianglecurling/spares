import type { ExpenseDocumentType, ExpenseReportKind, ExpenseReportStatus } from '../db/drizzle-schema.js';
import {
  CHARITABLE_MILEAGE_RATE_CENTS_PER_MILE,
  DURABLE_GOOD_THRESHOLD_MINOR,
  EXPENSE_DOCUMENT_TYPES,
  MAX_EXPENSE_DOCUMENTS,
  MAX_EXPENSE_ITEMS,
} from './expenseReportConstants.js';

export type ExpenseMailingAddressInput = {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
};

export type ExpenseDocumentInput = {
  id?: number;
  documentType: ExpenseDocumentType;
  hasFile: boolean;
};

export type ExpenseItemInput = {
  id?: number;
  name: string;
  expenseDate: string;
  amountMinor: number;
  currency: 'usd' | 'cad' | 'other';
  currencyOther?: string | null;
  includesDurableGood: boolean;
  noReceiptExplanation?: string | null;
  documents: ExpenseDocumentInput[];
};

export type ExpenseReportPayloadInput = {
  kind: ExpenseReportKind;
  submitterName: string;
  submitterEmail: string;
  submitterPhone?: string | null;
  mailingAddress?: ExpenseMailingAddressInput | null;
  comments?: string | null;
  committeeId?: number | null;
  committeeCustom?: string | null;
  purpose?: string | null;
  requestedAmountMinor: number;
  requestedCurrency?: string | null;
  amountJustification?: string | null;
  usedClubCreditCard?: boolean | null;
  clubCreditCardOwnerName?: string | null;
  clubCreditCardOwnerMemberId?: number | null;
  askClubCreditCard: boolean;
  expenses: ExpenseItemInput[];
  activityDate?: string | null;
  fromKind?: 'home' | 'other' | null;
  fromOther?: string | null;
  toKind?: 'club' | 'other' | null;
  toOther?: string | null;
  roundTripMiles?: number | null;
  tripPurpose?: string | null;
  tripPurposeOther?: string | null;
};

export type ExpenseFieldError = { field: string; message: string };

export function mileageCapCents(miles: number): number {
  return Math.round(miles * CHARITABLE_MILEAGE_RATE_CENTS_PER_MILE);
}

export function expenseAllowsDurableGood(amountMinor: number): boolean {
  return amountMinor >= DURABLE_GOOD_THRESHOLD_MINOR;
}

export function sumExpenseAmountsMinor(expenses: Array<{ amountMinor: number }>): number {
  return expenses.reduce((sum, expense) => sum + expense.amountMinor, 0);
}

export function expenseCurrencyKey(expense: {
  currency: string;
  currencyOther?: string | null;
}): string {
  if (expense.currency === 'other') {
    return `other:${(expense.currencyOther ?? '').trim().toLowerCase()}`;
  }
  return expense.currency.toLowerCase();
}

export function hasMixedExpenseCurrencies(
  expenses: Array<{ currency: string; currencyOther?: string | null }>
): boolean {
  return new Set(expenses.map(expenseCurrencyKey)).size > 1;
}

export function isSubmitterEditableStatus(status: ExpenseReportStatus): boolean {
  return status === 'pending_review';
}

export function shouldSendCheckMailedEmail(
  previousStatus: ExpenseReportStatus,
  nextStatus: ExpenseReportStatus
): boolean {
  return previousStatus !== 'check_mailed' && nextStatus === 'check_mailed';
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function requireText(
  value: string | null | undefined,
  field: string,
  message: string,
  errors: ExpenseFieldError[]
) {
  if (!value || !value.trim()) {
    errors.push({ field, message });
  }
}

function mailingAddressComplete(address: ExpenseMailingAddressInput | null | undefined): boolean {
  if (!address) return false;
  return Boolean(
    address.addressLine1?.trim() &&
      address.city?.trim() &&
      address.state?.trim() &&
      address.postalCode?.trim() &&
      address.country?.trim()
  );
}

export function validateExpenseReportPayload(input: ExpenseReportPayloadInput): ExpenseFieldError[] {
  const errors: ExpenseFieldError[] = [];

  requireText(input.submitterName, 'submitterName', 'Enter your name.', errors);
  requireText(input.submitterEmail, 'submitterEmail', 'Enter your email.', errors);
  if (input.submitterEmail?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.submitterEmail.trim())) {
    errors.push({ field: 'submitterEmail', message: 'Enter a valid email address.' });
  }

  const usedClubCard = input.usedClubCreditCard === true;
  if (input.askClubCreditCard && input.kind === 'expense' && input.usedClubCreditCard == null) {
    errors.push({ field: 'usedClubCreditCard', message: 'Say whether this was charged to a club credit card.' });
  }
  if (input.kind === 'expense' && usedClubCard) {
    requireText(
      input.clubCreditCardOwnerName,
      'clubCreditCardOwnerName',
      'Enter the name of the credit card owner.',
      errors
    );
  }
  if (input.kind === 'expense' && !usedClubCard && !mailingAddressComplete(input.mailingAddress ?? null)) {
    errors.push({ field: 'mailingAddress', message: 'Confirm the address to mail the reimbursement check.' });
  }

  if (input.kind === 'expense') {
    const hasCommittee = Boolean(input.committeeId) || Boolean(input.committeeCustom?.trim());
    if (!hasCommittee) {
      errors.push({ field: 'committee', message: 'Select a committee or enter a custom value.' });
    }
    requireText(input.purpose, 'purpose', 'Describe the purpose of this expense report.', errors);

    if (input.expenses.length < 1) {
      errors.push({ field: 'expenses', message: 'Add at least one expense.' });
    }
    if (input.expenses.length > MAX_EXPENSE_ITEMS) {
      errors.push({
        field: 'expenses',
        message: `You can include up to ${MAX_EXPENSE_ITEMS} expenses.`,
      });
    }
    const documentCount = input.expenses.reduce((sum, expense) => sum + expense.documents.length, 0);
    if (documentCount > MAX_EXPENSE_DOCUMENTS) {
      errors.push({
        field: 'expenses',
        message: `You can attach up to ${MAX_EXPENSE_DOCUMENTS} documents per report.`,
      });
    }

    input.expenses.forEach((expense, expenseIndex) => {
      const prefix = `expenses.${expenseIndex}`;
      requireText(expense.name, `${prefix}.name`, 'Enter an expense name.', errors);
      if (!expense.expenseDate || !isIsoDate(expense.expenseDate)) {
        errors.push({ field: `${prefix}.expenseDate`, message: 'Enter a date.' });
      }
      if (!Number.isInteger(expense.amountMinor) || expense.amountMinor <= 0) {
        errors.push({ field: `${prefix}.amountMinor`, message: 'Enter an amount greater than zero.' });
      }
      if (expense.currency === 'other') {
        requireText(expense.currencyOther, `${prefix}.currencyOther`, 'Describe the other currency.', errors);
      }
      if (expense.includesDurableGood && !expenseAllowsDurableGood(expense.amountMinor)) {
        errors.push({
          field: `${prefix}.includesDurableGood`,
          message: 'Durable goods only apply to expenses of $200 or more.',
        });
      }

      const receiptCount = expense.documents.filter(
        (document) => document.documentType === 'receipt'
      ).length;
      if (receiptCount > 1) {
        errors.push({ field: `${prefix}.documents`, message: 'Attach only one receipt for this expense.' });
      } else if (receiptCount === 0) {
        requireText(
          expense.noReceiptExplanation,
          `${prefix}.noReceiptExplanation`,
          'Explain why you do not have a receipt.',
          errors
        );
      } else if (expense.noReceiptExplanation?.trim()) {
        errors.push({
          field: `${prefix}.noReceiptExplanation`,
          message: 'Remove the no-receipt explanation when a receipt is attached.',
        });
      }

      expense.documents.forEach((document, documentIndex) => {
        const documentPrefix = `${prefix}.documents.${documentIndex}`;
        if (!EXPENSE_DOCUMENT_TYPES.includes(document.documentType)) {
          errors.push({ field: `${documentPrefix}.documentType`, message: 'Select a document type.' });
        }
        if (!document.hasFile) {
          errors.push({ field: `${documentPrefix}.file`, message: 'Upload a file.' });
        }
      });
    });

    if (!usedClubCard) {
      if (!Number.isInteger(input.requestedAmountMinor) || input.requestedAmountMinor < 0) {
        errors.push({ field: 'requestedAmountMinor', message: 'Enter the total reimbursement requested.' });
      } else if (input.expenses.length > 0) {
        const expenseSum = sumExpenseAmountsMinor(input.expenses);
        const mixed = hasMixedExpenseCurrencies(input.expenses);
        if ((mixed || input.requestedAmountMinor !== expenseSum) && !input.amountJustification?.trim()) {
          errors.push({
            field: 'amountJustification',
            message: mixed
              ? 'Expenses use more than one currency. Enter the USD amount to reimburse and explain the difference.'
              : 'Explain why the requested total differs from the sum of the expenses.',
          });
        }
      }
    }
  }

  if (input.kind === 'mileage') {
    if (!input.activityDate || !isIsoDate(input.activityDate)) {
      errors.push({ field: 'activityDate', message: 'Enter the date of the volunteer activity.' });
    }
    if (input.fromKind !== 'home' && input.fromKind !== 'other') {
      errors.push({ field: 'fromKind', message: 'Choose where the trip started.' });
    }
    if (input.fromKind === 'other') {
      requireText(input.fromOther, 'fromOther', 'Specify where the trip started.', errors);
    }
    if (input.toKind !== 'club' && input.toKind !== 'other') {
      errors.push({ field: 'toKind', message: 'Choose where the trip went.' });
    }
    if (input.toKind === 'other') {
      requireText(input.toOther, 'toOther', 'Specify where the trip went.', errors);
    }
    const miles = input.roundTripMiles;
    if (typeof miles !== 'number' || !Number.isFinite(miles) || miles <= 0) {
      errors.push({ field: 'roundTripMiles', message: 'Enter round trip mileage greater than zero.' });
    }
    requireText(input.tripPurpose, 'tripPurpose', 'Select the purpose of the trip.', errors);
    if (input.tripPurpose === 'other') {
      requireText(input.tripPurposeOther, 'tripPurposeOther', 'Specify the purpose of the trip.', errors);
    }
    if (typeof miles === 'number' && Number.isFinite(miles) && miles > 0) {
      const cap = mileageCapCents(miles);
      if (!Number.isInteger(input.requestedAmountMinor) || input.requestedAmountMinor < 0) {
        errors.push({ field: 'requestedAmountMinor', message: 'Enter the requested reimbursement.' });
      } else if (input.requestedAmountMinor > cap) {
        errors.push({
          field: 'requestedAmountMinor',
          message: 'Requested reimbursement cannot exceed $0.14 per mile.',
        });
      }
    }
  }

  return errors;
}
