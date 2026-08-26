import { describe, expect, test } from 'bun:test';
import { groupWaitlistJoinedRecipients } from './waitlistJoinedNotificationService.js';

describe('waitlist joined notification grouping', () => {
  test('sends one recipient one list of every waitlist they were added to', () => {
    const grouped = groupWaitlistJoinedRecipients([
      { entryId: 10, rosterMemberIds: [1] },
      { entryId: 20, rosterMemberIds: [1, 2] },
      { entryId: 30, rosterMemberIds: [1, 3] },
    ]);

    expect(grouped.get(1)).toEqual([10, 20, 30]);
    expect(grouped.get(2)).toEqual([20]);
    expect(grouped.get(3)).toEqual([30]);
  });
});
