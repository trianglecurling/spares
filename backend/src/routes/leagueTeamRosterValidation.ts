export type LeagueTeamRosterRole = 'lead' | 'second' | 'third' | 'fourth' | 'player1' | 'player2';

export type LeagueTeamRosterMember = {
  memberId: number;
  role: LeagueTeamRosterRole;
  isSkip?: boolean;
  isVice?: boolean;
};

export function validateLeagueTeamRoster<T extends LeagueTeamRosterMember>(
  format: 'teams' | 'doubles' | 'instructional',
  members: T[]
): Array<T & { isSkip: boolean; isVice: boolean }> {
  const rosterShapeFormat = format === 'doubles' ? 'doubles' : 'teams';
  const normalized = members.map((m) => ({
    ...m,
    isSkip: Boolean(m.isSkip),
    isVice: Boolean(m.isVice),
  }));

  const memberIds = new Set<number>();
  for (const member of normalized) {
    if (memberIds.has(member.memberId)) {
      throw new Error('Roster has duplicate members.');
    }
    memberIds.add(member.memberId);
  }

  const roles = normalized.map((m) => m.role);
  const roleSet = new Set(roles);
  if (roleSet.size !== roles.length) {
    throw new Error('Roster roles must be unique.');
  }

  if (rosterShapeFormat === 'teams') {
    const allowedRoles = new Set(['lead', 'second', 'third', 'fourth']);
    if (!normalized.every((m) => allowedRoles.has(m.role))) {
      throw new Error('Teams roster roles must be lead, second, third, or fourth.');
    }

    if (normalized.length !== 3 && normalized.length !== 4) {
      throw new Error('Teams rosters must have 3 or 4 players.');
    }

    const skips = normalized.filter((m) => m.isSkip);
    const vices = normalized.filter((m) => m.isVice);

    if (skips.length !== 1) {
      throw new Error('Teams rosters must have exactly one skip.');
    }
    if (vices.length !== 1) {
      throw new Error('Teams rosters must have exactly one vice.');
    }
    if (skips[0].memberId === vices[0].memberId) {
      throw new Error('Skip and vice must be different players.');
    }

    return normalized;
  }

  if (normalized.length !== 2) {
    throw new Error('Doubles rosters must have exactly two players.');
  }

  if (!(roleSet.has('player1') && roleSet.has('player2'))) {
    throw new Error('Doubles rosters must include player1 and player2.');
  }

  if (normalized.some((m) => m.isSkip || m.isVice)) {
    throw new Error('Doubles rosters do not support skip or vice.');
  }

  return normalized;
}
