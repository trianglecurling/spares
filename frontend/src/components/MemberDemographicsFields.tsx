import { useMemo, type Dispatch, type SetStateAction } from 'react';
import FormField from './FormField';
import PhysicalAddressCollect from './PhysicalAddressCollect';
import PreferredPronounsField from './PreferredPronounsField';
import UsaCurlingCompetitionGenderField from './UsaCurlingCompetitionGenderField';
import {
  DEFAULT_REGISTRATION_MAILING_COUNTRY,
  DEFAULT_REGISTRATION_MAILING_STATE,
} from '../utils/registrationMailingAddress';
import type { MemberDemographicsFormFields } from '../utils/memberDemographicsForm';

type DemographicScalarField = Exclude<
  keyof MemberDemographicsFormFields,
  | keyof import('../utils/registrationMailingAddress').RegistrationMailingAddressFormFields
  | 'preferredPronouns'
  | 'usaCurlingCompetitionGender'
>;

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
  const showPersonal = section === 'personal' || section === 'all';
  const showEmergency = section === 'emergency' || section === 'all';
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

  const renderScalarField = (
    field: DemographicScalarField,
    label: string,
    autoComplete: string,
    className: string,
  ) => {
    const fieldId = `${idPrefix}-${String(field)}`;
    const lockDob = field === 'dateOfBirth' && lockDateOfBirth;
    return (
      <FormField key={field} label={label} htmlFor={fieldId} required={!lockDob} tone={tone} className={className}>
        <input
          id={fieldId}
          type={lockDob ? 'text' : field === 'dateOfBirth' ? 'date' : field === 'email' ? 'email' : 'text'}
          value={value[field]}
          onChange={lockDob ? undefined : (event) => setField(field)(event.target.value)}
          readOnly={lockDob}
          autoComplete={autoComplete}
          className="app-input"
          required={!lockDob}
        />
      </FormField>
    );
  };

  return (
    <div className="grid gap-4 sm:grid-cols-6">
      {showPersonal ? (
        <>
          {renderScalarField('firstName', 'First name', 'given-name', 'sm:col-span-2')}
          {renderScalarField('lastName', 'Last name', 'family-name', 'sm:col-span-2')}
          {renderScalarField('dateOfBirth', 'Date of birth', 'bday', 'sm:col-span-2')}
          {renderScalarField('phone', 'Phone number', 'tel', 'sm:col-span-3')}
          <PreferredPronounsField
            id={`${idPrefix}-preferredPronouns`}
            value={value.preferredPronouns}
            onChange={(next) => onChange((current) => ({ ...current, preferredPronouns: next }))}
            tone={tone}
            className="sm:col-span-3 sm:col-start-1"
          />
          <UsaCurlingCompetitionGenderField
            id={`${idPrefix}-usaCurlingCompetitionGender`}
            value={value.usaCurlingCompetitionGender}
            onChange={(next) => onChange((current) => ({ ...current, usaCurlingCompetitionGender: next }))}
            tone={tone}
            className="sm:col-span-3"
          />
        </>
      ) : null}
      {showEmergency ? (
        <>
          {renderScalarField('emergencyContactName', 'Emergency contact name', 'name', 'sm:col-span-3')}
          {renderScalarField('emergencyContactPhone', 'Emergency contact phone', 'tel', 'sm:col-span-3')}
        </>
      ) : null}
      {showMailingAddress ? (
        <PhysicalAddressCollect
          className="sm:col-span-6"
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
