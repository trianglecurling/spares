import { describe, expect, test } from 'bun:test';
import { financialAssistanceReviewDecision } from './registrationStaffCommunicationService.js';

describe('financialAssistanceReviewDecision', () => {
  test('denies a zero percent decision', () => {
    expect(financialAssistanceReviewDecision(50, 0)).toEqual({ status: 'denied', approvedPercentage: 0 });
  });

  test('approves the requested percent', () => {
    expect(financialAssistanceReviewDecision(75, 75)).toEqual({ status: 'approved', approvedPercentage: 75 });
  });

  test('marks a different positive percent as partially approved', () => {
    expect(financialAssistanceReviewDecision(75, 50)).toEqual({
      status: 'partially_approved',
      approvedPercentage: 50,
    });
  });
});
