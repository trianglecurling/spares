/**
 * True when a stored bonspiel draw JSON has at least one game with a recorded result.
 * Matches the public live-scores rule: standing points count, and in-progress end-by-end
 * scores (complete === false, or no ends entered yet) do not.
 */
export function drawJsonHasRecordedScores(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object') return false;
  const games = (parsed as { games?: unknown }).games;
  if (!games || typeof games !== 'object') return false;

  for (const game of Object.values(games as Record<string, unknown>)) {
    if (!game || typeof game !== 'object') continue;
    const standing = (game as { standing?: { points?: unknown } }).standing;
    const points = standing?.points;
    if (Array.isArray(points) && points.length >= 2 && points[0] != null && points[1] != null) {
      return true;
    }
    const result = (game as { result?: unknown }).result;
    if (!result || typeof result !== 'object') continue;
    const entry = result as {
      entryKind?: string;
      complete?: boolean;
      ends?: { side0?: unknown };
    };
    if (entry.entryKind === 'ends') {
      if (entry.complete === false) continue;
      if (!Array.isArray(entry.ends?.side0) || entry.ends.side0.length === 0) continue;
    }
    return true;
  }
  return false;
}
