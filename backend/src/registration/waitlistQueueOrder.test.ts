import { describe, expect, test } from 'bun:test';
import {
  clampFrozenEntryCount,
  compactWaitlistPositionSortKey,
  compareUnfrozenWaitlistEntries,
  lifetimeInsertIndex,
  nextFrozenEntryCountAfterRemoval,
  sortWaitlistQueue,
  stableWaitlistTieBreak,
  type WaitlistQueueOrderEntry,
} from './waitlistQueueOrder.js';

function entry(
  overrides: Partial<WaitlistQueueOrderEntry> & Pick<WaitlistQueueOrderEntry, 'id'>,
): WaitlistQueueOrderEntry {
  return {
    positionSortKey: compactWaitlistPositionSortKey(overrides.id - 1, overrides.id),
    joinedAtMs: overrides.id * 1000,
    isLifetimeMember: false,
    clubTenureYears: 0,
    tieBreakerYears: 0,
    ...overrides,
  };
}

describe('waitlistQueueOrder', () => {
  test('unfrozen entries sort by tenure, then tie-breaker, then a stable hash', () => {
    const lowTenure = entry({ id: 1, clubTenureYears: 1, tieBreakerYears: 10 });
    const highTenure = entry({ id: 2, clubTenureYears: 4, tieBreakerYears: 0 });
    const tiedTenureHighOther = entry({ id: 3, clubTenureYears: 2, tieBreakerYears: 8 });
    const tiedTenureLowOther = entry({ id: 4, clubTenureYears: 2, tieBreakerYears: 1 });
    const sorted = [lowTenure, highTenure, tiedTenureHighOther, tiedTenureLowOther].sort(
      compareUnfrozenWaitlistEntries,
    );
    expect(sorted.map((row) => row.id)).toEqual([2, 3, 4, 1]);
  });

  test('stable tie-break does not reshuffle the same ids', () => {
    const left = entry({ id: 11, clubTenureYears: 3, tieBreakerYears: 1 });
    const right = entry({ id: 17, clubTenureYears: 3, tieBreakerYears: 1 });
    const first = [left, right].sort(compareUnfrozenWaitlistEntries).map((row) => row.id);
    const second = [right, left].sort(compareUnfrozenWaitlistEntries).map((row) => row.id);
    expect(first).toEqual(second);
    expect(stableWaitlistTieBreak(11)).toBe(stableWaitlistTieBreak(11));
  });

  test('frozen prefix keeps stored order while the remainder is live-sorted', () => {
    const frozenA = entry({ id: 1, positionSortKey: '000001:1', clubTenureYears: 0 });
    const frozenB = entry({ id: 2, positionSortKey: '000002:2', clubTenureYears: 20 });
    const unfrozenLow = entry({ id: 3, positionSortKey: '000003:3', clubTenureYears: 1 });
    const unfrozenHigh = entry({ id: 4, positionSortKey: '000004:4', clubTenureYears: 8 });
    const sorted = sortWaitlistQueue([unfrozenLow, frozenB, unfrozenHigh, frozenA], 2);
    expect(sorted.map((row) => row.id)).toEqual([1, 2, 4, 3]);
  });

  test('zero frozen rows live-sorts the whole waitlist', () => {
    const sorted = sortWaitlistQueue(
      [
        entry({ id: 1, clubTenureYears: 1 }),
        entry({ id: 2, clubTenureYears: 5 }),
        entry({ id: 3, clubTenureYears: 3 }),
      ],
      0,
    );
    expect(sorted.map((row) => row.id)).toEqual([2, 3, 1]);
  });

  test('lifetime insert index is after the last frozen lifetime member, or 0', () => {
    expect(lifetimeInsertIndex([])).toBe(0);
    expect(lifetimeInsertIndex([{ isLifetimeMember: false }, { isLifetimeMember: false }])).toBe(0);
    expect(
      lifetimeInsertIndex([
        { isLifetimeMember: false },
        { isLifetimeMember: true },
        { isLifetimeMember: true },
        { isLifetimeMember: false },
      ]),
    ).toBe(3);
    // Staff may park a non-lifetime member above lifetime members; a new lifetime join still
    // goes after the last frozen lifetime member, not to the top of the prefix.
    expect(lifetimeInsertIndex([{ isLifetimeMember: false }, { isLifetimeMember: true }])).toBe(2);
  });

  test('removing a frozen row decrements N; removing an unfrozen row does not', () => {
    expect(nextFrozenEntryCountAfterRemoval(4, 0)).toBe(3);
    expect(nextFrozenEntryCountAfterRemoval(4, 3)).toBe(3);
    expect(nextFrozenEntryCountAfterRemoval(4, 4)).toBe(4);
    expect(nextFrozenEntryCountAfterRemoval(4, null)).toBe(4);
    expect(clampFrozenEntryCount(9, 4)).toBe(4);
    expect(clampFrozenEntryCount(-1, 4)).toBe(0);
  });
});
