import { describe, expect, test } from 'bun:test';
import {
  buildTeamRosterText,
  countHybridRoster,
  derivePrimaryEntryFields,
  parseTeamRosterPlacements,
  serializeTeamRosterPlacements,
} from './waitlistTeamRoster.js';

describe('waitlistTeamRoster', () => {
  test('serializes and parses team roster placements', () => {
    const placements = [
      { memberId: 2, entryType: 'add' as const, replacesLeagueId: null },
      { memberId: 5, entryType: 'replace' as const, replacesLeagueId: 12 },
    ];
    const parsed = parseTeamRosterPlacements(serializeTeamRosterPlacements(placements));
    expect(parsed).toEqual(placements);
  });

  test('derives primary entry fields from placements', () => {
    const fields = derivePrimaryEntryFields(5, [
      { memberId: 2, entryType: 'add', replacesLeagueId: null },
      { memberId: 5, entryType: 'replace', replacesLeagueId: 12 },
    ]);
    expect(fields).toEqual({ entryType: 'replace', replacesLeagueId: 12 });
  });

  test('builds roster text sorted by first name', () => {
    expect(buildTeamRosterText(['Zoe Alpha', 'Amy Beta'])).toBe('Amy Beta\nZoe Alpha');
  });

  test('counts hybrid rosters from member placements and pending names', () => {
    expect(
      countHybridRoster({
        placements: [
          { memberId: 1, entryType: 'add', replacesLeagueId: null },
          { memberId: 2, entryType: 'add', replacesLeagueId: null },
        ],
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
        expectedSize: 4,
      }),
    ).toEqual({ memberCount: 1, pendingCount: 3, total: 4 });

    expect(
      countHybridRoster({
        pendingRosterText: 'A, B, C, D',
        expectedSize: 4,
      }),
    ).toEqual({ memberCount: 4, pendingCount: 0, total: 4 });
  });
});
