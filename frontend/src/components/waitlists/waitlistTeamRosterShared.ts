export type WaitlistTeamMemberPlacement = {
  memberId: number;
  memberName: string;
  entryType: 'add' | 'replace';
  replacesLeagueId: number | null;
};

export type WaitlistTeamMemberPlacementInput = {
  memberId: number;
  entryType: 'add' | 'replace';
  replacesLeagueId?: number | null;
};

export type WaitlistTeamMemberPlacementOptions = {
  memberId: number;
  memberName: string;
  addAvailable: boolean;
  addBlockedReason: string | null;
  replacementLeagues: Array<{ id: number; name: string }>;
  activeReplaceWaitlists: number;
};

export function syncPlacementsWithMembers(
  members: Array<{ memberId: number; memberName: string }>,
  current: WaitlistTeamMemberPlacement[],
): WaitlistTeamMemberPlacement[] {
  const byMemberId = new Map(current.map((placement) => [placement.memberId, placement]));
  return members.map((member) => {
    const existing = byMemberId.get(member.memberId);
    return {
      memberId: member.memberId,
      memberName: member.memberName,
      entryType: existing?.entryType ?? 'add',
      replacesLeagueId: existing?.entryType === 'replace' ? existing.replacesLeagueId ?? null : null,
    };
  });
}

export function normalizePlacementsForPlacementOptions(
  placements: WaitlistTeamMemberPlacement[],
  placementOptionsByMemberId: Record<number, WaitlistTeamMemberPlacementOptions | undefined>,
): WaitlistTeamMemberPlacement[] {
  return placements.map((placement) => {
    const options = placementOptionsByMemberId[placement.memberId];
    if (placement.entryType === 'add' && options?.addAvailable === false) {
      return {
        ...placement,
        entryType: 'replace',
        replacesLeagueId: placement.replacesLeagueId,
      };
    }
    return placement;
  });
}

export function placementsNeedEntryTypeNormalization(
  placements: WaitlistTeamMemberPlacement[],
  placementOptionsByMemberId: Record<number, WaitlistTeamMemberPlacementOptions | undefined>,
): boolean {
  return placements.some((placement) => {
    const options = placementOptionsByMemberId[placement.memberId];
    return placement.entryType === 'add' && options?.addAvailable === false;
  });
}

export function placementsAreComplete(
  placements: WaitlistTeamMemberPlacement[],
  expectedSize: number | null,
): boolean {
  if (!expectedSize) return placements.length > 0;
  if (placements.length !== expectedSize) return false;
  return placements.every(
    (placement) =>
      placement.entryType === 'add' ||
      (placement.entryType === 'replace' && placement.replacesLeagueId != null),
  );
}

export function toPlacementPayload(
  placements: WaitlistTeamMemberPlacement[],
): WaitlistTeamMemberPlacementInput[] {
  return placements.map((placement) => ({
    memberId: placement.memberId,
    entryType: placement.entryType,
    replacesLeagueId: placement.entryType === 'replace' ? placement.replacesLeagueId : null,
  }));
}
