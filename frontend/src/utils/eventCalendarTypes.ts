import type { TournamentFormat } from './tournamentDisplay';

export type EventCalendarTypeId = 'no-experience-necessary' | 'juniors' | 'bonspiel';

export const EVENT_CALENDAR_TYPE_IDS: readonly EventCalendarTypeId[] = [
  'no-experience-necessary',
  'juniors',
  'bonspiel',
] as const;

export const EVENT_CALENDAR_TYPE_OPTIONS: { id: EventCalendarTypeId; label: string }[] = [
  { id: 'no-experience-necessary', label: 'No experience necessary' },
  { id: 'juniors', label: 'Juniors' },
  { id: 'bonspiel', label: 'Bonspiel' },
];

const ALLOWED_TYPE_IDS = new Set<string>(EVENT_CALENDAR_TYPE_IDS);

const LEGACY_CALENDAR_TYPE_ID: Record<string, EventCalendarTypeId[]> = {
  'bonspiel-fours': ['bonspiel'],
  'bonspiel-doubles': ['bonspiel'],
  bonspiel: ['bonspiel'],
  'learn-to-curl': ['no-experience-necessary'],
  learn_to_curl: ['no-experience-necessary'],
  clinic: ['no-experience-necessary'],
  juniors: ['juniors'],
};

export function normalizeCalendarTypeIds(raw: unknown): EventCalendarTypeId[] {
  const incoming = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(raw) as unknown;
            return Array.isArray(parsed) ? parsed : [raw];
          } catch {
            return [raw];
          }
        })()
      : [];

  const selected = new Set<EventCalendarTypeId>();
  for (const item of incoming) {
    if (typeof item !== 'string' || item === '') continue;
    if (ALLOWED_TYPE_IDS.has(item)) {
      selected.add(item as EventCalendarTypeId);
      continue;
    }
    const legacy = LEGACY_CALENDAR_TYPE_ID[item];
    if (legacy) {
      for (const id of legacy) selected.add(id);
    }
  }

  return EVENT_CALENDAR_TYPE_IDS.filter((id) => selected.has(id));
}

export function hasBonspielCalendarType(ids: readonly string[] | null | undefined): boolean {
  if (!ids || ids.length === 0) return false;
  return ids.includes('bonspiel') || ids.includes('bonspiel-fours') || ids.includes('bonspiel-doubles');
}

export function isBonspielCalendarType(
  raw: string | readonly string[] | null | undefined,
): boolean {
  if (raw == null || raw === '') return false;
  if (Array.isArray(raw)) return hasBonspielCalendarType(raw);
  if (typeof raw === 'string') {
    if (raw.trim().startsWith('[')) {
      return hasBonspielCalendarType(normalizeCalendarTypeIds(raw));
    }
    return (
      raw === 'bonspiel' ||
      raw === 'bonspiel-fours' ||
      raw === 'bonspiel-doubles' ||
      hasBonspielCalendarType(LEGACY_CALENDAR_TYPE_ID[raw] ?? [])
    );
  }
  return false;
}

export function normalizeTournamentFormat(raw: string | null | undefined): TournamentFormat | null {
  if (raw === 'fours' || raw === 'doubles') return raw;
  return null;
}

/** @deprecated Prefer event.tournamentFormat from the API. */
export function tournamentFormatFromCalendarType(
  raw: string | null | undefined,
): TournamentFormat | null {
  if (raw === 'bonspiel-doubles') return 'doubles';
  if (raw === 'bonspiel-fours' || raw === 'bonspiel') return 'fours';
  return null;
}

/** Calendar color lookup: map event-system types onto club calendar swatches. */
export function calendarColorTypeId(ids: readonly string[] | string | null | undefined): string {
  const normalized = Array.isArray(ids)
    ? normalizeCalendarTypeIds(ids)
    : typeof ids === 'string'
      ? normalizeCalendarTypeIds(
          ids.trim().startsWith('[') ? ids : LEGACY_CALENDAR_TYPE_ID[ids] ?? [ids],
        )
      : [];
  if (normalized.includes('bonspiel')) return 'bonspiel';
  if (normalized.includes('juniors')) return 'juniors';
  if (normalized.includes('no-experience-necessary')) return 'learn-to-curl';
  return 'other';
}
