import { describe, expect, test } from 'bun:test';
import { orderMemberWaitlistPreference } from './memberWaitlistOrder.js';

describe('orderMemberWaitlistPreference', () => {
  test('orders by priority rank, then join time', () => {
    const ordered = orderMemberWaitlistPreference(
      [
        { id: 1, waitlistId: 10, priorityRank: 3, joinedAt: '2026-01-01' },
        { id: 2, waitlistId: 20, priorityRank: null, joinedAt: '2026-01-01' },
        { id: 3, waitlistId: 30, priorityRank: 1, joinedAt: '2026-02-01' },
        { id: 4, waitlistId: 40, priorityRank: 1, joinedAt: '2026-01-15' },
      ],
      new Set(),
    );
    expect(ordered.map((entry) => entry.waitlistId)).toEqual([40, 30, 10, 20]);
  });

  test('puts team waitlists above individual waitlists', () => {
    const ordered = orderMemberWaitlistPreference(
      [
        { id: 1, waitlistId: 10, priorityRank: 1, joinedAt: '2026-01-01' },
        { id: 2, waitlistId: 20, priorityRank: 4, joinedAt: '2026-01-01' },
      ],
      new Set([20]),
    );
    expect(ordered.map((entry) => entry.waitlistId)).toEqual([20, 10]);
  });
});
