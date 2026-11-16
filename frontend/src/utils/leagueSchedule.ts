export type LeaguePlayFormat = 'teams' | 'doubles' | 'instructional';

export type LeagueExtraDraw = { date: string; time: string };

/** Default draw length by play format (teams/instructional: 120, doubles: 90). */
export function defaultDrawDurationMinutes(format: LeaguePlayFormat): number {
  return format === 'doubles' ? 90 : 120;
}

export function extraDrawKey(draw: LeagueExtraDraw): string {
  return `${draw.date}|${draw.time.slice(0, 5)}`;
}

export const ICE_PREP_MINUTES_MAX = 24 * 60;

export const ICE_PREP_TIME_HELPER =
  'Minutes before this draw that ice preparation starts. One-off draws are skipped, and exception dates remove that day’s ice preparation. Use 0 for none.';

export function parseIcePrepMinutes(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, ICE_PREP_MINUTES_MAX);
}
