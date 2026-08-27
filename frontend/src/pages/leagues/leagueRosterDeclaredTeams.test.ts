import { describe, expect, test } from 'bun:test';
import {
  declaredTeamMemberLabel,
  rosterMembersNotOnDeclaredTeams,
  type LeagueDeclaredTeam,
} from './leagueRosterDeclaredTeams';

const pair: LeagueDeclaredTeam = {
  id: 11,
  createdByMemberId: 21,
  createdByName: 'Alice Skip',
  members: [
    { memberId: 21, memberName: 'Alice Skip', pendingName: null, onLeagueRoster: true },
    { memberId: 100, memberName: 'Bob Vice', pendingName: null, onLeagueRoster: true },
  ],
};

const pendingPartner: LeagueDeclaredTeam = {
  id: 12,
  createdByMemberId: 30,
  createdByName: 'Carol Third',
  members: [
    { memberId: 30, memberName: 'Carol Third', pendingName: null, onLeagueRoster: true },
    { memberId: null, memberName: null, pendingName: 'Dana Pending', onLeagueRoster: false },
  ],
};

describe('league roster declared teams', () => {
  test('uses the member name, then a pending name', () => {
    expect(declaredTeamMemberLabel(pair.members[0]!)).toBe('Alice Skip');
    expect(declaredTeamMemberLabel(pendingPartner.members[1]!)).toBe('Dana Pending');
  });

  test('omits roster members who already appear on a declared team', () => {
    const roster = [
      { memberId: 21, name: 'Alice Skip' },
      { memberId: 100, name: 'Bob Vice' },
      { memberId: 40, name: 'Staff Added' },
    ];
    expect(rosterMembersNotOnDeclaredTeams(roster, [pair, pendingPartner])).toEqual([
      { memberId: 40, name: 'Staff Added' },
    ]);
  });

  test('pending teammates are not treated as roster rows to omit', () => {
    const roster = [{ memberId: 30, name: 'Carol Third' }];
    expect(rosterMembersNotOnDeclaredTeams(roster, [pendingPartner])).toEqual([]);
  });
});
