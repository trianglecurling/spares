import { describe, expect, test } from 'bun:test';
import {
  reimbursementCheckSelectionError,
  type ReimbursementCheckSelectionReport,
} from './expenseReports';

function report(
  overrides: Partial<ReimbursementCheckSelectionReport> = {}
): ReimbursementCheckSelectionReport {
  return {
    id: 1,
    status: 'approved',
    memberId: 7,
    submitterName: 'Ada Lovelace',
    submitterEmail: 'ada@example.com',
    requestedAmountMinor: 2500,
    requestedCurrency: 'usd',
    usedClubCreditCard: false,
    submittedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('reimbursementCheckSelectionError', () => {
  test('allows approved reimbursement reports for one person', () => {
    expect(
      reimbursementCheckSelectionError([
        report(),
        report({
          id: 2,
          submitterEmail: 'ada.other@example.com',
          requestedAmountMinor: 500,
          submittedAt: '2026-03-02T00:00:00.000Z',
        }),
      ])
    ).toBeNull();
  });

  test('explains each reason a selection cannot be issued', () => {
    expect(reimbursementCheckSelectionError([])).toBe('Select at least one expense report.');
    expect(reimbursementCheckSelectionError([report({ status: 'pending_review' })])).toBe(
      'Approve this report before issuing a check. Set the status to Approved first.'
    );
    expect(reimbursementCheckSelectionError([report({ status: 'processing' }), report({ id: 2 })])).toBe(
      'Approve each report before issuing a check. Set the status to Approved first.'
    );
    expect(reimbursementCheckSelectionError([report({ status: 'complete' })])).toBe(
      'This report is already complete.'
    );
    expect(reimbursementCheckSelectionError([report({ usedClubCreditCard: true, requestedAmountMinor: 0 })])).toBe(
      'This report does not request a reimbursement.'
    );
    expect(
      reimbursementCheckSelectionError([
        report(),
        report({ id: 2, memberId: 8, submitterName: 'Bea', submitterEmail: 'bea@example.com' }),
      ])
    ).toBe('A reimbursement check can cover only one person.');
    expect(
      reimbursementCheckSelectionError([
        report({ memberId: null, submitterEmail: 'guest@example.com' }),
        report({ id: 2, memberId: 7, submitterEmail: 'guest@example.com' }),
      ])
    ).toBe('A reimbursement check can cover only one person.');
    expect(
      reimbursementCheckSelectionError([report(), report({ id: 2, requestedCurrency: 'cad' })])
    ).toBe('These reports request different currencies.');
    expect(reimbursementCheckSelectionError([report({ submitterName: '  ' })])).toBe(
      'The submitter name and email are required to issue a check.'
    );
  });
});
