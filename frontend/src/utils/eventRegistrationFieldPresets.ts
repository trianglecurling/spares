export const CUSTOM_FIELD_TYPES = ['text', 'number', 'checkbox', 'dropdown', 'radio'] as const;

export const PRESET_FIELD_TYPES = [
  'preset_phone',
  'preset_address',
  'preset_team_name',
  'preset_team_four',
  'preset_team_doubles',
  'preset_dob',
  'preset_bonspiel_comments',
] as const;

export type PresetFieldType = (typeof PRESET_FIELD_TYPES)[number];

export const PRESET_LABELS: Record<PresetFieldType, string> = {
  preset_phone: 'Phone number',
  preset_address: 'Address',
  preset_team_name: 'Team name',
  preset_team_four: 'Team information (4 players)',
  preset_team_doubles: 'Doubles team information (2 players)',
  preset_dob: 'Date of birth',
  preset_bonspiel_comments: 'Questions/Comments?',
};

/** Admin menu label when it should differ from the public form label. */
export const PRESET_MENU_LABELS: Partial<Record<PresetFieldType, string>> = {
  preset_bonspiel_comments: 'Bonspiel comments',
};

export const PRESET_BONSPIEL_COMMENTS_HELPER_TEXT =
  'While we try to honor requests for draw times, we can make no guarantees at this time. Any additional food allergies may be listed here.';

export function presetMenuLabel(ft: PresetFieldType): string {
  return PRESET_MENU_LABELS[ft] ?? PRESET_LABELS[ft];
}

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

export const DIETARY_RESTRICTION_KEYS = ['vegetarian', 'glutenFree', 'dairyFree'] as const;
export type DietaryRestrictionKey = (typeof DIETARY_RESTRICTION_KEYS)[number];

export const DIETARY_RESTRICTION_LABELS: Record<DietaryRestrictionKey, string> = {
  vegetarian: 'Vegetarian',
  glutenFree: 'Gluten free',
  dairyFree: 'Dairy free',
};

export type TeamPlayerRow = {
  name: string;
  email: string;
  homeClub: string;
  vegetarian?: boolean;
  glutenFree?: boolean;
  dairyFree?: boolean;
};

export type TeamFieldOptions = {
  collectDietaryRestrictions: boolean;
};

export function isTeamPresetFieldType(ft: string): boolean {
  return ft === 'preset_team_four' || ft === 'preset_team_doubles';
}

export function parseTeamFieldOptions(options: string | null | undefined): TeamFieldOptions {
  if (!options?.trim()) return { collectDietaryRestrictions: false };
  try {
    const parsed = JSON.parse(options) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return { collectDietaryRestrictions: false };
    }
    const o = parsed as Record<string, unknown>;
    return { collectDietaryRestrictions: o.collectDietaryRestrictions === true };
  } catch {
    return { collectDietaryRestrictions: false };
  }
}

export function serializeTeamFieldOptions(options: TeamFieldOptions): string | null {
  if (!options.collectDietaryRestrictions) return null;
  return JSON.stringify({ collectDietaryRestrictions: true });
}

export function teamFieldOptionsFromRegistrationField(field: {
  fieldType?: string;
  field_type?: string;
  options?: string | null;
}): TeamFieldOptions {
  const fieldType = field.fieldType ?? field.field_type ?? '';
  if (!isTeamPresetFieldType(fieldType)) return { collectDietaryRestrictions: false };
  return parseTeamFieldOptions(field.options);
}

export function parseTeamPlayersJson(value: string, rowCount: number): TeamPlayerRow[] {
  const emptyRow = (): TeamPlayerRow => ({ name: '', email: '', homeClub: '' });
  if (!value.trim()) return Array.from({ length: rowCount }, emptyRow);
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== rowCount) {
      return Array.from({ length: rowCount }, emptyRow);
    }
    return parsed.map((row: unknown) => {
      const o = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
      const next: TeamPlayerRow = {
        name: typeof o.name === 'string' ? o.name : '',
        email: typeof o.email === 'string' ? o.email : '',
        homeClub: typeof o.homeClub === 'string' ? o.homeClub : '',
      };
      for (const key of DIETARY_RESTRICTION_KEYS) {
        if (o[key] === true) next[key] = true;
      }
      return next;
    });
  } catch {
    return Array.from({ length: rowCount }, emptyRow);
  }
}

export function countDietaryRestrictionsFromTeamValue(value: string): Record<DietaryRestrictionKey, number> {
  const counts: Record<DietaryRestrictionKey, number> = {
    vegetarian: 0,
    glutenFree: 0,
    dairyFree: 0,
  };
  if (!value.trim()) return counts;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return counts;
    for (const row of parsed) {
      const o = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
      for (const key of DIETARY_RESTRICTION_KEYS) {
        if (o[key] === true) counts[key] += 1;
      }
    }
  } catch {
    // ignore malformed values
  }
  return counts;
}

export function emptyDietaryRestrictionCounts(): Record<DietaryRestrictionKey, number> {
  return { vegetarian: 0, glutenFree: 0, dairyFree: 0 };
}

export function addDietaryCounts(
  left: Record<DietaryRestrictionKey, number>,
  right: Record<DietaryRestrictionKey, number>,
): Record<DietaryRestrictionKey, number> {
  const next = { ...left };
  for (const key of DIETARY_RESTRICTION_KEYS) {
    next[key] += right[key];
  }
  return next;
}

export function playerHasDietaryRestrictions(row: TeamPlayerRow): boolean {
  return DIETARY_RESTRICTION_KEYS.some((key) => row[key] === true);
}
