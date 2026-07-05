import { EventServiceError } from './eventServiceError.js';

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

export const PRESET_LABELS: Record<PresetFieldType | 'subheading', string> = {
  subheading: 'Section heading',
  preset_phone: 'Phone number',
  preset_address: 'Address',
  preset_team_name: 'Team name',
  preset_team_four: 'Team information (4 players)',
  preset_team_doubles: 'Doubles team information (2 players)',
  preset_dob: 'Date of birth',
  preset_bonspiel_comments: 'Questions/Comments?',
};

export function isPresetFieldType(ft: string): ft is PresetFieldType {
  return (PRESET_FIELD_TYPES as readonly string[]).includes(ft);
}

export function isSubheadingFieldType(ft: string): boolean {
  return ft === 'subheading';
}

/** Preset team blocks must stay group-scoped. */
export function presetScopeLocked(ft: string): boolean {
  return ft === 'preset_team_four' || ft === 'preset_team_doubles';
}

export function isTeamPresetFieldType(ft: string): boolean {
  return ft === 'preset_team_four' || ft === 'preset_team_doubles';
}

const TEAM_DIETARY_KEYS = ['vegetarian', 'glutenFree', 'dairyFree'] as const;

function normalizeTeamFieldOptions(options: string | null | undefined): string | null {
  if (!options?.trim()) return null;
  try {
    const parsed = JSON.parse(options) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const collectDietaryRestrictions = (parsed as Record<string, unknown>).collectDietaryRestrictions === true;
    return collectDietaryRestrictions ? JSON.stringify({ collectDietaryRestrictions: true }) : null;
  } catch {
    return null;
  }
}

function validateTeamPlayerRow(row: unknown, fieldLabel: string): void {
  if (typeof row !== 'object' || row === null) {
    throw new EventServiceError(`Invalid team data for "${fieldLabel}"`, 400);
  }
  const r = row as Record<string, unknown>;
  if (typeof r.name !== 'string' || typeof r.email !== 'string' || typeof r.homeClub !== 'string') {
    throw new EventServiceError(`Invalid team data for "${fieldLabel}"`, 400);
  }
  for (const key of TEAM_DIETARY_KEYS) {
    if (r[key] != null && typeof r[key] !== 'boolean') {
      throw new EventServiceError(`Invalid team data for "${fieldLabel}"`, 400);
    }
  }
}

export function normalizeRegistrationFieldRow(field: {
  label: string;
  fieldType: string;
  scope?: string;
  required?: boolean;
  options?: string | null;
  sortOrder?: number;
}): {
  label: string;
  fieldType: string;
  scope: 'group' | 'individual';
  required: boolean;
  options: string | null;
  sortOrder?: number;
} {
  const ft = field.fieldType;
  if (isSubheadingFieldType(ft)) {
    return {
      label: field.label.trim() || 'Section',
      fieldType: 'subheading',
      scope: 'group',
      required: false,
      options: null,
      sortOrder: field.sortOrder,
    };
  }
  if (isPresetFieldType(ft)) {
    const scope = presetScopeLocked(ft) ? 'group' : (field.scope === 'individual' ? 'individual' : 'group');
    const options = isTeamPresetFieldType(ft) ? normalizeTeamFieldOptions(field.options) : null;
    return {
      label: PRESET_LABELS[ft],
      fieldType: ft,
      scope,
      required: !!field.required,
      options,
      sortOrder: field.sortOrder,
    };
  }
  return {
    label: field.label,
    fieldType: ft,
    scope: field.scope === 'individual' ? 'individual' : 'group',
    required: !!field.required,
    options: field.options ?? null,
    sortOrder: field.sortOrder,
  };
}

export function assertNoDuplicatePresets(
  fields: Array<{ fieldType: string }>
): void {
  const seen = new Set<string>();
  for (const f of fields) {
    if (!isPresetFieldType(f.fieldType)) continue;
    if (seen.has(f.fieldType)) {
      throw new EventServiceError(`Duplicate pre-defined field: ${PRESET_LABELS[f.fieldType as PresetFieldType]}`, 400);
    }
    seen.add(f.fieldType);
  }
}

type RegistrationFieldRow = {
  id: number;
  field_type: string;
  scope: string;
  required: number;
  label: string;
};

