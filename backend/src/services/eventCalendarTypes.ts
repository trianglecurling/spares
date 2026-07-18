export type TournamentFormat = 'fours' | 'doubles';

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

/** Legacy single-value calendar_type_id → multi types + format. */
const LEGACY_CALENDAR_TYPE_ID: Record<
  string,
  { typeIds: EventCalendarTypeId[]; tournamentFormat: TournamentFormat | null }
> = {
  'bonspiel-fours': { typeIds: ['bonspiel'], tournamentFormat: 'fours' },
  'bonspiel-doubles': { typeIds: ['bonspiel'], tournamentFormat: 'doubles' },
  bonspiel: { typeIds: ['bonspiel'], tournamentFormat: 'fours' },
  'learn-to-curl': { typeIds: ['no-experience-necessary'], tournamentFormat: null },
  learn_to_curl: { typeIds: ['no-experience-necessary'], tournamentFormat: null },
  clinic: { typeIds: ['no-experience-necessary'], tournamentFormat: null },
  juniors: { typeIds: ['juniors'], tournamentFormat: null },
  other: { typeIds: [], tournamentFormat: null },
  social: { typeIds: [], tournamentFormat: null },
  maintenance: { typeIds: [], tournamentFormat: null },
};

export function isAllowedCalendarTypeId(raw: string | null | undefined): boolean {
  if (raw == null || raw === '') return false;
  return ALLOWED_TYPE_IDS.has(raw) || raw in LEGACY_CALENDAR_TYPE_ID;
}

export function normalizeTournamentFormat(raw: string | null | undefined): TournamentFormat | null {
  if (raw === 'fours' || raw === 'doubles') return raw;
  return null;
}

export function migrateLegacyCalendarTypeId(raw: string | null | undefined): {
  typeIds: EventCalendarTypeId[];
  tournamentFormat: TournamentFormat | null;
} {
  if (raw == null || raw === '') {
    return { typeIds: [], tournamentFormat: null };
  }
  if (ALLOWED_TYPE_IDS.has(raw)) {
    return {
      typeIds: [raw as EventCalendarTypeId],
      tournamentFormat: raw === 'bonspiel' ? 'fours' : null,
    };
  }
  const mapped = LEGACY_CALENDAR_TYPE_ID[raw];
  if (mapped) {
    return {
      typeIds: [...mapped.typeIds],
      tournamentFormat: mapped.tournamentFormat,
    };
  }
  return { typeIds: [], tournamentFormat: null };
}

/** Dedupe, drop unknown ids, stable order matching EVENT_CALENDAR_TYPE_IDS. */
export function normalizeCalendarTypeIds(raw: unknown): EventCalendarTypeId[] {
  const incoming = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(raw) as unknown;
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            // Legacy single id stored as plain text
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
      for (const id of legacy.typeIds) selected.add(id);
    }
  }

  return EVENT_CALENDAR_TYPE_IDS.filter((id) => selected.has(id));
}

export function serializeCalendarTypeIds(ids: readonly string[]): string {
  return JSON.stringify(normalizeCalendarTypeIds(ids));
}

export function parseCalendarTypeIds(raw: string | null | undefined): EventCalendarTypeId[] {
  if (raw == null || raw === '') return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    return normalizeCalendarTypeIds(trimmed);
  }
  // Pre-migration single calendar_type_id value
  return migrateLegacyCalendarTypeId(trimmed).typeIds;
}

export function hasBonspielCalendarType(ids: readonly string[] | null | undefined): boolean {
  if (!ids || ids.length === 0) return false;
  return ids.includes('bonspiel') || ids.includes('bonspiel-fours') || ids.includes('bonspiel-doubles');
}

/**
 * True when the event is a bonspiel.
 * Accepts multi type ids, serialized JSON, or a legacy single calendar_type_id.
 */
export function isBonspielCalendarType(
  raw: string | readonly string[] | null | undefined,
): boolean {
  if (raw == null || raw === '') return false;
  if (Array.isArray(raw)) return hasBonspielCalendarType(raw);
  if (typeof raw === 'string') {
    if (raw.trim().startsWith('[')) {
      return hasBonspielCalendarType(parseCalendarTypeIds(raw));
    }
    return (
      raw === 'bonspiel' ||
      raw === 'bonspiel-fours' ||
      raw === 'bonspiel-doubles' ||
      hasBonspielCalendarType(migrateLegacyCalendarTypeId(raw).typeIds)
    );
  }
  return false;
}

/** Primary club-calendar color key for an event's types. */
export function calendarColorTypeId(ids: readonly string[] | null | undefined): string {
  const normalized = normalizeCalendarTypeIds(ids ?? []);
  if (normalized.includes('bonspiel')) return 'bonspiel';
  if (normalized.includes('juniors')) return 'juniors';
  if (normalized.includes('no-experience-necessary')) return 'learn-to-curl';
  return 'other';
}

/**
 * @deprecated Prefer reading `tournament_format` + `hasBonspielCalendarType`.
 * Kept for legacy single-id reads during migration.
 */
export function tournamentFormatFromCalendarType(
  raw: string | null | undefined,
): TournamentFormat | null {
  if (raw == null || raw === '') return null;
  if (raw === 'fours' || raw === 'doubles') return raw;
  return migrateLegacyCalendarTypeId(raw).tournamentFormat;
}

/** @deprecated Use normalizeCalendarTypeIds / parseCalendarTypeIds. */
export function normalizeCalendarTypeId(raw: string | null | undefined): string {
  const { typeIds } = migrateLegacyCalendarTypeId(raw);
  if (typeIds.includes('bonspiel')) {
    const format = migrateLegacyCalendarTypeId(raw).tournamentFormat;
    return format === 'doubles' ? 'bonspiel-doubles' : 'bonspiel-fours';
  }
  if (typeIds.includes('no-experience-necessary')) return 'learn-to-curl';
  if (typeIds.includes('juniors')) return 'juniors';
  return 'other';
}
