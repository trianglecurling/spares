import { useMemo } from 'react';
import ChoiceInput, { type ChoiceOption } from '../ChoiceInput';
import FormField from '../FormField';
import PhysicalAddressCollect from '../PhysicalAddressCollect';
import { TeamPlayersField, defaultTeamPlayersJson } from './TeamPlayersField';
import {
  teamFieldOptionsFromRegistrationField,
  TEAM_POSITIONS_DOUBLES,
  TEAM_POSITIONS_FOUR,
  PRESET_BONSPIEL_COMMENTS_HELPER_TEXT,
} from '../../utils/eventRegistrationFieldPresets';
import { structuredPostalFromEventJson, structuredPostalToEventJson } from '../../utils/structuredPostalAddress';

export const publicEventRegistrationInput =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-teal focus:outline-none focus:ring-2 focus:ring-primary-teal/20 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-500 disabled:placeholder:text-gray-400 disabled:opacity-80 disabled:focus:border-gray-200 disabled:focus:ring-0 read-only:cursor-default read-only:border-gray-200 read-only:bg-gray-50 read-only:text-gray-700 read-only:focus:border-gray-300 read-only:focus:ring-0';

export interface EventRegistrationField {
  id: number;
  label: string;
  field_type: string;
  scope: string;
  required: number;
  options: string | null;
  sort_order?: number;
}

export function fieldValueKey(fieldId: number, scope: string, personIndex: number): string {
  if (scope === 'individual') return `${fieldId}-${personIndex}`;
  return String(fieldId);
}

export function personLabel(personIndex: number): string {
  if (personIndex === 0) return 'Primary registrant';
  return `Group member ${personIndex}`;
}

export default function PublicRegistrationFieldInput({
  field,
  fieldGroupKey,
  value,
  onChange,
}: {
  field: EventRegistrationField;
  fieldGroupKey?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const gk = fieldGroupKey ?? String(field.id);
  switch (field.field_type) {
    case 'preset_phone':
      return (
        <FormField tone="public" label={field.label} htmlFor={`field-${gk}`} required={field.required === 1}>
          <input
            id={`field-${gk}`}
            type="tel"
            autoComplete="tel"
            required={field.required === 1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={publicEventRegistrationInput}
            placeholder="Phone number"
          />
        </FormField>
      );
    case 'preset_team_name':
      return (
        <FormField tone="public" label={field.label} htmlFor={`field-${gk}`} required={field.required === 1}>
          <input
            id={`field-${gk}`}
            type="text"
            autoComplete="organization"
            required={field.required === 1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={publicEventRegistrationInput}
            placeholder="Team name"
          />
        </FormField>
      );
    case 'preset_dob':
      return (
        <FormField tone="public" label={field.label} htmlFor={`field-${gk}`} required={field.required === 1}>
          <input
            id={`field-${gk}`}
            type="date"
            required={field.required === 1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={publicEventRegistrationInput}
          />
        </FormField>
      );
    case 'preset_bonspiel_comments':
      return (
        <FormField
          tone="public"
          label={field.label}
          htmlFor={`field-${gk}`}
          required={field.required === 1}
          labelClassName="font-bold"
          helperText={PRESET_BONSPIEL_COMMENTS_HELPER_TEXT}
        >
          <textarea
            id={`field-${gk}`}
            required={field.required === 1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            className={`${publicEventRegistrationInput} min-h-[6rem] resize-y`}
          />
        </FormField>
      );
    case 'preset_address':
      return <PresetAddressField field={field} value={value} onChange={onChange} />;
    case 'preset_team_four':
      return (
        <TeamPlayersField
          label={field.label}
          required={field.required === 1}
          value={value || defaultTeamPlayersJson(4)}
          onChange={onChange}
          positions={TEAM_POSITIONS_FOUR}
          inputClassName={publicEventRegistrationInput}
          lightOnly
          collectDietaryRestrictions={teamFieldOptionsFromRegistrationField(field).collectDietaryRestrictions}
        />
      );
    case 'preset_team_doubles':
      return (
        <TeamPlayersField
          label={field.label}
          required={field.required === 1}
          value={value || defaultTeamPlayersJson(2)}
          onChange={onChange}
          positions={TEAM_POSITIONS_DOUBLES}
          inputClassName={publicEventRegistrationInput}
          lightOnly
          collectDietaryRestrictions={teamFieldOptionsFromRegistrationField(field).collectDietaryRestrictions}
        />
      );
    default:
      return <LegacyRegistrationField field={field} radioGroupName={gk} value={value} onChange={onChange} />;
  }
}

function PresetAddressField({
  field,
  value,
  onChange,
}: {
  field: EventRegistrationField;
  value: string;
  onChange: (value: string) => void;
}) {
  const structured = useMemo(() => structuredPostalFromEventJson(value), [value]);
  return (
    <PhysicalAddressCollect
      sectionTitle={field.label}
      sectionDescription={field.required === 1 ? 'Required' : 'Optional'}
      value={structured}
      onChange={(next) => onChange(structuredPostalToEventJson(next))}
      entryMode="auto"
      required={field.required === 1}
      tone="public"
      textInputClassName={publicEventRegistrationInput}
      nominatimContext="event registration"
      className="space-y-3"
    />
  );
}

function LegacyRegistrationField({
  field,
  radioGroupName,
  value,
  onChange,
}: {
  field: EventRegistrationField;
  radioGroupName: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = field.options ? field.options.split(',').map((o) => o.trim()).filter(Boolean) : [];

  switch (field.field_type) {
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === '1' || value === 'true'}
            onChange={(e) => onChange(e.target.checked ? '1' : '0')}
          />
          <span className="text-sm text-gray-700">
            {field.label}
            {field.required === 1 ? <span className="ml-2 text-xs font-medium text-gray-500">Required</span> : null}
          </span>
        </label>
      );

    case 'dropdown': {
      const dropdownOptions: ChoiceOption<string>[] = options.map((opt) => ({
        value: opt,
        label: opt,
      }));
      return (
        <FormField tone="public" label={field.label} htmlFor={`field-${radioGroupName}`} required={field.required === 1}>
          <ChoiceInput<string>
            inputId={`field-${radioGroupName}`}
            required={field.required === 1}
            options={dropdownOptions}
            value={value || null}
            onChange={(next) => onChange(next == null || Array.isArray(next) ? '' : next)}
            placeholder="Select..."
            listboxLabel={field.label}
            inputClassName={publicEventRegistrationInput}
          />
        </FormField>
      );
    }

    case 'radio':
      return (
        <FormField tone="public" label={field.label} required={field.required === 1}>
          <div className="space-y-1">
            {options.map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={`field-${radioGroupName}`}
                  value={opt}
                  checked={value === opt}
                  onChange={() => onChange(opt)}
                  required={field.required === 1}
                />
                <span className="text-sm text-gray-700">{opt}</span>
              </label>
            ))}
          </div>
        </FormField>
      );

    case 'number':
      return (
        <FormField tone="public" label={field.label} htmlFor={`field-${radioGroupName}`} required={field.required === 1}>
          <input
            id={`field-${radioGroupName}`}
            type="number"
            required={field.required === 1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={publicEventRegistrationInput}
          />
        </FormField>
      );

    default:
      return (
        <FormField tone="public" label={field.label} htmlFor={`field-${radioGroupName}`} required={field.required === 1}>
          <input
            id={`field-${radioGroupName}`}
            type="text"
            required={field.required === 1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={publicEventRegistrationInput}
          />
        </FormField>
      );
  }
}
