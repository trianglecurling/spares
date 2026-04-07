export const CUSTOM_FIELD_TYPES = ['text', 'number', 'checkbox', 'dropdown', 'radio'] as const;

export const PRESET_FIELD_TYPES = [
  'preset_phone',
  'preset_address',
  'preset_team_four',
  'preset_team_doubles',
  'preset_dob',
] as const;

export type PresetFieldType = (typeof PRESET_FIELD_TYPES)[number];

export const PRESET_LABELS: Record<PresetFieldType, string> = {
  preset_phone: 'Phone number',
  preset_address: 'Address',
  preset_team_four: 'Team information (4 players)',
  preset_team_doubles: 'Doubles team information (2 players)',
  preset_dob: 'Date of birth',
};

export function isPresetFieldType(ft: string): ft is PresetFieldType {
  return (PRESET_FIELD_TYPES as readonly string[]).includes(ft);
}

export function isSubheadingFieldType(ft: string): boolean {
  return ft === 'subheading';
}

export function presetScopeLocked(ft: string): boolean {
  return ft === 'preset_team_four' || ft === 'preset_team_doubles';
}

export const TEAM_POSITIONS_FOUR = ['Lead', 'Second', 'Third', 'Fourth'] as const;
export const TEAM_POSITIONS_DOUBLES = ['Player 1', 'Player 2'] as const;
