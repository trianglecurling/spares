import { describe, expect, test } from 'bun:test';
import {
  DRAFT_REGISTRATION_STATUSES,
  SUBMITTED_CURLER_REGISTRATION_STATUSES,
  hasBlockingInProgressDraft,
  isDraftRegistrationStatus,
  isSubmittedCurlerRegistrationStatus,
  pickMostRecentInProgressDraft,
} from './registrationDraftProgress.js';

describe('registration draft progress', () => {
  test('draft and submitted status sets do not overlap', () => {
    for (const status of DRAFT_REGISTRATION_STATUSES) {
      expect(isSubmittedCurlerRegistrationStatus(status)).toBe(false);
    }
    for (const status of SUBMITTED_CURLER_REGISTRATION_STATUSES) {
      expect(isDraftRegistrationStatus(status)).toBe(false);
    }
  });

  test('pickMostRecentInProgressDraft returns the newest draft only', () => {
    const picked = pickMostRecentInProgressDraft([
      { id: 1, status: 'shell_complete', updated_at: '2026-01-02T00:00:00Z' },
      { id: 2, status: 'awaiting_payment', updated_at: '2026-01-03T00:00:00Z' },
      { id: 3, status: 'identity_incomplete', updated_at: '2026-01-04T00:00:00Z' },
      { id: 4, status: 'policies_incomplete', updated_at: '2026-01-05T00:00:00Z' },
    ]);

    expect(picked?.id).toBe(4);
  });

  test('pickMostRecentInProgressDraft ignores submitted registrations even when they are newer', () => {
    const picked = pickMostRecentInProgressDraft([
      { id: 10, status: 'confirmed', updated_at: '2026-06-01T00:00:00Z' },
      { id: 11, status: 'demographics_incomplete', updated_at: '2026-01-01T00:00:00Z' },
    ]);

    expect(picked?.id).toBe(11);
  });

  test('pickMostRecentInProgressDraft returns null when no draft exists', () => {
    expect(
      pickMostRecentInProgressDraft([
        { id: 20, status: 'paid', updated_at: '2026-06-01T00:00:00Z' },
        { id: 21, status: 'cancelled', updated_at: '2026-06-02T00:00:00Z' },
      ]),
    ).toBeNull();
  });

  test('hasBlockingInProgressDraft reflects whether a new draft may be created', () => {
    expect(hasBlockingInProgressDraft(null)).toBe(false);
    expect(hasBlockingInProgressDraft(undefined)).toBe(false);
    expect(hasBlockingInProgressDraft({ id: 1, status: 'shell_complete' })).toBe(true);
  });
});
