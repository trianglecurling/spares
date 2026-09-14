import { describe, expect, test } from 'bun:test';
import {
  canReviewFinancialAssistance,
  defaultApprovedAssistancePercent,
  financialAssistancePercentOptions,
  financialAssistanceReviewDecision,
} from './financialAssistanceReviewShared';

describe('financialAssistanceReviewDecision', () => {
  test('denies a zero percent decision', () => {
    expect(financialAssistanceReviewDecision(50, 0)).toEqual({ status: 'denied', approvedPercentage: 0 });
  });

  test('approves the requested percent', () => {
    expect(financialAssistanceReviewDecision(50, 50)).toEqual({ status: 'approved', approvedPercentage: 50 });
  });

  test('marks a different positive percent as partially approved', () => {
    expect(financialAssistanceReviewDecision(75, 25)).toEqual({
      status: 'partially_approved',
      approvedPercentage: 25,
    });
  });
});

describe('financial assistance review helpers', () => {
  test('includes the requested percent among the choices', () => {
    expect(financialAssistancePercentOptions(50).map((option) => option.value)).toEqual(['0', '25', '50', '75']);
    expect(financialAssistancePercentOptions(50).find((option) => option.value === '50')?.label).toBe(
      '50% (requested)',
    );
  });

  test('defaults pending review to the requested percent', () => {
    expect(
      defaultApprovedAssistancePercent({ requestedPercent: 75, approvedPercent: null, status: 'pending' }),
    ).toBe(75);
    expect(
      defaultApprovedAssistancePercent({ requestedPercent: 75, approvedPercent: 25, status: 'partially_approved' }),
    ).toBe(25);
  });

  test('requires a request id before staff can review', () => {
    expect(
      canReviewFinancialAssistance({ requestId: 12, requestedPercent: 50, approvedPercent: null, status: 'pending' }),
    ).toBe(true);
    expect(canReviewFinancialAssistance(null)).toBe(false);
  });
});
