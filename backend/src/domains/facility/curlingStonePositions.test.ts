import { describe, expect, test } from 'bun:test';
import {
  isDateOnly,
  nextRotationSheet,
  stonePositionKey,
  stonePositionLabel,
  stonePositionSortValue,
  validateStonePosition,
} from './curlingStonePositions.js';

describe('validateStonePosition', () => {
  test('accepts sheet positions, spares, and unassigned', () => {
    expect(validateStonePosition({ sheet: 'A', color: 'red', rockNumber: 1 })).toBeNull();
    expect(validateStonePosition({ sheet: 'D', color: 'yellow', rockNumber: 8 })).toBeNull();
    expect(validateStonePosition({ sheet: null, color: 'yellow', rockNumber: null })).toBeNull();
    expect(validateStonePosition({ sheet: null, color: null, rockNumber: null })).toBeNull();
  });

  test('rejects incomplete or impossible positions', () => {
    expect(validateStonePosition({ sheet: 'A', color: null, rockNumber: null })).not.toBeNull();
    expect(validateStonePosition({ sheet: 'A', color: 'red', rockNumber: null })).not.toBeNull();
    expect(validateStonePosition({ sheet: 'A', color: 'red', rockNumber: 9 })).not.toBeNull();
    expect(validateStonePosition({ sheet: null, color: 'red', rockNumber: 3 })).not.toBeNull();
  });
});

describe('stonePositionKey', () => {
  test('gives occupiable positions a unique key and unassigned none', () => {
    expect(stonePositionKey({ sheet: 'B', color: 'red', rockNumber: 4 })).toBe('B:red:4');
    expect(stonePositionKey({ sheet: null, color: 'red', rockNumber: null })).toBe('spare:red');
    expect(stonePositionKey({ sheet: null, color: null, rockNumber: null })).toBeNull();
  });
});

describe('nextRotationSheet', () => {
  test('rotates A to B to C to D and back to A', () => {
    expect(nextRotationSheet('A')).toBe('B');
    expect(nextRotationSheet('B')).toBe('C');
    expect(nextRotationSheet('C')).toBe('D');
    expect(nextRotationSheet('D')).toBe('A');
  });
});

describe('stonePositionSortValue', () => {
  test('orders sheets, then spares, then unassigned', () => {
    const ordered = [
      { sheet: 'A', color: 'red', rockNumber: 1 },
      { sheet: 'A', color: 'red', rockNumber: 8 },
      { sheet: 'A', color: 'yellow', rockNumber: 1 },
      { sheet: 'D', color: 'yellow', rockNumber: 8 },
      { sheet: null, color: 'red', rockNumber: null },
      { sheet: null, color: 'yellow', rockNumber: null },
      { sheet: null, color: null, rockNumber: null },
    ] as const;
    const values = ordered.map((position) => stonePositionSortValue(position));
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });
});

describe('stonePositionLabel', () => {
  test('describes each kind of position', () => {
    expect(stonePositionLabel({ sheet: 'C', color: 'yellow', rockNumber: 5 })).toBe('Sheet C yellow 5');
    expect(stonePositionLabel({ sheet: null, color: 'red', rockNumber: null })).toBe('Red spare');
    expect(stonePositionLabel({ sheet: null, color: null, rockNumber: null })).toBe('Unassigned');
  });
});

describe('isDateOnly', () => {
  test('accepts real calendar dates only', () => {
    expect(isDateOnly('2026-09-27')).toBe(true);
    expect(isDateOnly('2026-02-30')).toBe(false);
    expect(isDateOnly('2026-9-27')).toBe(false);
  });
});
