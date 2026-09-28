import type { paths } from '../api/generated/types';
import { formatDateInTimeZone } from './clubTime';
import { SHEET_STONE_COLOR_HEX } from './sheetStoneColors';

type JsonResponse<T> = T extends { responses: { 200: { content: { 'application/json': infer Body } } } }
  ? Body
  : never;

export type StoneListResponse = JsonResponse<paths['/public/stones']['get']>;
export type StoneDetailResponse = JsonResponse<paths['/public/stones/{id}']['get']>;
export type StoneSummary = StoneListResponse['stones'][number];
export type StonePlacement = StoneDetailResponse['placements'][number];
export type StoneMaintenance = StoneDetailResponse['maintenance'][number];
export type MaintenanceActivityType = StoneMaintenance['activityType'];
export type StoneActivityResponse = JsonResponse<paths['/public/stones/activity']['get']>;
export type StoneActivityEntry = StoneActivityResponse['entries'][number];

export const STONE_SHEETS = ['A', 'B', 'C', 'D'] as const;
export const STONE_COLORS = ['red', 'yellow'] as const;
export const STONE_SIDES = ['A', 'B'] as const;
export const ROCK_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type StoneSheet = (typeof STONE_SHEETS)[number];
export type StoneColor = (typeof STONE_COLORS)[number];
export type StoneSide = (typeof STONE_SIDES)[number];

export type StonePosition = {
  sheet: StoneSheet | null;
  color: StoneColor | null;
  rockNumber: number | null;
};

export const UNASSIGNED_POSITION: StonePosition = { sheet: null, color: null, rockNumber: null };

export const STONE_COLOR_HEX: Record<StoneColor, string> = {
  red: SHEET_STONE_COLOR_HEX.red,
  yellow: SHEET_STONE_COLOR_HEX.yellow,
};

export const STONE_COLOR_LABELS: Record<StoneColor, string> = {
  red: 'Red',
  yellow: 'Yellow',
};

export const MAINTENANCE_ACTIVITY_LABELS: Record<MaintenanceActivityType, string> = {
  texturing: 'Rock texturing',
  band_narrowing: 'Band narrowing',
  imprinting: 'Imprinting',
};

export const PLACEMENT_CHANGE_LABELS: Record<StonePlacement['changeType'], string> = {
  added: 'Added',
  moved: 'Moved',
  swapped: 'Swapped',
  rotated: 'Rotated',
  flipped: 'Flipped',
};

export const adminStoneHref = (stoneId: number) => `/admin/facility/stones/${stoneId}`;
export const publicStoneHref = (stoneId: number) => `/stones/${stoneId}`;

export function stonePositionKey(position: StonePosition): string | null {
  if (position.color == null) return null;
  if (position.sheet == null) return `spare:${position.color}`;
  return `${position.sheet}:${position.color}:${position.rockNumber}`;
}

export function samePosition(a: StonePosition, b: StonePosition): boolean {
  return a.sheet === b.sheet && a.color === b.color && a.rockNumber === b.rockNumber;
}

export function stonePositionLabel(position: StonePosition | null | undefined): string {
  if (!position || position.color == null) return 'Unassigned';
  const colorLabel = STONE_COLOR_LABELS[position.color];
  if (position.sheet == null) return `${colorLabel} spare`;
  return `Sheet ${position.sheet} ${colorLabel.toLowerCase()} ${position.rockNumber}`;
}

export function stoneTitle(stone: Pick<StoneSummary, 'wcfRegistrationNumber'>): string {
  return `Stone ${stone.wcfRegistrationNumber}`;
}

/** Maps occupiable position keys to the stone currently there. */
export function stonesByPosition(stones: StoneSummary[]): Map<string, StoneSummary> {
  const map = new Map<string, StoneSummary>();
  for (const stone of stones) {
    const key = stone.current ? stonePositionKey(stone.current) : null;
    if (key) map.set(key, stone);
  }
  return map;
}

export function todayInClub(): string {
  return formatDateInTimeZone(new Date()) ?? new Date().toISOString().slice(0, 10);
}

