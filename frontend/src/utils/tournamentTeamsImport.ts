import { rosterSlotsForFormat, slotLabel, type TournamentFormat } from './tournamentDisplay';

/** Stable id stored per TSV column (select value). */
export type TournamentTeamsImportColumnMapping =
  | 'ignore'
  | 'team_name'
  | 'home_club'
  | 'position'
  | 'player_name'
  | 'email'
  | 'notes'
  | `slot_player:${string}`
  | `slot_email:${string}`
  | `slot_notes:${string}`;

export type TournamentTeamImportPayload = {
  teamName: string | null;
  roster: Array<{
    slotCode: string;
    playerName: string | null;
    email: string | null;
    notes: string | null;
    homeClub: string | null;
  }>;
};

export function parseTsvGrid(text: string): string[][] {
  const raw = text.replace(/^\uFEFF/, '').trimEnd();
  if (!raw.trim()) return [];
  const lines = raw.split(/\r\n|\n|\r/);
  const grid = lines.map((line) => line.split('\t'));
  while (grid.length > 0 && grid[grid.length - 1].every((c) => !c.trim())) {
    grid.pop();
  }
  return grid;
}

export function gridColumnCount(grid: string[][]): number {
  let m = 0;
  for (const row of grid) {
    m = Math.max(m, row.length);
  }
  return m;
}

