import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { dateOfBirthValidationMessage, isMemberMinor, localDateOnly } from '../../utils/memberAge';
import FormField from '../FormField';
import PhysicalAddressCollect from '../PhysicalAddressCollect';
import PreferredPronounsField from '../PreferredPronounsField';
import UsaCurlingCompetitionGenderField from '../UsaCurlingCompetitionGenderField';
import {
  DEFAULT_REGISTRATION_MAILING_COUNTRY,
  DEFAULT_REGISTRATION_MAILING_STATE,
} from '../../utils/registrationMailingAddress';
import type { StructuredPostalAddress } from '../../utils/structuredPostalAddress';

export type RegistrationDemographicsFormFields = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  mailingAddressLine1: string;
  mailingAddressLine2: string;
  mailingCity: string;
  mailingState: string;
  mailingCountry: string;
  mailingPostalCode: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  preferredPronouns: string;
  usaCurlingCompetitionGender: string;
};

type DemographicScalarField = Exclude<
  keyof RegistrationDemographicsFormFields,
  | 'mailingAddressLine1'
  | 'mailingAddressLine2'
  | 'mailingCity'
  | 'mailingState'
  | 'mailingCountry'
  | 'mailingPostalCode'
  | 'preferredPronouns'
  | 'usaCurlingCompetitionGender'
>;

const DEMOGRAPHIC_SCALAR_FIELDS: DemographicScalarField[] = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'email',
  'phone',
  'emergencyContactName',
  'emergencyContactPhone',
];

const MAILING_AUTOCOMPLETE_FIELDS: Array<[string, keyof RegistrationDemographicsFormFields]> = [
  ['address-line1', 'mailingAddressLine1'],
  ['address-line2', 'mailingAddressLine2'],
  ['address-level2', 'mailingCity'],
  ['address-level1', 'mailingState'],
  ['country-name', 'mailingCountry'],
  ['country', 'mailingCountry'],
  ['postal-code', 'mailingPostalCode'],
];

function normalizeRegistrationEmail(email: string): string {
  return email.toLowerCase().trim();
}

function readInputValueById(id: string): string | null {
  const el = document.getElementById(id);
  if (el instanceof HTMLInputElement) return el.value;
  return null;
}

/** Prefer mounted DOM values so autofill and unsynced controlled inputs are included on submit. */
function mergeVisibleDomValues(
  draft: RegistrationDemographicsFormFields,
  idPrefix: string,
  root: HTMLElement | null,
): RegistrationDemographicsFormFields {
  const next = { ...draft };
  for (const field of DEMOGRAPHIC_SCALAR_FIELDS) {
    const fromDom = readInputValueById(`${idPrefix}-${field}`);
    if (fromDom != null) next[field] = fromDom;
  }
  if (!root) return next;
  for (const [autoComplete, field] of MAILING_AUTOCOMPLETE_FIELDS) {
    const el = root.querySelector(`input[autocomplete="${autoComplete}"]`);
    if (el instanceof HTMLInputElement) next[field] = el.value;
  }
  return next;
}

function mailingFromForm(form: RegistrationDemographicsFormFields): StructuredPostalAddress {
  return {
    addressLine1: form.mailingAddressLine1,
    addressLine2: form.mailingAddressLine2,
    city: form.mailingCity,
    state: form.mailingState,
    country: form.mailingCountry,
    postalCode: form.mailingPostalCode,
  };
}

function applyMailingToDraft(
  draft: RegistrationDemographicsFormFields,
  structured: StructuredPostalAddress,
): RegistrationDemographicsFormFields {
  return {
    ...draft,
    mailingAddressLine1: structured.addressLine1,
    mailingAddressLine2: structured.addressLine2,
    mailingCity: structured.city,
    mailingState: structured.state,
    mailingCountry: structured.country,
    mailingPostalCode: structured.postalCode,
  };
}

type DemographicScalarFieldRowProps = {
  field: DemographicScalarField;
  label: string;
  autoComplete: string;
  fieldId: string;
  initialValue: string;
  type: string;
  disabled: boolean;
  className?: string;
  max?: string;
  onFieldChange: (field: DemographicScalarField, value: string) => void;
};

