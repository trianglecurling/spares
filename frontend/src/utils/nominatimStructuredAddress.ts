import type { StructuredPostalAddress } from './structuredPostalAddress';

export type NominatimSearchItem = {
  display_name?: string;
  name?: string;
  address?: Record<string, string>;
};

const NOMINATIM_STREET_KEYS = [
  'road',
  'street',
  'pedestrian',
  'footway',
  'path',
  'cycleway',
  'residential',
  'tertiary',
  'secondary',
  'primary',
] as const;

function streetFromNominatimAddress(address: Record<string, string>): string {
  for (const key of NOMINATIM_STREET_KEYS) {
    const value = (address[key] ?? '').trim();
    if (value) return value;
  }
  return '';
}

function line1FromDisplayName(
  displayName: string,
  city: string,
  state: string,
  postalCode: string,
  country: string,
): string {
  const segments = displayName
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return '';

  const cityLower = city.trim().toLowerCase();
  const stateLower = state.trim().toLowerCase();
  const countryLower = country.trim().toLowerCase();
  const postal = postalCode.trim();
  const collected: string[] = [];

  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (cityLower && lower === cityLower) break;
    if (stateLower && lower === stateLower) break;
    if (countryLower && lower === countryLower) break;
    if (postal && (lower === postal.toLowerCase() || segment.includes(postal))) break;
    if (/ county$/i.test(segment)) continue;
    collected.push(segment);
  }

  return collected.join(', ').trim();
}

/** Map OSM address details to our structured postal shape (line 2 not provided by forward geocode). */
export function nominatimItemToStructuredAddress(
  item: NominatimSearchItem,
  fillWhenEmpty?: { state?: string; country?: string },
): StructuredPostalAddress {
  const a = item.address ?? {};
  const street = streetFromNominatimAddress(a);
  const houseNumber = (a.house_number ?? '').trim();
  const houseName = (a.house_name ?? '').trim();
  let addressLine1 = [houseNumber, street].filter(Boolean).join(' ').trim();

  if (!addressLine1 && houseName) {
    addressLine1 = [houseNumber, houseName].filter(Boolean).join(' ').trim();
  }
  if (!addressLine1 && street) {
    addressLine1 = street;
  }

  const city = a.city || a.town || a.village || a.hamlet || a.municipality || '';
  let state = (a.state ?? '').trim();
  let country = (a.country ?? '').trim();
  const postalCode = (a.postcode ?? '').trim();

  const fd = fillWhenEmpty;
  if (fd) {
    if (!state && fd.state) state = fd.state;
    if (!country && fd.country) country = fd.country;
  }

  if (!addressLine1) {
    const namedLine = (item.name ?? '').trim();
    if (namedLine && namedLine.toLowerCase() !== city.trim().toLowerCase()) {
      addressLine1 = namedLine;
    }
  }

  if (!addressLine1 && item.display_name) {
    addressLine1 = line1FromDisplayName(item.display_name, city, state, postalCode, country);
  }

  return {
    addressLine1,
    addressLine2: '',
    city,
    state,
    country,
    postalCode,
  };
}