function normalizeHeaderToken(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function guessMappingForHeaderCell(format: TournamentFormat, cell: string): TournamentTeamsImportColumnMapping {
  const t = normalizeHeaderToken(cell);
  if (!t) return 'ignore';

  if (t === 'team name' || t === 'team' || t === 'teamname' || t === 'squad') return 'team_name';
  if (t === 'home club' || t === 'club' || t === 'home' || t === 'rink') return 'home_club';
  if (t === 'position' || t === 'role' || t === 'slot' || t === 'pos') return 'position';
  if (t === 'player name' || t === 'player' || t === 'name' || t === 'curler') return 'player_name';
  if (t === 'email' || t === 'e-mail' || t === 'e mail') return 'email';
  if (t === 'notes' || t === 'note' || t === 'comments' || t === 'comment') return 'notes';

  for (const code of rosterSlotsForFormat(format)) {
    const label = slotLabel(format, code).toLowerCase();
    const base = `${label} `;
    if (t === `${label} name` || t === label || t === `${label} player`) {
      return `slot_player:${code}`;
    }
    if (t === `${label} email` || t === `${label} e-mail`) {
      return `slot_email:${code}`;
    }
    if (t === `${label} notes` || t === `${label} note`) {
      return `slot_notes:${code}`;
    }
    if (t.startsWith(base)) {
      const rest = t.slice(base.length);
      if (rest === 'name' || rest === 'player') return `slot_player:${code}`;
      if (rest === 'email' || rest === 'e-mail') return `slot_email:${code}`;
      if (rest === 'notes' || rest === 'note') return `slot_notes:${code}`;
    }
  }

  return 'ignore';
}

export function guessColumnMappingsFromHeaderRow(
  format: TournamentFormat,
  headerRow: string[],
  columnCount: number,
): TournamentTeamsImportColumnMapping[] {
  const out: TournamentTeamsImportColumnMapping[] = [];
  for (let c = 0; c < columnCount; c++) {
    const cell = headerRow[c] ?? '';
    out.push(guessMappingForHeaderCell(format, cell));
  }
  return out;
}

export function defaultColumnMappings(columnCount: number): TournamentTeamsImportColumnMapping[] {
  return Array.from({ length: columnCount }, () => 'ignore');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Last name for default team label: "Smith, John" → Smith; "Mary Jane Lee" → Lee */
function lastNameFromPlayerField(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (t.includes(',')) {
    return t.split(',')[0]!.trim();
  }
  const parts = t.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : '';
}

function skipSlotCodeForDefaultTeamName(format: TournamentFormat): 'fourth' | 'player2' {
  return format === 'fours' ? 'fourth' : 'player2';
}

/**
 * If the sheet has no team name, uses "Team <last name>" from the fourth (fours) or player 2 / skip (doubles).
 * Otherwise a numbered "Team N" fallback.
 */
function resolveImportTeamDisplayName(
  format: TournamentFormat,
  explicitName: string,
  roster: TournamentTeamImportPayload['roster'],
  numberFallback: { n: number },
): string {
  const trimmed = explicitName.trim();
  if (trimmed) return trimmed;

  const slotCode = skipSlotCodeForDefaultTeamName(format);
  const row = roster.find((r) => r.slotCode === slotCode);
  const last = lastNameFromPlayerField(row?.playerName ?? '');
  if (last) return `Team ${last}`;

  numberFallback.n += 1;
  return `Team ${numberFallback.n}`;
}

function parseSlotCodeFromCell(format: TournamentFormat, raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  for (const code of rosterSlotsForFormat(format)) {
    if (s === code.toLowerCase()) return code;
    const label = slotLabel(format, code).toLowerCase();
    if (s === label) return code;
  }

  if (format === 'fours') {
    const map: Record<string, string> = {
      l: 'lead',
      lead: 'lead',
      '1st': 'lead',
      first: 'lead',
      '2nd': 'second',
      second: 'second',
      '3rd': 'third',
      third: 'third',
      vice: 'third',
      '4th': 'fourth',
      fourth: 'fourth',
      skip: 'fourth',
      alt: 'alternate',
      alternate: 'alternate',
      sub: 'alternate',
    };
    if (map[s]) return map[s];
  } else {
    const map: Record<string, string> = {
      p1: 'player1',
      'player 1': 'player1',
      'player1': 'player1',
      mate: 'player1',
      p2: 'player2',
      'player 2': 'player2',
      'player2': 'player2',
      skip: 'player2',
    };
    if (map[s]) return map[s];
  }

  return null;
}

function hasWideSlotMapping(mappings: TournamentTeamsImportColumnMapping[]): boolean {
  return mappings.some((m) => m.startsWith('slot_player:') || m.startsWith('slot_email:') || m.startsWith('slot_notes:'));
}

function hasLongRowMapping(mappings: TournamentTeamsImportColumnMapping[]): boolean {
  return mappings.some((m) => m === 'position' || m === 'player_name');
}

export function validateImportMappings(mappings: TournamentTeamsImportColumnMapping[]): string[] {
  const errors: string[] = [];
  const count = (pred: (m: TournamentTeamsImportColumnMapping) => boolean) => mappings.filter(pred).length;

  if (count((m) => m === 'team_name') > 1) {
    errors.push('Only one column can be Team name.');
  }
  if (count((m) => m === 'home_club') > 1) {
    errors.push('Only one column can be Home club.');
  }
  if (count((m) => m === 'position') > 1) {
    errors.push('Only one column can be Position.');
  }
  if (count((m) => m === 'player_name') > 1) {
    errors.push('Only one column can be Player name (long rows).');
  }
  if (count((m) => m === 'email') > 1) {
    errors.push('Only one column can be Email (long rows).');
  }
  if (count((m) => m === 'notes') > 1) {
    errors.push('Only one column can be Notes (long rows).');
  }

  const wide = hasWideSlotMapping(mappings);
  const long = hasLongRowMapping(mappings);

  if (wide && long) {
    errors.push('Use either long rows (Position + Player name) or fixed slot columns, not both.');
  }

  if (long) {
    if (!mappings.includes('position')) {
      errors.push('Long-row import requires a Position column.');
    }
    if (!mappings.includes('player_name')) {
      errors.push('Long-row import requires a Player name column.');
    }
  }

  const seenSlotField = new Set<string>();
  for (const m of mappings) {
    if (m.startsWith('slot_player:') || m.startsWith('slot_email:') || m.startsWith('slot_notes:')) {
      if (seenSlotField.has(m)) {
        errors.push(`Each fixed-slot mapping must be used only once (${m}).`);
      }
      seenSlotField.add(m);
    }
  }

  return errors;
}

function cellAt(row: string[], col: number): string {
  return (row[col] ?? '').trim();
}

function firstNonEmptyTeamNameInRows(rows: string[][], colTeam: number): string {
  if (colTeam < 0) return '';
  for (const row of rows) {
    const t = cellAt(row, colTeam);
    if (t) return t;
  }
  return '';
}

function emptyRoster(format: TournamentFormat): Map<string, { player: string; email: string; notes: string; homeClub: string }> {
  const m = new Map<string, { player: string; email: string; notes: string; homeClub: string }>();
  for (const code of rosterSlotsForFormat(format)) {
    m.set(code, { player: '', email: '', notes: '', homeClub: '' });
  }
  return m;
}

export function buildImportTeamPayloads(
  format: TournamentFormat,
  dataRows: string[][],
  mappings: TournamentTeamsImportColumnMapping[],
): { payloads: TournamentTeamImportPayload[]; warnings: string[] } {
  const warnings: string[] = [];
  const colTeam = mappings.indexOf('team_name');
  const colClub = mappings.indexOf('home_club');
  const colPos = mappings.indexOf('position');
  const colPlayer = mappings.indexOf('player_name');
  const colEmail = mappings.indexOf('email');
  const colNotes = mappings.indexOf('notes');

  const wide = hasWideSlotMapping(mappings);
  const slots = rosterSlotsForFormat(format);
  const numberFallback = { n: 0 };

  if (wide) {
    const teamOrderWide: string[] = [];
    const wideGroups = new Map<string, string[][]>();
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const teamNameRaw = colTeam >= 0 ? cellAt(row, colTeam) : '';
      const key = teamNameRaw || `__wide_row_${i}`;
      if (!wideGroups.has(key)) {
        wideGroups.set(key, []);
        teamOrderWide.push(key);
      }
      wideGroups.get(key)!.push(row);
    }

    const payloads: TournamentTeamImportPayload[] = [];
    for (const groupKey of teamOrderWide) {
      const rows = wideGroups.get(groupKey)!;
      const slotMap = emptyRoster(format);
      let sharedClub = '';

      for (const row of rows) {
        if (colClub >= 0) {
          const club = cellAt(row, colClub);
          if (club) sharedClub = club;
        }
        for (let c = 0; c < mappings.length; c++) {
          const m = mappings[c];
          const v = cellAt(row, c);
          if (m === 'ignore' || m === 'team_name' || m === 'home_club') continue;
          if (m.startsWith('slot_player:')) {
            const code = m.slice('slot_player:'.length);
            if (slotMap.has(code) && v) {
              slotMap.get(code)!.player = v;
              if (sharedClub) slotMap.get(code)!.homeClub = sharedClub;
            }
          } else if (m.startsWith('slot_email:')) {
            const code = m.slice('slot_email:'.length);
            if (slotMap.has(code) && v) slotMap.get(code)!.email = v;
          } else if (m.startsWith('slot_notes:')) {
            const code = m.slice('slot_notes:'.length);
            if (slotMap.has(code) && v) slotMap.get(code)!.notes = v;
          }
        }
      }

      const explicitTeam = firstNonEmptyTeamNameInRows(rows, colTeam);
      const roster = slots.map((slotCode) => {
        const d = slotMap.get(slotCode)!;
        const email = d.email.trim();
        const homeClub = d.homeClub.trim() || sharedClub.trim() || null;
        return {
          slotCode,
          playerName: d.player.trim() || null,
          email: email && EMAIL_RE.test(email) ? email : null,
          notes: d.notes.trim() || null,
          homeClub,
        };
      });
      const resolvedTeamName = resolveImportTeamDisplayName(format, explicitTeam, roster, numberFallback);

      for (const slotCode of slots) {
        const d = slotMap.get(slotCode)!;
        const emailRaw = d.email.trim();
        if (emailRaw && !EMAIL_RE.test(emailRaw)) {
          warnings.push(`Invalid email for ${slotLabel(format, slotCode)} (${resolvedTeamName}) — cleared.`);
        }
      }

      payloads.push({
        teamName: resolvedTeamName,
        roster,
      });
    }
    return { payloads, warnings };
  }

  /**
   * Long rows: fill-down team name (spreadsheet merged cells). Rows before the first team name use one anonymous
   * group until a named team appears.
   */
  const teamOrder: string[] = [];
  const byTeam = new Map<string, string[][]>();
  let fillDown: string | null = null;
  let anonBlockStart: number | null = null;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const raw = colTeam >= 0 ? cellAt(row, colTeam) : '';
    if (raw) {
      fillDown = raw;
      anonBlockStart = null;
    }
    let key: string;
    if (fillDown) {
      key = fillDown;
    } else {
      if (anonBlockStart === null) anonBlockStart = i;
      key = `__long_anon_${anonBlockStart}`;
    }
    if (!byTeam.has(key)) {
      byTeam.set(key, []);
      teamOrder.push(key);
    }
    byTeam.get(key)!.push(row);
  }

  const payloads: TournamentTeamImportPayload[] = [];
  for (const groupKey of teamOrder) {
    const rows = byTeam.get(groupKey)!;
    const slotMap = emptyRoster(format);

    const explicitTeam = firstNonEmptyTeamNameInRows(rows, colTeam);

    for (const row of rows) {
      const posCell = colPos >= 0 ? cellAt(row, colPos) : '';
      const code = parseSlotCodeFromCell(format, posCell);
      if (!code || !slotMap.has(code)) {
        if (posCell) {
          warnings.push(
            `Unknown position "${posCell}" — row skipped for roster (team column: ${explicitTeam.trim() || '—'}).`,
          );
        }
        continue;
      }
      const player = colPlayer >= 0 ? cellAt(row, colPlayer) : '';
      const email = colEmail >= 0 ? cellAt(row, colEmail) : '';
      const notes = colNotes >= 0 ? cellAt(row, colNotes) : '';
      const club = colClub >= 0 ? cellAt(row, colClub) : '';
      const cur = slotMap.get(code)!;
      if (player) cur.player = player;
      if (email) cur.email = email;
      if (notes) cur.notes = notes;
      if (club) cur.homeClub = club;
    }

    const roster = slots.map((slotCode) => {
      const d = slotMap.get(slotCode)!;
      const email = d.email.trim();
      return {
        slotCode,
        playerName: d.player.trim() || null,
        email: email && EMAIL_RE.test(email) ? email : null,
        notes: d.notes.trim() || null,
        homeClub: d.homeClub.trim() || null,
      };
    });

    const resolvedTeamName = resolveImportTeamDisplayName(format, explicitTeam, roster, numberFallback);

    for (const slotCode of slots) {
      const d = slotMap.get(slotCode)!;
      const emailRaw = d.email.trim();
      if (emailRaw && !EMAIL_RE.test(emailRaw)) {
        warnings.push(`Invalid email for ${slotLabel(format, slotCode)} (${resolvedTeamName}) — cleared.`);
      }
    }

    payloads.push({
      teamName: resolvedTeamName,
      roster,
    });
  }

  return { payloads, warnings };
}

