export function isLeagueEligibleForSpares(league: {
  format: string | null | undefined;
  allowsDropIns?: boolean | null;
}): boolean {
  if (league.allowsDropIns) return false;
  return league.format != null && league.format !== 'instructional';
}
