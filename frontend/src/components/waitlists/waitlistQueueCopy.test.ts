import { describe, expect, test } from 'bun:test';
import { nextFrozenCountAfterMove } from './waitlistQueueCopy';

describe('nextFrozenCountAfterMove', () => {
  test('dragging an unfrozen row into the frozen prefix increases N', () => {
    expect(
      nextFrozenCountAfterMove({ frozenCount: 2, activeIndex: 4, overIndex: 1, total: 6 }),
    ).toBe(3);
  });

  test('dragging a frozen row into the unfrozen remainder decreases N', () => {
    expect(
      nextFrozenCountAfterMove({ frozenCount: 3, activeIndex: 1, overIndex: 4, total: 6 }),
    ).toBe(2);
  });

  test('reordering inside the frozen prefix leaves N unchanged', () => {
    expect(
      nextFrozenCountAfterMove({ frozenCount: 3, activeIndex: 0, overIndex: 2, total: 6 }),
    ).toBe(3);
  });
});
