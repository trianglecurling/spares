import { describe, expect, test } from 'bun:test';
import {
  buildTeamRosterText,
  countHybridRoster,
  parseTeamRosterPlacements,
  serializeTeamRosterPlacements,
} from './waitlistTeamRoster.js';

describe('waitlistTeamRoster', () => {
  test('serializes and parses team roster placements', () => {
    const placements = [{ memberId: 2 }, { memberId: 5 }];
    const parsed = parseTeamRosterPlacements(serializeTeamRosterPlacements(placements));
    expect(parsed).toEqual(placements);
  });

  test('drops duplicate members when parsing', () => {
    expect(parseTeamRosterPlacements('[{"memberId":2},{"memberId":2},{"memberId":7}]')).toEqual([
      { memberId: 2 },
      { memberId: 7 },
    ]);
  });

  test('builds roster text sorted by first name', () => {
    expect(buildTeamRosterText(['Zoe Alpha', 'Amy Beta'])).toBe('Amy Beta\nZoe Alpha');
  });

  test('counts hybrid rosters from member placements and pending names', () => {
    expect(
      countHybridRoster({
        placements: [{ memberId: 1 }, { memberId: 2 }],
        pendingRosterText: 'Pending One\nPending Two',
      }),
    ).toEqual({ memberCount: 2, pendingCount: 2, total: 4 });

    expect(
      countHybridRoster({
        teamRosterText: 'A, B, C, D',
      }),
    ).toEqual({ memberCount: 4, pendingCount: 0, total: 4 });

    expect(
      countHybridRoster({
        pendingRosterText: 'Amy\nBob\nCara',
        primaryMemberId: 20,
      }),
    ).toEqual({ memberCount: 1, pendingCount: 3, total: 4 });

    expect(
      countHybridRoster({
        pendingRosterText: 'A, B, C, D',
      }),
    ).toEqual({ memberCount: 0, pendingCount: 4, total: 4 });
  });
});
