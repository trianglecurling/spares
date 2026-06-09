/** Defaults for club registration mailing address (curler demographics). */
export const DEFAULT_REGISTRATION_MAILING_STATE = 'North Carolina';
export const DEFAULT_REGISTRATION_MAILING_COUNTRY = 'United States';

export type RegistrationMailingAddressFormFields = {
  mailingAddressLine1: string;
  mailingAddressLine2: string;
  mailingCity: string;
  mailingState: string;
  mailingCountry: string;
  mailingPostalCode: string;
};

export function defaultRegistrationMailingAddressFormFields(): RegistrationMailingAddressFormFields {
  return {
    mailingAddressLine1: '',
    mailingAddressLine2: '',
    mailingCity: '',
    mailingState: DEFAULT_REGISTRATION_MAILING_STATE,
    mailingCountry: DEFAULT_REGISTRATION_MAILING_COUNTRY,
    mailingPostalCode: '',
  };
}

type StoredCanonical = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
};

function storedString(rec: Record<string, unknown>, key: string): string {
  const value = rec[key];
  return typeof value === 'string' ? value : '';
}

function formFromCanonical(c: Partial<StoredCanonical>): RegistrationMailingAddressFormFields {
  return {
    mailingAddressLine1: (c.addressLine1 ?? '').trim(),
    mailingAddressLine2: (c.addressLine2 ?? '').trim(),
    mailingCity: (c.city ?? '').trim(),
    mailingState: (c.state ?? '').trim() || DEFAULT_REGISTRATION_MAILING_STATE,
    mailingCountry: (c.country ?? '').trim() || DEFAULT_REGISTRATION_MAILING_COUNTRY,
    mailingPostalCode: (c.postalCode ?? '').trim(),
  };
}

/** JSON stored in `members.mailing_address` for registration (and parsed on load). */
export function serializeRegistrationMailingAddress(fields: RegistrationMailingAddressFormFields): string {
  const payload: StoredCanonical = {
    addressLine1: fields.mailingAddressLine1.trim(),
    addressLine2: fields.mailingAddressLine2.trim(),
    city: fields.mailingCity.trim(),
    state: fields.mailingState.trim() || DEFAULT_REGISTRATION_MAILING_STATE,
    country: fields.mailingCountry.trim() || DEFAULT_REGISTRATION_MAILING_COUNTRY,
    postalCode: fields.mailingPostalCode.trim(),
  };
  return JSON.stringify(payload);
}

function formFromStoredRecord(rec: Record<string, unknown>): RegistrationMailingAddressFormFields {
  // Member registration uses addressLine1; legacy event preset JSON used `street` for line 1.
  const addressLine1 = storedString(rec, 'addressLine1') || storedString(rec, 'street');
  return formFromCanonical({
    addressLine1,
    addressLine2: storedString(rec, 'addressLine2'),
    city: storedString(rec, 'city'),
    state: storedString(rec, 'state'),
    country: storedString(rec, 'country'),
    postalCode: storedString(rec, 'postalCode'),
  });
}

export function parseRegistrationMailingAddressStored(raw: string | null | undefined): RegistrationMailingAddressFormFields {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return defaultRegistrationMailingAddressFormFields();

  try {
    const o = JSON.parse(trimmed) as unknown;
    if (typeof o !== 'object' || o === null) {
      return { ...defaultRegistrationMailingAddressFormFields(), mailingAddressLine1: trimmed };
    }
    return formFromStoredRecord(o as Record<string, unknown>);
  } catch {
    return { ...defaultRegistrationMailingAddressFormFields(), mailingAddressLine1: trimmed };
  }
}

/** True when required mailing components are filled (used before persisting demographics / guest submit). */
export function registrationMailingAddressIsComplete(fields: RegistrationMailingAddressFormFields): boolean {
  return (
    fields.mailingAddressLine1.trim() !== '' &&
    fields.mailingCity.trim() !== '' &&
    fields.mailingPostalCode.trim() !== ''
  );
}
