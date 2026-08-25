import { describe, expect, test } from 'bun:test';
import {
  hasMixedReceiptCurrencies,
  isSubmitterEditableStatus,
  shouldSendCheckMailedEmail,
  mileageCapCents,
  receiptAllowsDurableGood,
  sumReceiptAmountsMinor,
  validateExpenseReportPayload,
  type ExpenseReportPayloadInput,
} from './expenseReportValidation.js';

function baseExpense(overrides: Partial<ExpenseReportPayloadInput> = {}): ExpenseReportPayloadInput {
  return {
    kind: 'expense',
    submitterName: 'Ada Member',
    submitterEmail: 'ada@example.com',
    submitterPhone: '555-0100',
    mailingAddress: {
      addressLine1: '1 Ice House Rd',
      city: 'Durham',
      state: 'North Carolina',
      country: 'United States',
      postalCode: '27701',
    },
    askClubCreditCard: false,
    requestedAmountMinor: 2500,
    purpose: 'Ice scraper',
    committeeCustom: 'Ice committee',
    receipts: [
      {
        name: 'Hardware store',
        receiptDate: '2026-08-01',
        amountMinor: 2500,
        currency: 'usd',
        includesDurableGood: false,
        hasFile: true,
      },
    ],
    ...overrides,
  };
}

describe('expense report validation', () => {
  test('caps mileage at 14 cents per mile', () => {
    expect(mileageCapCents(10)).toBe(140);
    expect(mileageCapCents(1.5)).toBe(21);
  });

  test('disables durable goods under $200', () => {
    expect(receiptAllowsDurableGood(19_999)).toBe(false);
    expect(receiptAllowsDurableGood(20_000)).toBe(true);
  });

  test('requires justification when the requested total differs from receipt sum', () => {
    const errors = validateExpenseReportPayload(
      baseExpense({ requestedAmountMinor: 2000 })
    );
    expect(errors.some((error) => error.field === 'amountJustification')).toBe(true);
  });

  test('requires justification for mixed currencies', () => {
    const errors = validateExpenseReportPayload(
      baseExpense({
        requestedAmountMinor: 5000,
        receipts: [
          {
            name: 'USD receipt',
            receiptDate: '2026-08-01',
            amountMinor: 2500,
            currency: 'usd',
            includesDurableGood: false,
            hasFile: true,
          },
          {
            name: 'CAD receipt',
            receiptDate: '2026-08-02',
            amountMinor: 2500,
            currency: 'cad',
            includesDurableGood: false,
            hasFile: true,
          },
        ],
      })
    );
    expect(errors.some((error) => error.field === 'amountJustification')).toBe(true);
  });

  test('rejects mileage above the charitable rate', () => {
    const errors = validateExpenseReportPayload({
      kind: 'mileage',
      submitterName: 'Ada Member',
      submitterEmail: 'ada@example.com',
      askClubCreditCard: false,
      requestedAmountMinor: 141,
      activityDate: '2026-08-01',
      fromKind: 'home',
      toKind: 'club',
      roundTripMiles: 10,
      tripPurpose: 'bar',
      receipts: [],
    });
    expect(errors.some((error) => error.field === 'requestedAmountMinor')).toBe(true);
  });

  test('allows reducing mileage reimbursement', () => {
    const errors = validateExpenseReportPayload({
      kind: 'mileage',
      submitterName: 'Ada Member',
      submitterEmail: 'ada@example.com',
      askClubCreditCard: false,
      requestedAmountMinor: 100,
      activityDate: '2026-08-01',
      fromKind: 'home',
      toKind: 'club',
      roundTripMiles: 10,
      tripPurpose: 'bar',
      receipts: [],
    });
    expect(errors).toEqual([]);
  });

  test('rejects durable-good flag on receipts under $200', () => {
    const errors = validateExpenseReportPayload(
      baseExpense({
        receipts: [
          {
            name: 'Tape',
            receiptDate: '2026-08-01',
            amountMinor: 500,
            currency: 'usd',
            includesDurableGood: true,
            hasFile: true,
          },
        ],
        requestedAmountMinor: 500,
      })
    );
    expect(errors.some((error) => error.field.endsWith('includesDurableGood'))).toBe(true);
  });

  test('sends check-mailed email only on transition into that status', () => {
    expect(shouldSendCheckMailedEmail('pending_review', 'check_mailed')).toBe(true);
    expect(shouldSendCheckMailedEmail('processing', 'check_mailed')).toBe(true);
    expect(shouldSendCheckMailedEmail('check_mailed', 'check_mailed')).toBe(false);
    expect(shouldSendCheckMailedEmail('check_mailed', 'complete')).toBe(false);
  });

  test('does not require justification when the requested amount matches the receipt sum', () => {
    expect(
      validateExpenseReportPayload(
        baseExpense({
          requestedAmountMinor: 2500,
          amountJustification: '',
        })
      )
    ).toEqual([]);
  });

  test('requires a club card answer when that question is asked', () => {
    const errors = validateExpenseReportPayload(
      baseExpense({
        askClubCreditCard: true,
        usedClubCreditCard: null,
      })
    );
    expect(errors.some((error) => error.field === 'usedClubCreditCard')).toBe(true);
  });

  test('requires a credit card owner when a club card was used', () => {
    const missingOwner = validateExpenseReportPayload(
      baseExpense({
        askClubCreditCard: true,
        usedClubCreditCard: true,
        clubCreditCardOwnerName: '',
      })
    );
    expect(missingOwner.some((error) => error.field === 'clubCreditCardOwnerName')).toBe(true);
    expect(
      validateExpenseReportPayload(
        baseExpense({
          askClubCreditCard: true,
          usedClubCreditCard: true,
          clubCreditCardOwnerName: 'Pat Treasurer',
          mailingAddress: null,
        })
      )
    ).toEqual([]);
  });

  test('locks submitter edits after pending review', () => {
    expect(isSubmitterEditableStatus('pending_review')).toBe(true);
    expect(isSubmitterEditableStatus('processing')).toBe(false);
    expect(isSubmitterEditableStatus('check_mailed')).toBe(false);
    expect(isSubmitterEditableStatus('complete')).toBe(false);
  });

  test('detects mixed currencies and sums receipts', () => {
    expect(sumReceiptAmountsMinor([{ amountMinor: 100 }, { amountMinor: 50 }])).toBe(150);
    expect(
      hasMixedReceiptCurrencies([
        { currency: 'usd' },
        { currency: 'cad' },
      ])
    ).toBe(true);
  });
});
