export type TournamentFormat = 'fours' | 'doubles';

const BONSPIEL_CALENDAR_TYPE_IDS = new Set(['bonspiel-fours', 'bonspiel-doubles', 'bonspiel']);

const CALENDAR_EVENT_TYPE_IDS = new Set([
  'bonspiel-fours',
  'bonspiel-doubles',
  'learn-to-curl',
  'juniors',
  'other',
]);

const LEGACY_CALENDAR_TYPE_ID: Record<string, string> = {
  clinic: 'learn-to-curl',
  social: 'other',
  maintenance: 'other',
  learn_to_curl: 'learn-to-curl',
  /** Pre-migration bonspiel rows (and any lingering reads) map to fours. */
  bonspiel: 'bonspiel-fours',
};

export function isBonspielCalendarType(raw: string | null | undefined): boolean {
  if (raw == null || raw === '') return false;
  return BONSPIEL_CALENDAR_TYPE_IDS.has(raw);
}

export function tournamentFormatFromCalendarType(
  raw: string | null | undefined,
): TournamentFormat | null {
  const id = normalizeCalendarTypeId(raw);
  if (id === 'bonspiel-doubles') return 'doubles';
  if (id === 'bonspiel-fours') return 'fours';
  return null;
}

export function normalizeCalendarTypeId(raw: string | null | undefined): string {
  if (raw == null || raw === '') return 'other';
  if (CALENDAR_EVENT_TYPE_IDS.has(raw)) return raw;
  const mapped = LEGACY_CALENDAR_TYPE_ID[raw];
  if (mapped) return mapped;
  return 'other';
}

export function isAllowedCalendarTypeId(raw: string | null | undefined): boolean {
  if (raw == null || raw === '') return false;
  return CALENDAR_EVENT_TYPE_IDS.has(raw) || raw in LEGACY_CALENDAR_TYPE_ID;
}