const DemographicScalarFieldRow = memo(function DemographicScalarFieldRow({
  field,
  label,
  autoComplete,
  fieldId,
  initialValue,
  type,
  disabled,
  className,
  max,
  onFieldChange,
}: DemographicScalarFieldRowProps) {
  const [value, setValue] = useState(initialValue);
  const displayedValue = disabled ? initialValue : value;
  const dobError = field === 'dateOfBirth' ? dateOfBirthValidationMessage(displayedValue) : null;

  return (
    <FormField label={label} htmlFor={fieldId} required tone="public" className={className} error={dobError}>
      {({ describedBy, invalid }) => (
        <input
          id={fieldId}
          type={type}
          value={displayedValue}
          onChange={(event) => {
            const nextValue = event.target.value;
            setValue(nextValue);
            onFieldChange(field, nextValue);
          }}
          className="app-input"
          autoComplete={autoComplete}
          required
          disabled={disabled}
          max={max}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
      )}
    </FormField>
  );
});

type DemographicMailingAddressSectionProps = {
  initialValue: RegistrationDemographicsFormFields;
  onMailingChange: (structured: StructuredPostalAddress) => void;
};

const DemographicMailingAddressSection = memo(function DemographicMailingAddressSection({
  initialValue,
  onMailingChange,
}: DemographicMailingAddressSectionProps) {
  const [mailing, setMailing] = useState(() => mailingFromForm(initialValue));

  const handleChange = useCallback(
    (structured: StructuredPostalAddress) => {
      setMailing(structured);
      onMailingChange(structured);
    },
    [onMailingChange],
  );

  return (
    <PhysicalAddressCollect
      className="sm:col-span-6"
      value={mailing}
      onChange={handleChange}
      fillWhenEmpty={{ state: DEFAULT_REGISTRATION_MAILING_STATE, country: DEFAULT_REGISTRATION_MAILING_COUNTRY }}
      entryMode="auto"
      required
      tone="public"
      nominatimContext="membership registration"
    />
  );
});

export type RegistrationDemographicFieldsHandle = {
  getValue: () => RegistrationDemographicsFormFields;
};

export type RegistrationDemographicFieldsProps = {
  initialValue: RegistrationDemographicsFormFields;
  idPrefix?: string;
  lockCurlerEmailToSubmitter?: boolean;
  submitterEmailForCurler?: string;
  onSubmitterEmailMatch?: () => void;
  /** Curler date of birth already stored on the member record. When empty, the form collects an initial value. */
  curlerDateOfBirth?: string | null;
  /** Called on unmount so parent draft state stays aligned when navigating away. */
  onCommit?: (value: RegistrationDemographicsFormFields) => void;
};

const RegistrationDemographicFields = forwardRef<
  RegistrationDemographicFieldsHandle,
  RegistrationDemographicFieldsProps
