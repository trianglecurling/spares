export type LeaguePlayFormat = 'teams' | 'doubles' | 'instructional';

export type LeagueExtraDraw = { date: string; time: string };

/** Default draw length by play format (teams/instructional: 120, doubles: 90). */
export function defaultDrawDurationMinutes(format: LeaguePlayFormat): number {
  return format === 'doubles' ? 90 : 120;
}

export function extraDrawKey(draw: LeagueExtraDraw): string {
  return `${draw.date}|${draw.time.slice(0, 5)}`;
}
