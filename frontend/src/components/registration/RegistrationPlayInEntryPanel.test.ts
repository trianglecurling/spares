import { describe, expect, test } from 'bun:test';
import {
  playInCommittedMemberConflictMessage,
  playInEntryTeamIsJoinable,
  playInJoinExistingTeamConfirmMessage,
  playInJoinableTeamRosterUpdate,
} from './RegistrationPlayInEntryPanel';

const incompleteTeam = {
  members: [
    { memberId: 21, memberName: 'Alice Skip', pendingName: null },
    { memberId: 22, memberName: 'Bob Vice', pendingName: null },
    { memberId: 23, memberName: 'Carol Second', pendingName: null },
  ],
};

describe('play-in committed teammate copy', () => {
  test('full-team conflict names the member and lists the roster', () => {
    expect(playInCommittedMemberConflictMessage({ memberName: 'Alice Skip', team: incompleteTeam })).toBe(
      'Alice Skip is already on a different team for this league.\n\nTeam roster:\nAlice Skip\nBob Vice\nCarol Second',
    );
  });

  test('join confirm asks to join and lists the roster', () => {
    expect(playInJoinExistingTeamConfirmMessage({ memberName: 'Alice Skip', team: incompleteTeam })).toBe(
      'Alice Skip is already on a team. Would you like to join this team?\n\nTeam roster:\nAlice Skip\nBob Vice\nCarol Second',
    );
  });

  test('a three-person teams roster is joinable and a full roster is not', () => {
    expect(playInEntryTeamIsJoinable(incompleteTeam, 4)).toBe(true);
    expect(playInEntryTeamIsJoinable({ members: [...incompleteTeam.members, { memberId: 24 }] }, 4)).toBe(false);
    expect(playInEntryTeamIsJoinable(incompleteTeam, 3)).toBe(false);
    expect(playInEntryTeamIsJoinable(null, 4)).toBe(false);
  });

  test('joining fills the other players and pending names onto the roster', () => {
    expect(
      playInJoinableTeamRosterUpdate({
        team: {
          members: [
            { memberId: 21, pendingName: null },
            { memberId: 22, pendingName: null },
            { memberId: null, pendingName: 'Dana Pending' },
          ],
        },
        registeringMemberId: 30,
      }),
    ).toEqual({
      teamRosterPlacements: [{ memberId: 21 }, { memberId: 22 }],
      byotTeammateText: 'Dana Pending',
    });
  });
});
