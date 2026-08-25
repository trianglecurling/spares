import type { ExpenseReportKind, ExpenseReportStatus } from '../db/drizzle-schema.js';
import {
  CHARITABLE_MILEAGE_RATE_CENTS_PER_MILE,
  DURABLE_GOOD_THRESHOLD_MINOR,
  MAX_EXPENSE_RECEIPTS,
} from './expenseReportConstants.js';

export type ExpenseMailingAddressInput = {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
};

export type ExpenseReceiptInput = {
  id?: number;
  name: string;
  receiptDate: string;
  amountMinor: number;
  currency: 'usd' | 'cad' | 'other';
  currencyOther?: string | null;
  includesDurableGood: boolean;
  hasFile: boolean;
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
  receipts: ExpenseReceiptInput[];
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

export function receiptAllowsDurableGood(amountMinor: number): boolean {
  return amountMinor >= DURABLE_GOOD_THRESHOLD_MINOR;
}

export function sumReceiptAmountsMinor(receipts: Array<{ amountMinor: number }>): number {
  return receipts.reduce((sum, receipt) => sum + receipt.amountMinor, 0);
}

export function receiptCurrencyKey(receipt: { currency: string; currencyOther?: string | null }): string {
  if (receipt.currency === 'other') {
    return `other:${(receipt.currencyOther ?? '').trim().toLowerCase()}`;
  }
  return receipt.currency.toLowerCase();
}

export function hasMixedReceiptCurrencies(
  receipts: Array<{ currency: string; currencyOther?: string | null }>
): boolean {
  const keys = new Set(receipts.map(receiptCurrencyKey));
  return keys.size > 1;
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

function requireText(value: string | null | undefined, field: string, message: string, errors: ExpenseFieldError[]) {
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
    requireText(input.purpose, 'purpose', 'Describe the purpose of this expense.', errors);

    if (input.receipts.length < 1) {
      errors.push({ field: 'receipts', message: 'Add at least one receipt.' });
    }
    if (input.receipts.length > MAX_EXPENSE_RECEIPTS) {
      errors.push({ field: 'receipts', message: `You can attach up to ${MAX_EXPENSE_RECEIPTS} receipts.` });
    }

    input.receipts.forEach((receipt, index) => {
      const prefix = `receipts.${index}`;
      requireText(receipt.name, `${prefix}.name`, 'Enter an expense name.', errors);
      if (!receipt.receiptDate || !isIsoDate(receipt.receiptDate)) {
        errors.push({ field: `${prefix}.receiptDate`, message: 'Enter a receipt date.' });
      }
      if (!Number.isInteger(receipt.amountMinor) || receipt.amountMinor <= 0) {
        errors.push({ field: `${prefix}.amountMinor`, message: 'Enter a receipt amount greater than zero.' });
      }
      if (receipt.currency === 'other') {
        requireText(receipt.currencyOther, `${prefix}.currencyOther`, 'Describe the other currency.', errors);
      }
      if (receipt.includesDurableGood && !receiptAllowsDurableGood(receipt.amountMinor)) {
        errors.push({
          field: `${prefix}.includesDurableGood`,
          message: 'Durable goods only apply to receipts of $200 or more.',
        });
      }
      if (!receipt.hasFile) {
        errors.push({ field: `${prefix}.file`, message: 'Upload a receipt file.' });
      }
    });

    if (!Number.isInteger(input.requestedAmountMinor) || input.requestedAmountMinor < 0) {
      errors.push({ field: 'requestedAmountMinor', message: 'Enter the total reimbursement requested.' });
    } else if (input.receipts.length > 0) {
      const receiptSum = sumReceiptAmountsMinor(input.receipts);
      const mixed = hasMixedReceiptCurrencies(input.receipts);
      const differs = mixed || input.requestedAmountMinor !== receiptSum;
      if (differs && !input.amountJustification?.trim()) {
        errors.push({
          field: 'amountJustification',
          message: mixed
            ? 'Receipts use more than one currency. Enter the USD amount to reimburse and explain the difference.'
            : 'Explain why the requested total differs from the sum of the receipts.',
        });
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
