export type RosterPlacementSource = 'league_returner' | 'waitlist_add' | 'third_league';

/**
 * How a roster seat was filled, for membership-manager UI.
 *
 * Stored `placement_type` is the primary signal. Rebuild third-league lottery
 * historically wrote `new_placement` (or `temporary_sabbatical_fill` when
 * filling a sabbatical), so those types are classified as third-league when
 * the member already holds two other session roster seats.
 */
export function deriveRosterPlacementSource(input: {
  placementType: string | null | undefined;
  sessionLeagueCount: number;
}): RosterPlacementSource | null {
  const type = input.placementType ?? null;
  if (type === 'guaranteed_return' || type === 'guaranteed_fallback') return 'league_returner';
  if (type === 'waitlist') return 'waitlist_add';
  if (type === 'third_league') return 'third_league';
  if (type === 'new_placement' || type === 'temporary_sabbatical_fill') {
    if (input.sessionLeagueCount >= 3) return 'third_league';
    if (type === 'temporary_sabbatical_fill') return 'waitlist_add';
  }
  return null;
}
