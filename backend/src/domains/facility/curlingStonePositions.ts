export const STONE_SHEETS = ['A', 'B', 'C', 'D'] as const;
export const STONE_COLORS = ['red', 'yellow'] as const;
export const STONE_SIDES = ['A', 'B'] as const;
export const ROCKS_PER_COLOR = 8;

export type StoneSheet = (typeof STONE_SHEETS)[number];
export type StoneColor = (typeof STONE_COLORS)[number];
export type StoneSide = (typeof STONE_SIDES)[number];

/**
 * Where a stone sits. A sheet position has all three fields, a spare has only a color,
 * and an unassigned stone has none.
 */
export type StonePosition = {
  sheet: StoneSheet | null;
  color: StoneColor | null;
  rockNumber: number | null;
};

export const UNASSIGNED_POSITION: StonePosition = { sheet: null, color: null, rockNumber: null };

export function isStoneSheet(value: unknown): value is StoneSheet {
  return typeof value === 'string' && (STONE_SHEETS as readonly string[]).includes(value);
}

export function isStoneColor(value: unknown): value is StoneColor {
  return typeof value === 'string' && (STONE_COLORS as readonly string[]).includes(value);
}

export function isStoneSide(value: unknown): value is StoneSide {
  return typeof value === 'string' && (STONE_SIDES as readonly string[]).includes(value);
}

/** Returns an error message when the combination of fields is not a real position. */
export function validateStonePosition(position: StonePosition): string | null {
  const { sheet, color, rockNumber } = position;
  if (color == null) {
    return sheet == null && rockNumber == null ? null : 'Choose a stone color for this position.';
  }
  if (sheet == null) {
    return rockNumber == null ? null : 'Spare stones do not have a rock number.';
  }
  if (rockNumber == null || !Number.isInteger(rockNumber) || rockNumber < 1 || rockNumber > ROCKS_PER_COLOR) {
    return `Rock number must be between 1 and ${ROCKS_PER_COLOR}.`;
  }
  return null;
}

export function isUnassignedPosition(position: StonePosition): boolean {
  return position.color == null;
}

/** Stable key for an occupiable position; `null` for unassigned (any number of stones may be unassigned). */
export function stonePositionKey(position: StonePosition): string | null {
  if (position.color == null) return null;
  if (position.sheet == null) return `spare:${position.color}`;
  return `${position.sheet}:${position.color}:${position.rockNumber}`;
}

export function samePosition(a: StonePosition, b: StonePosition): boolean {
  return a.sheet === b.sheet && a.color === b.color && a.rockNumber === b.rockNumber;
}

/** Rotation moves sheet A to B, B to C, C to D, and D back to A. */
export function nextRotationSheet(sheet: StoneSheet): StoneSheet {
  const index = STONE_SHEETS.indexOf(sheet);
  return STONE_SHEETS[(index + 1) % STONE_SHEETS.length];
}

export function stonePositionLabel(position: StonePosition): string {
  if (position.color == null) return 'Unassigned';
  const colorLabel = position.color === 'red' ? 'Red' : 'Yellow';
  if (position.sheet == null) return `${colorLabel} spare`;
  return `Sheet ${position.sheet} ${colorLabel.toLowerCase()} ${position.rockNumber}`;
}

/** Sort order used for lists: sheets A-D (red 1-8 then yellow 1-8), then spares, then unassigned. */
export function stonePositionSortValue(position: StonePosition): number {
  if (position.color == null) return 10_000;
  const colorIndex = STONE_COLORS.indexOf(position.color);
  if (position.sheet == null) return 5_000 + colorIndex;
  const sheetIndex = STONE_SHEETS.indexOf(position.sheet);
  return sheetIndex * 100 + colorIndex * 10 + (position.rockNumber ?? 0);
}

export function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
