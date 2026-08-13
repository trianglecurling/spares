import { describe, expect, test } from 'bun:test';
import { compareVolunteerProgramsForDiscovery } from './volunteerProgramSort.js';

describe('compareVolunteerProgramsForDiscovery', () => {
  test('sorts lower priority numbers first', () => {
    const a = { priority: 2, nextShiftStart: '2026-09-01T12:00:00.000Z', title: 'B' };
    const b = { priority: 1, nextShiftStart: '2026-10-01T12:00:00.000Z', title: 'A' };
    expect(compareVolunteerProgramsForDiscovery(a, b)).toBeGreaterThan(0);
    expect(compareVolunteerProgramsForDiscovery(b, a)).toBeLessThan(0);
  });

  test('treats missing priority as infinite (after numbered programs)', () => {
    const numbered = { priority: 10, nextShiftStart: '2026-12-01T12:00:00.000Z', title: 'Late' };
    const none = { priority: null, nextShiftStart: '2026-08-01T12:00:00.000Z', title: 'Soon' };
    expect(compareVolunteerProgramsForDiscovery(numbered, none)).toBeLessThan(0);
    expect(compareVolunteerProgramsForDiscovery(none, numbered)).toBeGreaterThan(0);
  });

  test('uses next shift start when priority matches', () => {
    const earlier = { priority: 1, nextShiftStart: '2026-09-01T09:00:00.000Z', title: 'Zed' };
    const later = { priority: 1, nextShiftStart: '2026-09-02T09:00:00.000Z', title: 'Abe' };
    expect(compareVolunteerProgramsForDiscovery(earlier, later)).toBeLessThan(0);
  });

  test('programs with a next shift sort before those without when priority matches', () => {
    const withShift = { priority: null, nextShiftStart: '2026-09-01T09:00:00.000Z', title: 'Has shift' };
    const without = { priority: null, nextShiftStart: null, title: 'No shift' };
    expect(compareVolunteerProgramsForDiscovery(withShift, without)).toBeLessThan(0);
  });

  test('falls back to title when priority and next shift match', () => {
    const a = { priority: 1, nextShiftStart: '2026-09-01T09:00:00.000Z', title: 'Alpha' };
    const b = { priority: 1, nextShiftStart: '2026-09-01T09:00:00.000Z', title: 'Beta' };
    expect(compareVolunteerProgramsForDiscovery(a, b)).toBeLessThan(0);
  });
});
