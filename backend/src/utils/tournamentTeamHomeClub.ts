/** Deduplicated slash-joined home clubs from roster slots (preserves first-seen casing). */
export function formatTeamHomeClubFromRoster(
  roster: Array<{ homeClub?: string | null }>,
  legacyTeamHomeClub?: string | null,
): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const row of roster) {
    const club = row.homeClub?.trim();
    if (!club) continue;
    const key = club.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(club);
  }

  if (parts.length === 0) {
    const legacy = legacyTeamHomeClub?.trim();
    return legacy || null;
  }

  return parts.join('/');
}
