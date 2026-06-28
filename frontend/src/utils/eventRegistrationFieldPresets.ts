export const CUSTOM_FIELD_TYPES = ['text', 'number', 'checkbox', 'dropdown', 'radio'] as const;

export const PRESET_FIELD_TYPES = [
  'preset_phone',
  'preset_address',
  'preset_team_name',
  'preset_team_four',
  'preset_team_doubles',
  'preset_dob',
] as const;

export type PresetFieldType = (typeof PRESET_FIELD_TYPES)[number];

export const PRESET_LABELS: Record<PresetFieldType, string> = {
  preset_phone: 'Phone number',
  preset_address: 'Address',
  preset_team_name: 'Team name',
  preset_team_four: 'Team information (4 players)',
  preset_team_doubles: 'Doubles team information (2 players)',
  preset_dob: 'Date of birth',
};

/** Last name from a display name ("Jane Doe" → "Doe"; "Smith, John" → "Smith"). */
export function lastNameFromDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  if (trimmed.includes(',')) {
    return trimmed.split(',')[0]?.trim() ?? '';
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts[parts.length - 1]!.replace(/\.$/, '');
}

export function defaultTeamNameFromDisplayName(name: string): string {
  const lastName = lastNameFromDisplayName(name);
  return defaultTeamNameFromLastName(lastName);
}

export function defaultTeamNameFromLastName(lastName: string): string {
  const trimmed = lastName.trim();
  return trimmed ? `Team ${trimmed}` : '';
}

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
