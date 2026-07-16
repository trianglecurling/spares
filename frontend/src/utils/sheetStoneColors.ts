export const SHEET_STONE_COLOR_PRESETS = [
  'red',
  'yellow',
  'dark_blue',
  'blue',
  'green',
] as const;

export type SheetStoneColorPreset = (typeof SHEET_STONE_COLOR_PRESETS)[number];

export const SHEET_STONE_COLOR_HEX: Record<SheetStoneColorPreset, string> = {
  red: '#DC2626',
  yellow: '#EAB308',
  dark_blue: '#1E3A8A',
  blue: '#2563EB',
  green: '#16A34A',
};

export const SHEET_STONE_COLOR_LABELS: Record<SheetStoneColorPreset, string> = {
  red: 'Red',
  yellow: 'Yellow',
  dark_blue: 'Dark blue',
  blue: 'Blue',
  green: 'Green',
};

const CUSTOM_SENTINEL = 'custom' as const;
const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

export type SheetStoneColorChoice = SheetStoneColorPreset | typeof CUSTOM_SENTINEL;

export function isSheetStoneColorPreset(value: string): value is SheetStoneColorPreset {
  return (SHEET_STONE_COLOR_PRESETS as readonly string[]).includes(value);
}

export function isSheetStoneColorHex(value: string): boolean {
  return HEX_REGEX.test(value);
}

export function resolveSheetStoneColorHex(value: string): string {
  if (isSheetStoneColorPreset(value)) {
    return SHEET_STONE_COLOR_HEX[value];
  }
  if (isSheetStoneColorHex(value)) {
    return value;
  }
  return '#808080';
}

export function sheetStoneColorLabel(value: string): string {
  if (isSheetStoneColorPreset(value)) {
    return SHEET_STONE_COLOR_LABELS[value];
  }
  if (isSheetStoneColorHex(value)) {
    return value.toUpperCase();
  }
  return value;
}

export function parseSheetStoneColorSelection(value: string): {
  choice: SheetStoneColorChoice;
  customHex: string;
} {
  if (isSheetStoneColorPreset(value)) {
    return { choice: value, customHex: '#808080' };
  }
  return {
    choice: CUSTOM_SENTINEL,
    customHex: isSheetStoneColorHex(value) ? value : '#808080',
  };
}

export function commitSheetStoneColorSelection(
  choice: SheetStoneColorChoice,
  customHex: string,
): string {
  if (choice !== CUSTOM_SENTINEL) {
    return choice;
  }
  const trimmed = customHex.trim();
  return isSheetStoneColorHex(trimmed) ? trimmed : '#808080';
}

export { CUSTOM_SENTINEL as SHEET_STONE_COLOR_CUSTOM };
