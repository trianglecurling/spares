import type { TournamentFormat } from './tournamentDisplay';

const BONSPIEL_TYPE_IDS = new Set(['bonspiel-fours', 'bonspiel-doubles', 'bonspiel']);

export function isBonspielCalendarType(raw: string | null | undefined): boolean {
  if (raw == null || raw === '') return false;
  return BONSPIEL_TYPE_IDS.has(raw);
}

export function tournamentFormatFromCalendarType(
  raw: string | null | undefined,
): TournamentFormat | null {
  if (raw === 'bonspiel-doubles') return 'doubles';
  if (raw === 'bonspiel-fours' || raw === 'bonspiel') return 'fours';
  return null;
}

/** Calendar color lookup: map event-system bonspiel types onto the club calendar bonspiel swatch. */
export function calendarColorTypeId(typeId: string | null | undefined): string {
  if (typeId === 'bonspiel-fours' || typeId === 'bonspiel-doubles') return 'bonspiel';
  return typeId ?? 'other';
}
