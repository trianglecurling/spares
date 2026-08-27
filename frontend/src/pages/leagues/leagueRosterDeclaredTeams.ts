export type LeagueDeclaredTeamMember = {
  memberId: number | null;
  memberName: string | null;
  pendingName: string | null;
  onLeagueRoster: boolean;
};

export type LeagueDeclaredTeam = {
  id: number;
  createdByMemberId: number;
  createdByName: string | null;
  members: LeagueDeclaredTeamMember[];
};

export function declaredTeamMemberLabel(member: LeagueDeclaredTeamMember): string {
  return member.memberName?.trim() || member.pendingName?.trim() || 'Teammate';
}

/** Roster members who are not already shown on a declared team card. */
export function rosterMembersNotOnDeclaredTeams<T extends { memberId: number }>(
  rosterMembers: T[],
  declaredTeams: LeagueDeclaredTeam[],
): T[] {
  const groupedIds = new Set<number>();
  for (const team of declaredTeams) {
    for (const member of team.members) {
      if (member.memberId != null && member.onLeagueRoster) groupedIds.add(member.memberId);
    }
  }
  return rosterMembers.filter((member) => !groupedIds.has(member.memberId));
}
