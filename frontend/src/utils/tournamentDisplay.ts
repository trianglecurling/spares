import type { ChoiceOption } from '../components/ChoiceInput';

export type TournamentFormat = 'fours' | 'doubles';

export const FOURS_SLOTS = ['lead', 'second', 'third', 'fourth'] as const;
export const DOUBLES_SLOTS = ['player1', 'player2'] as const;

/** Positions shown as columns on team tables (alternate excluded for fours). */
export const FOURS_TABLE_SLOTS = ['lead', 'second', 'third', 'fourth'] as const;
export const DOUBLES_TABLE_SLOTS = ['player1', 'player2'] as const;

export function tableSlotsForFormat(format: TournamentFormat): readonly string[] {
  return format === 'fours' ? FOURS_TABLE_SLOTS : DOUBLES_TABLE_SLOTS;
}

export function rosterSlotsForFormat(format: TournamentFormat): readonly string[] {
  return format === 'fours' ? FOURS_SLOTS : DOUBLES_SLOTS;
}

export function defaultViceSkip(format: TournamentFormat): { vice: string; skip: string } {
  return format === 'fours'
    ? { vice: 'third', skip: 'fourth' }
    : { vice: 'player1', skip: 'player2' };
}

export function slotLabel(format: TournamentFormat, slotCode: string): string {
  if (format === 'fours') {
    const labels: Record<string, string> = {
      lead: 'Lead',
      second: 'Second',
      third: 'Third',
      fourth: 'Fourth',
      alternate: 'Alternate',
    };
    return labels[slotCode] ?? slotCode;
  }
  const labels: Record<string, string> = {
    player1: 'Player 1',
    player2: 'Player 2',
  };
  return labels[slotCode] ?? slotCode;
}

export function viceSkipSlotOptions(format: TournamentFormat): ChoiceOption<string>[] {
  if (format === 'fours') {
    return FOURS_SLOTS.map((s) => ({
      value: s,
      label: slotLabel('fours', s),
    }));
  }
  return DOUBLES_SLOTS.map((s) => ({
    value: s,
    label: slotLabel('doubles', s),
  }));
}

export function formatTeamDisplayName(teamName: string | null | undefined, sortOrder: number): string {
  const trimmed = teamName?.trim();
  if (trimmed) return trimmed;
  return `Team ${sortOrder + 1}`;
}

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

/**
 * Footnote for fours team tables: only include lines when at least one team uses a non-default skip or vice.
 */
export function foursTableLegendText(
  teams: Array<{ viceSlotCode: string; skipSlotCode: string }>,
): string | null {
  const showSkip = teams.some((t) => t.skipSlotCode !== 'fourth');
  const showVice = teams.some((t) => t.viceSlotCode !== 'third');
  if (!showSkip && !showVice) return null;
  const parts: string[] = [];
  if (showSkip) parts.push('* Skip');
  if (showVice) parts.push('** Vice');
  return parts.join(' · ');
}

/**
 * One table cell: player name or em dash. For fours only: appends * when this slot is skip and skip is not
 * fourth; ** when this slot is vice and vice is not third. Doubles uses player order only (no skip/vice markers).
 */
export function formatPositionCell(
  format: TournamentFormat,
  roster: Array<{ slotCode: string; playerName: string | null }>,
  slotCode: string,
  viceSlotCode: string,
  skipSlotCode: string,
): string {
  const row = roster.find((r) => r.slotCode === slotCode);
  const raw = row?.playerName?.trim();
  if (!raw) return '—';

  if (format !== 'fours') return raw;

  let out = raw;
  if (slotCode === skipSlotCode && skipSlotCode !== 'fourth') {
    out += '*';
  }
  if (slotCode === viceSlotCode && viceSlotCode !== 'third') {
    out += '**';
  }
  return out;
}
