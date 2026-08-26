import { describe, expect, test } from 'bun:test';
import {
  buildTeamRosterText,
  countHybridRoster,
  includePrimaryMemberOnWaitlistRoster,
  parseTeamRosterPlacements,
  serializeTeamRosterPlacements,
  waitlistEntryRosterMemberIds,
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

    // Registration stores teammates only; the registrant is an implicit roster spot.
    expect(
      countHybridRoster({
        placements: [{ memberId: 21 }],
        primaryMemberId: 20,
      }),
    ).toEqual({ memberCount: 2, pendingCount: 0, total: 2 });
  });

  test('adds the primary member when registration stored teammates only', () => {
    expect(includePrimaryMemberOnWaitlistRoster([{ memberId: 21 }], 20)).toEqual([
      { memberId: 20 },
      { memberId: 21 },
    ]);
  });

  test('leaves a roster that already includes the primary member unchanged', () => {
    const placements = [{ memberId: 20 }, { memberId: 21 }];
    expect(includePrimaryMemberOnWaitlistRoster(placements, 20)).toEqual(placements);
  });

  test('adds the primary member to a pending-name-only roster', () => {
    expect(includePrimaryMemberOnWaitlistRoster([], 20)).toEqual([{ memberId: 20 }]);
  });

  test('resolves every roster member id for a waitlist entry', () => {
    expect(
      waitlistEntryRosterMemberIds({
        memberId: 20,
        teamRosterPlacements: JSON.stringify([{ memberId: 21 }]),
      }),
    ).toEqual([20, 21]);
    expect(waitlistEntryRosterMemberIds({ member_id: 20, team_roster_placements: null })).toEqual([20]);
  });
});
