/** US states and DC — full names to align with Nominatim `address.state` for domestic results. */
export const US_STATE_NAMES: readonly string[] = [
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'District of Columbia',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Virginia',
  'Washington',
  'West Virginia',
  'Wisconsin',
  'Wyoming',
];

/** Canadian provinces and territories (common English names). */
export const CANADA_SUBDIVISION_NAMES: readonly string[] = [
  'Alberta',
  'British Columbia',
  'Manitoba',
  'New Brunswick',
  'Newfoundland and Labrador',
  'Northwest Territories',
  'Nova Scotia',
  'Nunavut',
  'Ontario',
  'Prince Edward Island',
  'Quebec',
  'Saskatchewan',
  'Yukon',
];

export type PostalCountryBucket = 'US' | 'CA' | 'OTHER';

export function postalCountryBucket(country: string): PostalCountryBucket {
  const c = country.trim().toLowerCase();
  if (c === 'united states' || c === 'united states of america' || c === 'usa') return 'US';
  if (c === 'canada') return 'CA';
  return 'OTHER';
}

export function postalSubdivisionNamesForCountry(country: string): readonly string[] {
  const b = postalCountryBucket(country);
  if (b === 'US') return US_STATE_NAMES;
  if (b === 'CA') return CANADA_SUBDIVISION_NAMES;
  return [];
}
