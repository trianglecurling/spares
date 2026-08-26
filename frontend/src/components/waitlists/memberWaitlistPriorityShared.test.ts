import { describe, expect, test } from 'bun:test';
import {
  canReorderWaitlistPreferenceDrop,
  clampWaitlistPreferenceOrder,
  insertWaitlistInPreferenceOrder,
  summarizeMemberWaitlistChanges,
} from './memberWaitlistPriorityShared';

function entry(waitlistId: number, waitlistName: string, requiresByotRoster = false) {
  return { waitlistId, waitlistName, requiresByotRoster };
}

describe('summarizeMemberWaitlistChanges', () => {
  test('reports no changes when the list is unchanged', () => {
    const summary = summarizeMemberWaitlistChanges(
      [entry(1, 'Monday'), entry(2, 'Tuesday')],
      [entry(1, 'Monday'), entry(2, 'Tuesday')],
    );
    expect(summary.hasChanges).toBe(false);
    expect(summary.reordered).toBe(false);
  });

  test('summarizes joins, leaves, and the resulting order', () => {
    const summary = summarizeMemberWaitlistChanges(
      [entry(1, 'Monday'), entry(2, 'Tuesday')],
      [entry(3, 'Wednesday'), entry(1, 'Monday')],
    );
    expect(summary.hasChanges).toBe(true);
    expect(summary.joined.map((item) => item.waitlistName)).toEqual(['Wednesday']);
    expect(summary.left.map((item) => item.waitlistName)).toEqual(['Tuesday']);
    expect(summary.reordered).toBe(false);
    expect(summary.message).toContain('Join:');
    expect(summary.message).toContain('- Wednesday');
    expect(summary.message).toContain('Leave (you will lose your queue position):');
    expect(summary.message).toContain('- Tuesday');
    expect(summary.message).toContain('1. Wednesday');
    expect(summary.message).toContain('2. Monday');
  });

  test('explains that leaving a team waitlist removes the whole roster', () => {
    const summary = summarizeMemberWaitlistChanges(
      [entry(1, 'Doubles', true), entry(2, 'Monday')],
      [entry(2, 'Monday')],
    );
    expect(summary.message).toContain(
      'Leave (team waitlists remove the whole roster and email everyone):',
    );
    expect(summary.message).toContain('- Doubles');
  });

  test('detects a reorder of existing waitlists', () => {
    const summary = summarizeMemberWaitlistChanges(
      [entry(1, 'Monday'), entry(2, 'Tuesday')],
      [entry(2, 'Tuesday'), entry(1, 'Monday')],
    );
    expect(summary.reordered).toBe(true);
    expect(summary.joined).toEqual([]);
    expect(summary.left).toEqual([]);
    expect(summary.message).toContain('Your waitlist preference will be:');
    expect(summary.message).toContain('1. Tuesday');
    expect(summary.message).toContain('2. Monday');
  });
});

describe('waitlist preference order', () => {
  test('keeps team waitlists above individual waitlists', () => {
    expect(
      clampWaitlistPreferenceOrder([
        entry(1, 'Monday', false),
        entry(2, 'Doubles', true),
      ]).map((row) => row.waitlistId),
    ).toEqual([2, 1]);
  });

  test('blocks drag across the team / individual boundary', () => {
    expect(canReorderWaitlistPreferenceDrop(entry(1, 'Doubles', true), entry(2, 'Monday', false))).toBe(
      false,
    );
    expect(canReorderWaitlistPreferenceDrop(entry(1, 'Doubles', true), entry(2, 'Mixed', true))).toBe(true);
  });

  test('inserts a team waitlist after existing team waitlists', () => {
    expect(
      insertWaitlistInPreferenceOrder(
        [entry(1, 'Doubles', true), entry(2, 'Monday', false)],
        entry(3, 'Teams', true),
      ).map((row) => row.waitlistId),
    ).toEqual([1, 3, 2]);
  });
});
