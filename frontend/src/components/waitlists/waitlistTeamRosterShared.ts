/**
 * A waitlist team roster is now just the set of members on the team. Each
 * member's own priority list says what they give up if the team is placed, so a
 * per-teammate ADD/REPLACE choice is no longer collected here.
 */
export type WaitlistTeamMemberPlacement = {
  memberId: number;
  memberName: string;
};

export type WaitlistTeamMemberPlacementInput = {
  memberId: number;
};

export type WaitlistTeamMemberPlacementOptions = {
  memberId: number;
  memberName: string;
  currentLeagueCount: number;
  alreadyOnWaitlistCount: number;
};

export function syncPlacementsWithMembers(
  members: Array<{ memberId: number; memberName: string }>,
  current: WaitlistTeamMemberPlacement[],
): WaitlistTeamMemberPlacement[] {
  const byMemberId = new Map(current.map((placement) => [placement.memberId, placement]));
  return members.map((member) => ({
    memberId: member.memberId,
    memberName: byMemberId.get(member.memberId)?.memberName ?? member.memberName,
  }));
}

export function placementsAreComplete(
  placements: WaitlistTeamMemberPlacement[],
  expectedSize: number | null,
): boolean {
  if (!expectedSize) return placements.length > 0;
  return placements.length === expectedSize;
}

export function toPlacementPayload(
  placements: WaitlistTeamMemberPlacement[],
): WaitlistTeamMemberPlacementInput[] {
  return placements.map((placement) => ({ memberId: placement.memberId }));
}