function valueSatisfiesRequired(fieldRow: RegistrationFieldRow, raw: string): boolean {
  if (fieldRow.field_type === 'checkbox') {
    return raw === '1' || raw.toLowerCase() === 'true';
  }
  if (fieldRow.field_type === 'preset_address') {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      return (
        String(o.street ?? '').trim() !== '' ||
        String(o.city ?? '').trim() !== '' ||
        String(o.state ?? '').trim() !== '' ||
        String(o.postalCode ?? '').trim() !== '' ||
        String(o.country ?? '').trim() !== ''
      );
    } catch {
      return false;
    }
  }
  if (fieldRow.field_type === 'preset_team_four' || fieldRow.field_type === 'preset_team_doubles') {
    try {
      const a = JSON.parse(raw) as unknown[];
      if (!Array.isArray(a)) return false;
      return a.every((row) => {
        const r = row as Record<string, unknown>;
        return typeof r?.name === 'string' && r.name.trim() !== '';
      });
    } catch {
      return false;
    }
  }
  return raw.trim() !== '';
}

export function validateRegistrationFieldValues(args: {
  fields: RegistrationFieldRow[];
  fieldValues: Array<{
    fieldId: number;
    registrationMemberId?: number | null;
    registrationMemberIndex?: number | null;
    value: string;
  }>;
  groupMemberCount: number;
}): void {
  const { fields, fieldValues, groupMemberCount } = args;
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const totalPeople = 1 + groupMemberCount;

  const seen = new Set<string>();
  for (const fv of fieldValues) {
    const field = fieldById.get(fv.fieldId);
    if (!field) {
      throw new EventServiceError('Invalid custom field in submission', 400);
    }
    if (isSubheadingFieldType(field.field_type)) {
      continue;
    }

    const idx = fv.registrationMemberIndex;
    if (field.scope === 'individual') {
      if (idx == null) {
        throw new EventServiceError(`Missing person index for field "${field.label}"`, 400);
      }
      if (idx < 0 || idx >= totalPeople) {
        throw new EventServiceError(`Invalid person index for field "${field.label}"`, 400);
      }
    } else if (idx != null && idx !== 0) {
      throw new EventServiceError(`Unexpected person index for group field "${field.label}"`, 400);
    }

    const dedupeKey = `${fv.fieldId}:${field.scope === 'individual' ? idx ?? 0 : 'g'}`;
    if (seen.has(dedupeKey)) {
      throw new EventServiceError(`Duplicate value for field "${field.label}"`, 400);
    }
    seen.add(dedupeKey);

    validateValueForFieldType(field, fv.value);
  }

  for (const field of fields) {
    if (isSubheadingFieldType(field.field_type) || !field.required) continue;
    if (field.scope === 'group') {
      const has = fieldValues.some(
        (fv) =>
          fv.fieldId === field.id &&
          (fv.registrationMemberIndex == null || fv.registrationMemberIndex === 0) &&
          valueSatisfiesRequired(field, fv.value)
      );
      if (!has) {
        throw new EventServiceError(`Missing required field: ${field.label}`, 400);
      }
    } else {
      for (let p = 0; p < totalPeople; p += 1) {
        const has = fieldValues.some(
          (fv) => fv.fieldId === field.id && fv.registrationMemberIndex === p && valueSatisfiesRequired(field, fv.value)
        );
        if (!has) {
          throw new EventServiceError(`Missing required field: ${field.label} (person ${p + 1})`, 400);
        }
      }
    }
  }
}

function validateValueForFieldType(field: RegistrationFieldRow, value: string): void {
  const ft = field.field_type;
  if (value.length > 50000) {
    throw new EventServiceError(`Field "${field.label}" is too long`, 400);
  }

  switch (ft) {
    case 'preset_phone':
    case 'preset_team_name':
    case 'preset_bonspiel_comments':
    case 'text':
    case 'number':
    case 'checkbox':
    case 'dropdown':
    case 'radio':
      return;
    case 'preset_dob': {
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new EventServiceError(`Invalid date for "${field.label}"`, 400);
      }
      return;
    }
    case 'preset_address': {
      if (!value.trim()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new EventServiceError(`Invalid address data for "${field.label}"`, 400);
      }
      if (typeof parsed !== 'object' || parsed === null) {
        throw new EventServiceError(`Invalid address data for "${field.label}"`, 400);
      }
      const o = parsed as Record<string, unknown>;
      for (const k of ['street', 'city', 'state', 'postalCode', 'country']) {
        if (o[k] != null && typeof o[k] !== 'string') {
          throw new EventServiceError(`Invalid address data for "${field.label}"`, 400);
        }
      }
      return;
    }
    case 'preset_team_four':
    case 'preset_team_doubles': {
      if (!value.trim()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new EventServiceError(`Invalid team data for "${field.label}"`, 400);
      }
      if (!Array.isArray(parsed)) {
        throw new EventServiceError(`Invalid team data for "${field.label}"`, 400);
      }
      const want = ft === 'preset_team_four' ? 4 : 2;
      if (parsed.length !== want) {
        throw new EventServiceError(`Invalid team data for "${field.label}"`, 400);
      }
      for (const row of parsed) {
        validateTeamPlayerRow(row, field.label);
      }
      return;
    }
    default:
      return;
  }
}
