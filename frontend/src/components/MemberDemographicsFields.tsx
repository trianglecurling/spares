import { useMemo, type Dispatch, type SetStateAction } from 'react';
import FormField from './FormField';
import PhysicalAddressCollect from './PhysicalAddressCollect';
import {
  DEFAULT_REGISTRATION_MAILING_COUNTRY,
  DEFAULT_REGISTRATION_MAILING_STATE,
} from '../utils/registrationMailingAddress';
import type { MemberDemographicsFormFields } from '../utils/memberDemographicsForm';

type DemographicScalarField = Exclude<
  keyof MemberDemographicsFormFields,
  keyof import('../utils/registrationMailingAddress').RegistrationMailingAddressFormFields
>;

const PERSONAL_ROWS: Array<[DemographicScalarField, string, string]> = [
  ['firstName', 'First name', 'given-name'],
  ['lastName', 'Last name', 'family-name'],
  ['dateOfBirth', 'Date of birth', 'bday'],
  ['phone', 'Phone number', 'tel'],
];

const EMERGENCY_ROWS: Array<[DemographicScalarField, string, string]> = [
  ['emergencyContactName', 'Emergency contact name', 'name'],
  ['emergencyContactPhone', 'Emergency contact phone', 'tel'],
];

export type MemberDemographicsFieldsSection = 'personal' | 'emergency' | 'all';

export type MemberDemographicsFieldsProps = {
  value: MemberDemographicsFormFields;
  onChange: Dispatch<SetStateAction<MemberDemographicsFormFields>>;
  idPrefix?: string;
  tone?: 'public' | 'app';
  section?: MemberDemographicsFieldsSection;
  /** When true, date of birth is shown read-only (already set on the member record). */
  lockDateOfBirth?: boolean;
};

export default function MemberDemographicsFields({
  value,
  onChange,
  idPrefix = 'member-demographics',
  tone = 'app',
  section = 'all',
  lockDateOfBirth = false,
}: MemberDemographicsFieldsProps) {
  const scalarRows =
    section === 'personal'
      ? PERSONAL_ROWS
      : section === 'emergency'
        ? EMERGENCY_ROWS
        : [...PERSONAL_ROWS, ...EMERGENCY_ROWS];
  const showMailingAddress = section === 'personal' || section === 'all';
  const mailingStructuredAddress = useMemo(
    () => ({
      addressLine1: value.mailingAddressLine1,
      addressLine2: value.mailingAddressLine2,
      city: value.mailingCity,
      state: value.mailingState,
      country: value.mailingCountry,
      postalCode: value.mailingPostalCode,
    }),
    [
      value.mailingAddressLine1,
      value.mailingAddressLine2,
      value.mailingCity,
      value.mailingState,
      value.mailingCountry,
      value.mailingPostalCode,
    ],
  );

  const setField = (field: DemographicScalarField) => (fieldValue: string) => {
    onChange((current) => ({ ...current, [field]: fieldValue }));
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {scalarRows.map(([field, label, autoComplete]) => {
        const fieldId = `${idPrefix}-${String(field)}`;
        if (field === 'dateOfBirth' && lockDateOfBirth) {
          return (
            <FormField key={field} label={label} htmlFor={fieldId} tone={tone}>
              <input
                id={fieldId}
                type="text"
                value={value.dateOfBirth}
                readOnly
                className="app-input"
              />
            </FormField>
          );
        }
        return (
          <FormField key={field} label={label} htmlFor={fieldId} required tone={tone}>
            <input
              id={fieldId}
              type={field === 'dateOfBirth' ? 'date' : field === 'email' ? 'email' : 'text'}
              value={value[field]}
              onChange={(event) => setField(field)(event.target.value)}
              autoComplete={autoComplete}
              className="app-input"
              required={field !== 'dateOfBirth' || !lockDateOfBirth}
            />
          </FormField>
        );
      })}
      {showMailingAddress ? (
        <PhysicalAddressCollect
          className="sm:col-span-2"
          value={mailingStructuredAddress}
          onChange={(structured) =>
            onChange((current) => ({
              ...current,
              mailingAddressLine1: structured.addressLine1,
              mailingAddressLine2: structured.addressLine2,
              mailingCity: structured.city,
              mailingState: structured.state,
              mailingCountry: structured.country,
              mailingPostalCode: structured.postalCode,
            }))
          }
          fillWhenEmpty={{
            state: DEFAULT_REGISTRATION_MAILING_STATE,
            country: DEFAULT_REGISTRATION_MAILING_COUNTRY,
          }}
          entryMode="auto"
          required
          tone={tone}
          nominatimContext="member profile"
        />
      ) : null}
    </div>
  );
}
