export type RegistrationChargeSet = {
  chargedLeagueIds: number[];
  temporaryFillLeagueIds: number[];
};

export function emptyRegistrationChargeSet(): RegistrationChargeSet {
  return { chargedLeagueIds: [], temporaryFillLeagueIds: [] };
}

/**
 * Bill every league the curler is actually placed in: active roster rows,
 * Teams-tab assignments, and granted play-in entry. Play-in roster rows are
 * sometimes marked removed after a team is created, which must not drop the fee.
 */
export function mergeRegistrationChargeSets(
  ...parts: Array<Partial<RegistrationChargeSet> | null | undefined>
): RegistrationChargeSet {
  const chargedLeagueIds = new Set<number>();
  const temporaryFillLeagueIds = new Set<number>();
  for (const part of parts) {
    if (!part) continue;
    for (const leagueId of part.chargedLeagueIds ?? []) chargedLeagueIds.add(leagueId);
    for (const leagueId of part.temporaryFillLeagueIds ?? []) temporaryFillLeagueIds.add(leagueId);
  }
  return {
    chargedLeagueIds: [...chargedLeagueIds],
    temporaryFillLeagueIds: [...temporaryFillLeagueIds],
  };
}

export function addChargedLeague(
  target: { chargedLeagueIds: number[]; temporaryFillLeagueIds: number[] },
  leagueId: number,
  temporaryFill = false,
): void {
  target.chargedLeagueIds.push(leagueId);
  if (temporaryFill) target.temporaryFillLeagueIds.push(leagueId);
}
