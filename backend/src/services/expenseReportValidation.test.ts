import { describe, expect, test } from 'bun:test';
import {
  expenseAllowsDurableGood,
  hasMixedExpenseCurrencies,
  isSubmitterEditableStatus,
  mileageCapCents,
  shouldSendCheckMailedEmail,
  sumExpenseAmountsMinor,
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
    expenses: [
      {
        name: 'Hardware store',
        expenseDate: '2026-08-01',
        amountMinor: 2500,
        currency: 'usd',
        includesDurableGood: false,
        documents: [{ documentType: 'receipt', hasFile: true }],
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

  test('allows durable goods at $200 or more', () => {
    expect(expenseAllowsDurableGood(19_999)).toBe(false);
    expect(expenseAllowsDurableGood(20_000)).toBe(true);
  });

  test('requires justification when requested total differs from expense sum', () => {
    const errors = validateExpenseReportPayload(baseExpense({ requestedAmountMinor: 2000 }));
    expect(errors.some((error) => error.field === 'amountJustification')).toBe(true);
  });

  test('requires justification for mixed expense currencies', () => {
    const errors = validateExpenseReportPayload(
      baseExpense({
        requestedAmountMinor: 5000,
        expenses: [
          {
            name: 'USD expense',
            expenseDate: '2026-08-01',
            amountMinor: 2500,
            currency: 'usd',
            includesDurableGood: false,
            documents: [{ documentType: 'receipt', hasFile: true }],
          },
          {
            name: 'CAD expense',
            expenseDate: '2026-08-02',
            amountMinor: 2500,
            currency: 'cad',
            includesDurableGood: false,
            documents: [{ documentType: 'receipt', hasFile: true }],
          },
        ],
      })
    );
    expect(errors.some((error) => error.field === 'amountJustification')).toBe(true);
  });

  test('accepts one receipt plus other supporting documents', () => {
    expect(
      validateExpenseReportPayload(
        baseExpense({
          expenses: [
            {
              ...baseExpense().expenses[0],
              documents: [
                { documentType: 'receipt', hasFile: true },
                { documentType: 'invoice', hasFile: true },
                { documentType: 'other_supporting_evidence', hasFile: true },
              ],
            },
          ],
        })
      )
    ).toEqual([]);
  });

  test('accepts an explanation instead of a receipt', () => {
    expect(
      validateExpenseReportPayload(
        baseExpense({
          expenses: [
            {
              ...baseExpense().expenses[0],
              noReceiptExplanation: 'The vendor did not provide one.',
              documents: [{ documentType: 'invoice', hasFile: true }],
            },
          ],
        })
      )
    ).toEqual([]);
  });

  test('requires an explanation when an expense has no receipt', () => {
    const errors = validateExpenseReportPayload(
      baseExpense({
        expenses: [{ ...baseExpense().expenses[0], documents: [] }],
      })
    );
    expect(errors.some((error) => error.field.endsWith('noReceiptExplanation'))).toBe(true);
  });

  test('rejects more than one receipt for an expense', () => {
    const errors = validateExpenseReportPayload(
      baseExpense({
        expenses: [
          {
            ...baseExpense().expenses[0],
            documents: [
              { documentType: 'receipt', hasFile: true },
              { documentType: 'receipt', hasFile: true },
            ],
          },
        ],
      })
    );
    expect(errors.some((error) => error.field.endsWith('documents'))).toBe(true);
  });

  test('rejects a no-receipt explanation when a receipt is attached', () => {
    const errors = validateExpenseReportPayload(
      baseExpense({
        expenses: [
          {
            ...baseExpense().expenses[0],
            noReceiptExplanation: 'Conflicting state',
          },
        ],
      })
    );
    expect(errors.some((error) => error.field.endsWith('noReceiptExplanation'))).toBe(true);
  });

  test('sums all expense amounts', () => {
    expect(
      sumExpenseAmountsMinor([{ amountMinor: 2500 }, { amountMinor: 8000 }])
    ).toBe(10_500);
    expect(hasMixedExpenseCurrencies([{ currency: 'usd' }, { currency: 'cad' }])).toBe(true);
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
      expenses: [],
    });
    expect(errors.some((error) => error.field === 'requestedAmountMinor')).toBe(true);
  });

  test('requires a club card answer only when asked', () => {
    const errors = validateExpenseReportPayload(
      baseExpense({ askClubCreditCard: true, usedClubCreditCard: null })
    );
    expect(errors.some((error) => error.field === 'usedClubCreditCard')).toBe(true);
  });

  test('skips reimbursement amount when a club credit card was used', () => {
    expect(
      validateExpenseReportPayload(
        baseExpense({
          askClubCreditCard: true,
          usedClubCreditCard: true,
          clubCreditCardOwnerName: 'Pat Treasurer',
          requestedAmountMinor: 0,
          amountJustification: '',
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

  test('sends check-mailed email only on transition into that status', () => {
    expect(shouldSendCheckMailedEmail('pending_review', 'check_mailed')).toBe(true);
    expect(shouldSendCheckMailedEmail('check_mailed', 'check_mailed')).toBe(false);
  });
});
