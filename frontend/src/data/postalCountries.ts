/**
 * English short country names (ISO-oriented), from {@link ./postalCountries.json}.
 * To refresh: `curl -sL 'https://restcountries.com/v3.1/all?fields=name' | ...` and replace the JSON file.
 */
import raw from './postalCountries.json';

export const POSTAL_COUNTRY_NAMES: readonly string[] = raw as string[];
