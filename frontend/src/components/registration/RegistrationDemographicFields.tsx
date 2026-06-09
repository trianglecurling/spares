import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import FormField from '../FormField';
import PhysicalAddressCollect from '../PhysicalAddressCollect';
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
};

type DemographicScalarField = Exclude<
  keyof RegistrationDemographicsFormFields,
  | 'mailingAddressLine1'
  | 'mailingAddressLine2'
  | 'mailingCity'
  | 'mailingState'
  | 'mailingCountry'
  | 'mailingPostalCode'
>;

const DEMOGRAPHIC_ROWS: Array<[DemographicScalarField, string, string]> = [
  ['firstName', 'First name', 'given-name'],
  ['lastName', 'Last name', 'family-name'],
  ['dateOfBirth', 'Date of birth', 'bday'],
  ['email', 'Email address', 'email'],
  ['phone', 'Phone number', 'tel'],
  ['emergencyContactName', 'Emergency contact name', 'name'],
  ['emergencyContactPhone', 'Emergency contact phone', 'tel'],
];

function normalizeRegistrationEmail(email: string): string {
  return email.toLowerCase().trim();
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
  onFieldChange,
}: DemographicScalarFieldRowProps) {
  const [value, setValue] = useState(initialValue);

  return (
    <FormField label={label} htmlFor={fieldId} required tone="public">
      <input
        id={fieldId}
        type={type}
        value={disabled ? initialValue : value}
        onChange={(event) => {
          const nextValue = event.target.value;
          setValue(nextValue);
          onFieldChange(field, nextValue);
        }}
        className="app-input"
        autoComplete={autoComplete}
        required
        disabled={disabled}
      />
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
      className="sm:col-span-2"
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
    onCommit,
  },
  ref,
) {
  const draftRef = useRef<RegistrationDemographicsFormFields>({ ...initialValue });
  const onSubmitterEmailMatchRef = useRef(onSubmitterEmailMatch);
  const onCommitRef = useRef(onCommit);
  onSubmitterEmailMatchRef.current = onSubmitterEmailMatch;
  onCommitRef.current = onCommit;

  useEffect(() => {
    draftRef.current = { ...initialValue };
  }, [initialValue]);

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => ({ ...draftRef.current }),
    }),
    [],
  );

  useEffect(() => {
    return () => {
      onCommitRef.current?.({ ...draftRef.current });
    };
  }, []);

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

  return (
    <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      {DEMOGRAPHIC_ROWS.map(([field, label, autoComplete]) => {
        const fieldId = `${idPrefix}-${String(field)}`;
        const emailLocked = field === 'email' && lockCurlerEmailToSubmitter;
        return (
          <DemographicScalarFieldRow
            key={field}
            field={field}
            label={label}
            autoComplete={autoComplete}
            fieldId={fieldId}
            initialValue={emailLocked ? submitterEmailForCurler : initialValue[field]}
            type={field === 'dateOfBirth' ? 'date' : field === 'email' ? 'email' : 'text'}
            disabled={emailLocked}
            onFieldChange={handleFieldChange}
          />
        );
      })}
      <DemographicMailingAddressSection initialValue={initialValue} onMailingChange={handleMailingChange} />
    </div>
  );
});

export default RegistrationDemographicFields;