>(function RegistrationDemographicFields(
  {
    initialValue,
    idPrefix = 'registration',
    lockCurlerEmailToSubmitter = false,
    submitterEmailForCurler = '',
    onSubmitterEmailMatch,
    curlerDateOfBirth = null,
    onCommit,
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<RegistrationDemographicsFormFields>({ ...initialValue });
  const onSubmitterEmailMatchRef = useRef(onSubmitterEmailMatch);
  const onCommitRef = useRef(onCommit);
  const idPrefixRef = useRef(idPrefix);
  const lockEmailRef = useRef(lockCurlerEmailToSubmitter);
  const submitterEmailRef = useRef(submitterEmailForCurler);
  onSubmitterEmailMatchRef.current = onSubmitterEmailMatch;
  onCommitRef.current = onCommit;
  idPrefixRef.current = idPrefix;
  lockEmailRef.current = lockCurlerEmailToSubmitter;
  submitterEmailRef.current = submitterEmailForCurler;

  const [formDateOfBirth, setFormDateOfBirth] = useState(initialValue.dateOfBirth);
  const [preferredPronouns, setPreferredPronouns] = useState(initialValue.preferredPronouns);
  const [usaCurlingCompetitionGender, setUsaCurlingCompetitionGender] = useState(
    initialValue.usaCurlingCompetitionGender || 'Unspecified',
  );

  const readCurrentValue = useCallback((): RegistrationDemographicsFormFields => {
    let next = { ...draftRef.current };
    if (lockEmailRef.current && submitterEmailRef.current) {
      next = { ...next, email: submitterEmailRef.current };
    }
    next = mergeVisibleDomValues(next, idPrefixRef.current, rootRef.current);
    draftRef.current = next;
    return { ...next };
  }, []);

  useEffect(() => {
    if (!lockCurlerEmailToSubmitter || !submitterEmailForCurler) return;
    draftRef.current = { ...draftRef.current, email: submitterEmailForCurler };
  }, [lockCurlerEmailToSubmitter, submitterEmailForCurler]);

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => readCurrentValue(),
    }),
    [readCurrentValue],
  );

  useEffect(() => {
    return () => {
      onCommitRef.current?.(readCurrentValue());
    };
  }, [readCurrentValue]);

  const handleFieldChange = useCallback((field: DemographicScalarField, value: string) => {
    draftRef.current = { ...draftRef.current, [field]: value };
    if (
      field === 'email' &&
      onSubmitterEmailMatchRef.current &&
      submitterEmailForCurler &&
      normalizeRegistrationEmail(value) === normalizeRegistrationEmail(submitterEmailForCurler)
    ) {
      onSubmitterEmailMatchRef.current();
    }
  }, [submitterEmailForCurler]);

  const handleMailingChange = useCallback((structured: StructuredPostalAddress) => {
    draftRef.current = applyMailingToDraft(draftRef.current, structured);
  }, []);

  const effectiveDateOfBirth = curlerDateOfBirth || formDateOfBirth || null;
  const emergencyFieldsDisabled = isMemberMinor(effectiveDateOfBirth);
  const collectDateOfBirth = !curlerDateOfBirth;
  const nameFieldSpan = collectDateOfBirth ? 'sm:col-span-2' : 'sm:col-span-3';

  const handlePreferredPronounsChange = useCallback((value: string) => {
    setPreferredPronouns(value);
    draftRef.current = { ...draftRef.current, preferredPronouns: value };
  }, []);

  const handleCompetitionGenderChange = useCallback((value: string) => {
    setUsaCurlingCompetitionGender(value);
    draftRef.current = { ...draftRef.current, usaCurlingCompetitionGender: value };
  }, []);

  const handleScalarFieldChange = useCallback((field: DemographicScalarField, value: string) => {
    if (field === 'dateOfBirth') {
      setFormDateOfBirth(value);
    }
    handleFieldChange(field, value);
  }, [handleFieldChange]);

  const renderScalarField = (
    field: DemographicScalarField,
    label: string,
    autoComplete: string,
    className: string,
  ) => {
    const emailLocked = field === 'email' && lockCurlerEmailToSubmitter;
    return (
      <DemographicScalarFieldRow
        key={field}
        field={field}
        label={label}
        autoComplete={autoComplete}
        fieldId={`${idPrefix}-${field}`}
        initialValue={emailLocked ? submitterEmailForCurler : initialValue[field]}
        type={field === 'dateOfBirth' ? 'date' : field === 'email' ? 'email' : 'text'}
        disabled={emailLocked}
        className={className}
        max={field === 'dateOfBirth' ? localDateOnly() : undefined}
        onFieldChange={handleScalarFieldChange}
      />
    );
  };

  return (
    <div ref={rootRef} className="grid gap-4 sm:col-span-2 sm:grid-cols-6">
      {renderScalarField('firstName', 'First name', 'given-name', nameFieldSpan)}
      {renderScalarField('lastName', 'Last name', 'family-name', nameFieldSpan)}
      {collectDateOfBirth
        ? renderScalarField('dateOfBirth', 'Date of birth', 'bday', 'sm:col-span-2')
        : null}
      {renderScalarField('email', 'Email address', 'email', 'sm:col-span-3')}
      {renderScalarField('phone', 'Phone number', 'tel', 'sm:col-span-3')}
      <PreferredPronounsField
        id={`${idPrefix}-preferredPronouns`}
        value={preferredPronouns}
        onChange={handlePreferredPronounsChange}
        tone="public"
        className="sm:col-span-3"
      />
      <UsaCurlingCompetitionGenderField
        id={`${idPrefix}-usaCurlingCompetitionGender`}
        value={usaCurlingCompetitionGender}
        onChange={handleCompetitionGenderChange}
        tone="public"
        className="sm:col-span-3"
      />
      {emergencyFieldsDisabled ? (
        <p className="sm:col-span-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Parent or guardian contact information will be collected on the next screen and used as the emergency contact.
        </p>
      ) : (
        <>
          {renderScalarField('emergencyContactName', 'Emergency contact name', 'name', 'sm:col-span-3')}
          {renderScalarField('emergencyContactPhone', 'Emergency contact phone', 'tel', 'sm:col-span-3')}
        </>
      )}
      <DemographicMailingAddressSection initialValue={initialValue} onMailingChange={handleMailingChange} />
    </div>
  );
});

export default RegistrationDemographicFields;
