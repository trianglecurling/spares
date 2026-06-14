import { describe, expect, test } from 'bun:test';
import { isLeagueEligibleForSpares } from './leagueSpareEligibility.js';

describe('isLeagueEligibleForSpares', () => {
  test('allows standard team leagues', () => {
    expect(isLeagueEligibleForSpares({ format: 'teams', allows_drop_ins: 0 })).toBe(true);
  });

  test('rejects instructional leagues', () => {
    expect(isLeagueEligibleForSpares({ format: 'instructional', allows_drop_ins: 0 })).toBe(false);
  });

  test('rejects drop-in leagues', () => {
    expect(isLeagueEligibleForSpares({ format: 'teams', allows_drop_ins: 1 })).toBe(false);
    expect(isLeagueEligibleForSpares({ format: 'teams', allowsDropIns: true })).toBe(false);
  });
});
