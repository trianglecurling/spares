import { describe, expect, test } from 'bun:test';
import { waitlistsInDisplayOrder } from './waitlistStaffPriorityDetails.js';

describe('waitlistsInDisplayOrder', () => {
  test('orders by stored rank and assigns display ranks 1..n', () => {
    expect(
      waitlistsInDisplayOrder([
        { id: 2, waitlistId: 20, waitlistName: 'Thursday', priorityRank: 2, joinedAt: '2026-01-02T00:00:00Z' },
        { id: 1, waitlistId: 10, waitlistName: 'Monday', priorityRank: 1, joinedAt: '2026-01-03T00:00:00Z' },
        { id: 3, waitlistId: 30, waitlistName: 'Wednesday', priorityRank: null, joinedAt: '2026-01-01T00:00:00Z' },
      ]),
    ).toEqual([
      { waitlistId: 10, waitlistName: 'Monday', priorityRank: 1 },
      { waitlistId: 20, waitlistName: 'Thursday', priorityRank: 2 },
      { waitlistId: 30, waitlistName: 'Wednesday', priorityRank: 3 },
    ]);
  });
});
