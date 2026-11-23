import { describe, expect, test } from 'bun:test';
import { sortableItemAtPointer } from './sortablePointerTarget';

const rows = [
  { id: 'a', top: 0, bottom: 40 },
  { id: 'b', top: 48, bottom: 88 },
  { id: 'c', top: 96, bottom: 136 },
];

describe('sortableItemAtPointer', () => {
  test('keeps the pointer on the nearer row while it crosses the gap', () => {
    expect(sortableItemAtPointer(rows, 42)).toBe('a');
    expect(sortableItemAtPointer(rows, 46)).toBe('b');
    expect(sortableItemAtPointer(rows, 90)).toBe('b');
    expect(sortableItemAtPointer(rows, 94)).toBe('c');
  });

  test('stays on the first or last row outside the list', () => {
    expect(sortableItemAtPointer(rows, -20)).toBe('a');
    expect(sortableItemAtPointer(rows, 400)).toBe('c');
    expect(sortableItemAtPointer([], 10)).toBeNull();
  });
});