/** Formats a date-only `YYYY-MM-DD` value without shifting it through a time zone. */
export function formatStoneDate(value: string | null | undefined): string {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function maintenanceSummary(
  record: Pick<StoneMaintenance, 'activityType' | 'passes' | 'rotations' | 'sandpaperGrit' | 'bandWidthsMm'>,
): string {
  if (record.activityType === 'imprinting') {
    const widths = record.bandWidthsMm.map((width) => (width == null ? '—' : String(width)));
    return `Band widths ${widths.join(' / ')} mm`;
  }
  const count =
    record.activityType === 'texturing'
      ? `${record.passes ?? '—'} ${record.passes === 1 ? 'pass' : 'passes'}`
      : `${record.rotations ?? '—'} ${record.rotations === 1 ? 'rotation' : 'rotations'}`;
  return `${count}, ${record.sandpaperGrit ?? '—'} grit`;
}

export function parseOptionalInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

export function parseOptionalDecimal(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export type StoneImportRow = StonePosition & {
  line: number;
  wcfRegistrationNumber: string;
  alSerialNumber: string;
  error: string | null;
};

function parseImportSheet(raw: string): StoneSheet | 'spare' | null | undefined {
  const value = raw.trim().toUpperCase().replace(/^SHEET\s+/, '');
  if (!value) return null;
  if (value === 'SPARE') return 'spare';
  return (STONE_SHEETS as readonly string[]).includes(value) ? (value as StoneSheet) : undefined;
}

function parseImportColor(raw: string): StoneColor | null | undefined {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value === 'r' || value === 'red') return 'red';
  if (value === 'y' || value === 'yellow') return 'yellow';
  return undefined;
}

/**
 * Parses pasted spreadsheet rows: sheet, color, rock number, WCF registration number, AL serial number.
 * Columns may be tab- or comma-separated. Sheet may be A-D, "Spare", or blank for unassigned.
 */
export function parseStoneImportText(text: string): StoneImportRow[] {
  const rows: StoneImportRow[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    if (!rawLine.trim()) return;
    const cells = (rawLine.includes('\t') ? rawLine.split('\t') : rawLine.split(',')).map((cell) => cell.trim());
    if (rows.length === 0 && /wcf|serial/i.test(rawLine)) return;

    const [sheetCell = '', colorCell = '', rockCell = '', wcf = '', al = ''] = cells;
    const row: StoneImportRow = {
      line: index + 1,
      sheet: null,
      color: null,
      rockNumber: null,
      wcfRegistrationNumber: wcf,
      alSerialNumber: al,
      error: null,
    };
    const sheet = parseImportSheet(sheetCell);
    const color = parseImportColor(colorCell);
    const rock = rockCell ? Number(rockCell) : null;

    if (cells.length < 5) {
      row.error = 'Expected 5 columns: sheet, color, rock number, WCF number, AL serial.';
    } else if (sheet === undefined) {
      row.error = `Unknown sheet "${sheetCell}". Use A, B, C, D, Spare, or leave blank for unassigned.`;
    } else if (color === undefined) {
      row.error = `Unknown color "${colorCell}". Use red or yellow.`;
    } else if (!wcf || !al) {
      row.error = 'WCF registration number and AL serial number are required.';
    } else if (sheet === 'spare') {
      if (!color) row.error = 'Spares need a color.';
      else row.color = color;
    } else if (sheet) {
      if (!color) row.error = 'Sheet positions need a color.';
      else if (rock == null || !Number.isInteger(rock) || rock < 1 || rock > 8) {
        row.error = 'Rock number must be between 1 and 8.';
      } else {
        row.sheet = sheet;
        row.color = color;
        row.rockNumber = rock;
      }
    } else if (color) {
      row.error = 'Leave color blank for unassigned stones, or enter a sheet or "Spare".';
    }
    rows.push(row);
  });

  const seenPositions = new Map<string, number>();
  const seenWcf = new Set<string>();
  const seenAl = new Set<string>();
  for (const row of rows) {
    if (row.error) continue;
    const key = stonePositionKey(row);
    if (key && seenPositions.has(key)) {
      row.error = `${stonePositionLabel(row)} is listed more than once.`;
    } else if (seenWcf.has(row.wcfRegistrationNumber)) {
      row.error = `WCF number ${row.wcfRegistrationNumber} is listed more than once.`;
    } else if (seenAl.has(row.alSerialNumber)) {
      row.error = `AL serial ${row.alSerialNumber} is listed more than once.`;
    }
    if (key) seenPositions.set(key, row.line);
    seenWcf.add(row.wcfRegistrationNumber);
    seenAl.add(row.alSerialNumber);
  }
  return rows;
}
