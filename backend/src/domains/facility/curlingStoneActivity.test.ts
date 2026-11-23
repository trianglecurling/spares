import { describe, expect, it } from 'bun:test';
import {
  buildCurlingStoneActivity,
  oneYearBefore,
  type ActivityMaintenanceInput,
  type ActivityPlacementInput,
} from './curlingStoneActivity.js';

const wcfByStoneId = new Map([
  [1, '101'],
  [2, '102'],
  [3, '103'],
]);

function placement(overrides: Partial<ActivityPlacementInput> & Pick<ActivityPlacementInput, 'id' | 'stoneId'>) {
  return {
    sheet: 'A',
    color: 'red',
    rockNumber: 1,
    side: 'A',
    effectiveDate: '2026-01-01',
    changeType: 'added',
    relatedStoneId: null,
    notes: null,
    createdAt: '2026-01-01T10:00:00.000Z',
    ...overrides,
  } satisfies ActivityPlacementInput;
}

function maintenance(overrides: Partial<ActivityMaintenanceInput> & Pick<ActivityMaintenanceInput, 'id' | 'stoneId'>) {
  return {
    activityType: 'texturing',
    side: 'A',
    performedOn: '2026-03-01',
    passes: 2,
    rotations: null,
    sandpaperGrit: 80,
    sandpaperCondition: 'new',
    bandWidthsMm: [],
    comments: null,
    createdAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  } satisfies ActivityMaintenanceInput;
}

describe('buildCurlingStoneActivity', () => {
  it('groups a rotation into one entry with each stone’s prior position', () => {
    const entries = buildCurlingStoneActivity({
      since: '2026-02-01',
      wcfByStoneId,
      placements: [
        placement({ id: 1, stoneId: 1 }),
        placement({ id: 2, stoneId: 2, sheet: 'D', rockNumber: 2 }),
        placement({ id: 3, stoneId: 1, sheet: 'B', effectiveDate: '2026-02-10', changeType: 'rotated', createdAt: 't2' }),
        placement({
          id: 4,
          stoneId: 2,
          sheet: 'A',
          rockNumber: 2,
          effectiveDate: '2026-02-10',
          changeType: 'rotated',
          createdAt: 't2',
        }),
      ],
      maintenance: [],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('rotated');
    expect(entries[0].stones.map((stone) => [stone.wcfRegistrationNumber, stone.from?.sheet, stone.to?.sheet])).toEqual([
      ['101', 'A', 'B'],
      ['102', 'D', 'A'],
    ]);
  });

  it('pairs both sides of a swap and keeps separate moves apart', () => {
    const entries = buildCurlingStoneActivity({
      since: '2026-01-01',
      wcfByStoneId,
      placements: [
        placement({ id: 1, stoneId: 1, effectiveDate: '2025-06-01' }),
        placement({ id: 2, stoneId: 2, color: null, sheet: null, rockNumber: null, effectiveDate: '2025-06-01' }),
        placement({ id: 3, stoneId: 2, effectiveDate: '2026-02-01', changeType: 'swapped', relatedStoneId: 1, createdAt: 't' }),
        placement({
          id: 4,
          stoneId: 1,
          sheet: null,
          rockNumber: null,
          effectiveDate: '2026-02-01',
          changeType: 'swapped',
          relatedStoneId: 2,
          createdAt: 't',
        }),
        placement({ id: 5, stoneId: 3, effectiveDate: '2026-02-01', changeType: 'moved', createdAt: 't' }),
      ],
      maintenance: [],
    });

    expect(entries.map((entry) => [entry.kind, entry.stones.length])).toEqual([
      ['moved', 1],
      ['swapped', 2],
    ]);
  });

  it('groups batch maintenance with matching details and filters to the window', () => {
    const entries = buildCurlingStoneActivity({
      since: '2026-02-01',
      wcfByStoneId,
      placements: [],
      maintenance: [
        maintenance({ id: 1, stoneId: 1 }),
        maintenance({ id: 2, stoneId: 2 }),
        maintenance({ id: 3, stoneId: 3, sandpaperCondition: 'used_once' }),
        maintenance({ id: 4, stoneId: 3, performedOn: '2026-01-15' }),
        maintenance({ id: 5, stoneId: 1, activityType: 'imprinting', passes: null, sandpaperGrit: null }),
        maintenance({ id: 6, stoneId: 2, activityType: 'imprinting', passes: null, sandpaperGrit: null }),
      ],
    });

    expect(entries.map((entry) => [entry.activityType, entry.stones.length])).toEqual([
      ['imprinting', 1],
      ['imprinting', 1],
      ['texturing', 1],
      ['texturing', 2],
    ]);
  });
});

describe('oneYearBefore', () => {
  it('handles ordinary dates and leap days', () => {
    expect(oneYearBefore('2026-09-27')).toBe('2025-09-27');
    expect(oneYearBefore('2028-02-29')).toBe('2027-02-28');
  });
});
