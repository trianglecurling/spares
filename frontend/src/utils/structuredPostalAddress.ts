/** Canonical structured postal/mailing address for shared UI and JSON persistence. */
export type StructuredPostalAddress = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
};

export function emptyStructuredPostalAddress(
  defaults?: Partial<Pick<StructuredPostalAddress, 'state' | 'country'>>,
): StructuredPostalAddress {
  return {
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: defaults?.state?.trim() ?? '',
    country: defaults?.country?.trim() ?? '',
    postalCode: '',
  };
}

export function formatStructuredPostalOneLine(a: StructuredPostalAddress): string {
  const line1 = a.addressLine1.trim();
  const line2 = a.addressLine2.trim();
  const city = a.city.trim();
  const state = a.state.trim();
  const postal = a.postalCode.trim();
  const country = a.country.trim();
  const cityState = [city, [state, postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [line1, line2, cityState, country].filter(Boolean).join(', ');
}

export function structuredPostalHasMeaningfulLocation(a: StructuredPostalAddress): boolean {
  return (
    a.addressLine1.trim() !== '' ||
    a.addressLine2.trim() !== '' ||
    a.city.trim() !== '' ||
    a.postalCode.trim() !== ''
  );
}

/** Event registration `preset_address` JSON uses `street` instead of `addressLine1`. */
export function structuredPostalFromEventJson(value: string): StructuredPostalAddress {
  const empty = emptyStructuredPostalAddress();
  if (!value.trim()) return empty;
  try {
    const o = JSON.parse(value) as Record<string, unknown>;
    if (typeof o !== 'object' || o === null) return empty;
    const line1 =
      (typeof o.street === 'string' && o.street) ||
      (typeof o.addressLine1 === 'string' && o.addressLine1) ||
      '';
    return {
      addressLine1: line1,
      addressLine2: typeof o.addressLine2 === 'string' ? o.addressLine2 : '',
      city: typeof o.city === 'string' ? o.city : '',
      state: typeof o.state === 'string' ? o.state : '',
      country: typeof o.country === 'string' ? o.country : '',
      postalCode: typeof o.postalCode === 'string' ? o.postalCode : '',
    };
  } catch {
    return empty;
  }
}

export function structuredPostalToEventJson(a: StructuredPostalAddress): string {
  return JSON.stringify({
    street: a.addressLine1.trim(),
    addressLine2: a.addressLine2.trim(),
    city: a.city.trim(),
    state: a.state.trim(),
    postalCode: a.postalCode.trim(),
    country: a.country.trim(),
  });
}
