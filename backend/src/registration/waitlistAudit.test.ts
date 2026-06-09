import { describe, expect, test } from 'bun:test';
import { formatWaitlistAuditSummary } from './waitlistAudit.js';

describe('waitlist audit summaries', () => {
  test('entry_removed includes member name and queue position', () => {
    expect(
      formatWaitlistAuditSummary({
        action: 'entry_removed',
        memberName: 'John Smith',
        position: 14,
        queueTotal: 16,
      })
    ).toBe('John Smith (position #14 of 16) removed from waitlist');
  });

  test('offer_sent includes offer type and member name', () => {
    expect(
      formatWaitlistAuditSummary({
        action: 'offer_sent',
        memberName: 'Jane Doe',
        offerType: 'permanent',
      })
    ).toBe('permanent waitlist offer sent to Jane Doe');
  });

  test('entry_created includes team roster members when provided', () => {
    expect(
      formatWaitlistAuditSummary({
        action: 'entry_created',
        memberName: 'John Smith',
        position: 2,
        queueTotal: 5,
        teamRosterText: 'John Smith\nJane Doe\nBob Jones\nSue Lee',
      })
    ).toBe(
      'John Smith (position #2 of 5) added to waitlist · Team: John Smith, Jane Doe, Bob Jones, Sue Lee'
    );
  });
});
