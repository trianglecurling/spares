import { describe, expect, test } from 'bun:test';
import {
  expenseAllowsDurableGood,
  hasMixedExpenseCurrencies,
  expenseReportRequiresReimbursement,
  isSubmitterEditableStatus,
  manualExpenseReportStatusError,
  mileageCapCents,
  planReimbursementCheck,
  sumExpenseAmountsMinor,
  validateExpenseReportPayload,
  type ExpenseReportPayloadInput,
  type ReimbursementCheckReportInput,
} from './expenseReportValidation.js';

function checkReport(overrides: Partial<ReimbursementCheckReportInput> = {}): ReimbursementCheckReportInput {
  return {
    id: 1,
    status: 'approved',
    memberId: 7,
    submitterName: 'Ada Member',
    submitterEmail: 'ada@example.com',
    requestedAmountMinor: 2500,
    requestedCurrency: 'usd',
    usedClubCreditCard: false,
    submittedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

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
      mailingAddress: {
        addressLine1: '1 Ice House Rd',
        city: 'Durham',
        state: 'North Carolina',
        country: 'United States',
        postalCode: '27701',
      },
      expenses: [],
    });
    expect(errors.some((error) => error.field === 'requestedAmountMinor')).toBe(true);
  });

  test('requires a mailing address for mileage reimbursement', () => {
    const errors = validateExpenseReportPayload({
      kind: 'mileage',
      submitterName: 'Ada Member',
      submitterEmail: 'ada@example.com',
      askClubCreditCard: false,
      requestedAmountMinor: 140,
      activityDate: '2026-08-01',
      fromKind: 'home',
      toKind: 'club',
      roundTripMiles: 10,
      tripPurpose: 'bar',
      mailingAddress: null,
      expenses: [],
    });
    expect(errors.some((error) => error.field === 'mailingAddress')).toBe(true);
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
    expect(isSubmitterEditableStatus('approved')).toBe(false);
    expect(isSubmitterEditableStatus('complete')).toBe(false);
  });

  test('reserves Approved for reimbursement reports', () => {
    expect(expenseReportRequiresReimbursement({ usedClubCreditCard: false, requestedAmountMinor: 100 })).toBe(true);
    expect(expenseReportRequiresReimbursement({ usedClubCreditCard: true, requestedAmountMinor: 0 })).toBe(false);
    expect(
      manualExpenseReportStatusError({ nextStatus: 'approved', requiresReimbursement: false })
    ).toMatch(/Approved is only/);
    expect(
      manualExpenseReportStatusError({ nextStatus: 'complete', requiresReimbursement: true })
    ).toMatch(/Issue a reimbursement check/);
    expect(
      manualExpenseReportStatusError({ nextStatus: 'complete', requiresReimbursement: false })
    ).toBeNull();
    expect(
      manualExpenseReportStatusError({ nextStatus: 'approved', requiresReimbursement: true })
    ).toBeNull();
  });

  test('plans one reimbursement check for several reports from one person', () => {
    const result = planReimbursementCheck([
      checkReport({ id: 2, memberId: 7, submitterEmail: 'Ada@Example.com', requestedAmountMinor: 1500, submittedAt: '2026-03-02T00:00:00.000Z' }),
      checkReport({ id: 1, memberId: 7, requestedAmountMinor: 500, submittedAt: '2026-03-01T00:00:00.000Z' }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.amountMinor).toBe(2000);
    expect(result.plan.reportIds).toEqual([1, 2]);
    expect(result.plan.payeeEmail).toBe('Ada@Example.com');
    expect(result.plan.memberId).toBe(7);
  });

  test('rejects a reimbursement check that mixes people', () => {
    const result = planReimbursementCheck([
      checkReport({ id: 1, memberId: 7 }),
      checkReport({ id: 2, memberId: 8, submitterName: 'Bea', submitterEmail: 'bea@example.com' }),
    ]);
    expect(result).toEqual({ ok: false, message: 'A reimbursement check can cover only one person.' });
  });

  test('treats guest reports with the same email as one person', () => {
    const result = planReimbursementCheck([
      checkReport({ id: 1, memberId: null, submitterEmail: 'Guest@Example.com' }),
      checkReport({ id: 2, memberId: null, submitterEmail: 'guest@example.com' }),
    ]);
    expect(result.ok).toBe(true);
  });

  test('requires approval before a reimbursement check', () => {
    const pending = planReimbursementCheck([checkReport({ status: 'pending_review' })]);
    const processing = planReimbursementCheck([checkReport({ status: 'processing' })]);
    expect(pending.ok).toBe(false);
    expect(processing.ok).toBe(false);
    if (pending.ok || processing.ok) return;
    expect(pending.message).toContain('Set the status to Approved');
    expect(processing.message).toContain('Set the status to Approved');
  });

  test('does not put a club card report on a reimbursement check', () => {
    const result = planReimbursementCheck([checkReport({ usedClubCreditCard: true, requestedAmountMinor: 0 })]);
    expect(result).toEqual({ ok: false, message: 'This report does not request a reimbursement.' });
  });
});
