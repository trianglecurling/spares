import { describe, expect, test } from 'bun:test';
import {
  compactPriorityRanks,
  fillNullPriorityRanks,
  nextTrailingPriorityRank,
  sortMemberWaitlistPriorityEntries,
} from './memberWaitlistPriority.js';

function entry(
  id: number,
  priorityRank: number | null,
  joinedAt = `2026-01-0${id}T00:00:00Z`,
) {
  return { id, priorityRank, joinedAt };
}

describe('member waitlist priority', () => {
  test('sorts by stored rank, then join time, then id', () => {
    const sorted = sortMemberWaitlistPriorityEntries([
      entry(20, 2, '2026-01-02T00:00:00Z'),
      entry(10, 1, '2026-01-03T00:00:00Z'),
      entry(30, null, '2026-01-01T00:00:00Z'),
    ]);
    expect(sorted.map((row) => row.id)).toEqual([10, 20, 30]);
  });

  test('sorts unranked entries by when they joined', () => {
    const sorted = sortMemberWaitlistPriorityEntries([
      entry(2, null, '2026-02-01T00:00:00Z'),
      entry(1, null, '2026-01-01T00:00:00Z'),
    ]);
    expect(sorted.map((row) => row.id)).toEqual([1, 2]);
  });

  test('fills null ranks after existing registration ranks', () => {
    expect(
      fillNullPriorityRanks([
        entry(10, 3),
        entry(11, 5),
        entry(12, null, '2026-01-01T00:00:00Z'),
        entry(13, null, '2026-01-02T00:00:00Z'),
      ]),
    ).toEqual([
      { id: 12, priorityRank: 6 },
      { id: 13, priorityRank: 7 },
    ]);
  });

  test('fills all-null entries as 1..n in join order', () => {
    expect(
      fillNullPriorityRanks([
        entry(20, null, '2026-03-01T00:00:00Z'),
        entry(10, null, '2026-01-01T00:00:00Z'),
      ]),
    ).toEqual([
      { id: 10, priorityRank: 1 },
      { id: 20, priorityRank: 2 },
    ]);
  });

  test('trailing rank is one after the highest stored rank', () => {
    expect(nextTrailingPriorityRank([entry(1, 3), entry(2, 5), entry(3, null)])).toBe(6);
    expect(nextTrailingPriorityRank([])).toBe(1);
  });

  test('compacts an explicit order to 1..n', () => {
    expect(compactPriorityRanks([40, 10, 20])).toEqual([
      { id: 40, priorityRank: 1 },
      { id: 10, priorityRank: 2 },
      { id: 20, priorityRank: 3 },
    ]);
  });
});