export type ImportMappingOption = { value: TournamentTeamsImportColumnMapping; label: string; group: string };

export function importMappingOptionsForFormat(format: TournamentFormat): ImportMappingOption[] {
  const opts: ImportMappingOption[] = [
    { value: 'ignore', label: 'Ignore', group: 'General' },
    { value: 'team_name', label: 'Team name (optional)', group: 'General' },
    { value: 'home_club', label: 'Home club (long rows)', group: 'Long rows (one row per player)' },
    { value: 'position', label: 'Position (long rows)', group: 'Long rows (one row per player)' },
    { value: 'player_name', label: 'Player name (long rows)', group: 'Long rows (one row per player)' },
    { value: 'email', label: 'Email (long rows)', group: 'Long rows (one row per player)' },
    { value: 'notes', label: 'Notes (long rows)', group: 'Long rows (one row per player)' },
  ];

  for (const code of rosterSlotsForFormat(format)) {
    const label = slotLabel(format, code);
    opts.push(
      { value: `slot_player:${code}`, label: `${label} — player name`, group: 'Fixed columns (one column per field)' },
      { value: `slot_email:${code}`, label: `${label} — email`, group: 'Fixed columns (one column per field)' },
      { value: `slot_notes:${code}`, label: `${label} — notes`, group: 'Fixed columns (one column per field)' },
    );
  }

  return opts;
}
