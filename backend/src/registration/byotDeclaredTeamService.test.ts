import { describe, expect, test } from 'bun:test';
import {
  applyExistingByotTeamRosterIfEmpty,
  dedupeByotTeams,
  registrantWasAddedToByotTeam,
  rosterFromDeclaredTeamMembers,
  type ByotDeclaredTeam,
  type ByotDeclaredTeamSummary,
} from './byotDeclaredTeamService.js';

function doublesSummary(overrides: Partial<ByotDeclaredTeamSummary> = {}): ByotDeclaredTeamSummary {
  return {
    leagueId: 4,
    teamSize: 2,
    onExistingTeam: true,
    existingTeam: {
      id: 11,
      name: null,
      createdByName: 'Alice Skip',
      members: [
        { memberId: 21, memberName: 'Alice Skip', pendingName: null },
        { memberId: 100, memberName: 'Bob Vice', pendingName: null },
      ],
    },
    committedOtherMemberIds: [],
    committedOtherMemberTeams: [],
    ...overrides,
  };
}

describe('registrantWasAddedToByotTeam', () => {
  test('is true when another registrant listed this member', () => {
    expect(registrantWasAddedToByotTeam(100, { createdByMemberId: 21, memberIds: [21, 100] })).toBe(true);
  });

  test('is false for the member who declared the team', () => {
    expect(registrantWasAddedToByotTeam(21, { createdByMemberId: 21, memberIds: [21, 100] })).toBe(false);
  });

  test('is false when this member is not on the roster', () => {
    expect(registrantWasAddedToByotTeam(30, { createdByMemberId: 21, memberIds: [21, 100] })).toBe(false);
  });
});

describe('applyExistingByotTeamRosterIfEmpty', () => {
  test('fills an empty roster from the declared team, omitting the registering member', () => {
    expect(
      applyExistingByotTeamRosterIfEmpty(
        [{ leagueId: 4, priorityRank: 1 }],
        { 4: doublesSummary() },
        100,
      ),
    ).toEqual([
      {
        leagueId: 4,
        priorityRank: 1,
        teamRosterPlacements: [{ memberId: 21 }],
        byotTeammateText: null,
      },
    ]);
  });

  test('does not overwrite a roster the registrant already declared', () => {
    const saved = [{ leagueId: 4, priorityRank: 1, teamRosterPlacements: [{ memberId: 30 }] }];
    expect(applyExistingByotTeamRosterIfEmpty(saved, { 4: doublesSummary() }, 100)).toEqual(saved);
  });

  test('replaces a free-text partner name with the existing team member ids', () => {
    expect(
      applyExistingByotTeamRosterIfEmpty(
        [{ leagueId: 4, priorityRank: 1, teamRosterPlacements: [], byotTeammateText: 'Alice Skip' }],
        { 4: doublesSummary() },
        100,
      ),
    ).toEqual([
      {
        leagueId: 4,
        priorityRank: 1,
        teamRosterPlacements: [{ memberId: 21 }],
        byotTeammateText: null,
      },
    ]);
  });

  test('copies pending teammate names when the listed partner has no member id', () => {
    expect(
      rosterFromDeclaredTeamMembers(
        [
          { memberId: 21, pendingName: null },
          { memberId: null, pendingName: 'Dana Pending' },
        ],
        100,
      ),
    ).toEqual({
      teamRosterPlacements: [{ memberId: 21 }],
      byotTeammateText: 'Dana Pending',
    });
  });
});

describe('dedupeByotTeams', () => {
  const aliceBob: ByotDeclaredTeam = {
    id: 1,
    createdByMemberId: 21,
    createdByName: 'Alice Skip',
    members: [
      { memberId: 21, memberName: 'Alice Skip', pendingName: null },
      { memberId: 100, memberName: 'Bob Vice', pendingName: null },
    ],
  };
  const bobAlice: ByotDeclaredTeam = {
    id: 2,
    createdByMemberId: 100,
    createdByName: 'Bob Vice',
    members: [
      { memberId: 100, memberName: 'Bob Vice', pendingName: null },
      { memberId: 21, memberName: 'Alice Skip', pendingName: null },
    ],
  };

  test('keeps one card when both partners declared the same pair', () => {
    expect(dedupeByotTeams([aliceBob, bobAlice])).toEqual([aliceBob]);
  });

  test('keeps distinct pairs', () => {
    const other: ByotDeclaredTeam = {
      id: 3,
      createdByMemberId: 30,
      createdByName: 'Carol Third',
      members: [
        { memberId: 30, memberName: 'Carol Third', pendingName: null },
        { memberId: null, memberName: null, pendingName: 'Dana Pending' },
      ],
    };
    expect(dedupeByotTeams([aliceBob, other])).toEqual([aliceBob, other]);
  });
});
