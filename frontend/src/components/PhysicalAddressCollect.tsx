import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import AutocompleteInput from './AutocompleteInput';
import ChoiceInput, { type ChoiceOption } from './ChoiceInput';
import FormField from './FormField';
import FormSection from './FormSection';
import { POSTAL_COUNTRY_NAMES } from '../data/postalCountries';
import { postalSubdivisionNamesForCountry } from '../data/postalSubdivisions';
import { nominatimItemToStructuredAddress, type NominatimSearchItem } from '../utils/nominatimStructuredAddress';
import {
  emptyStructuredPostalAddress,
  structuredPostalHasMeaningfulLocation,
  type StructuredPostalAddress,
} from '../utils/structuredPostalAddress';

const NOMINATIM_DEBOUNCE_MS = 450;
const COUNTRY_SELECT_OPTIONS: ChoiceOption<string>[] = POSTAL_COUNTRY_NAMES.map((name) => ({
  value: name,
  label: name,
}));

export type PhysicalAddressEntryMode = 'auto' | 'search' | 'manual';

export type PhysicalAddressCollectProps = {
  value: StructuredPostalAddress;
  onChange: (next: StructuredPostalAddress) => void;
  fillWhenEmpty?: { state?: string; country?: string };
  entryMode?: PhysicalAddressEntryMode;
  required?: boolean;
  tone?: 'public' | 'app';
  sectionTitle?: ReactNode;
  sectionDescription?: ReactNode;
  className?: string;
  textInputClassName?: string;
  nominatimContext?: string;
};

type AddressView = 'search' | 'manual';
type Suggestion = { label: string; structured: StructuredPostalAddress };

function singleChoiceText(v: string | string[] | null): string {
  if (v == null) return '';
  return Array.isArray(v) ? (v[0] ?? '').toString() : v;
}

function initialView(value: StructuredPostalAddress, entryMode: PhysicalAddressEntryMode): AddressView {
  if (entryMode === 'manual') return 'manual';
  if (entryMode === 'search') return 'search';
  return structuredPostalHasMeaningfulLocation(value) ? 'manual' : 'search';
}

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const StateProvinceField = memo(function StateProvinceField({
  id,
  tone,
  required,
  textInputClassName,
  useDropdown,
  options,
  value,
  onSelect,
  onTextChange,
}: {
  id: string;
  tone: 'public' | 'app';
  required: boolean;
  textInputClassName: string;
  useDropdown: boolean;
  options: ChoiceOption<string>[];
  value: string;
  onSelect: (value: string | string[] | null) => void;
  onTextChange: (value: string) => void;
}) {
  return (
    <FormField tone={tone} label="State / province" htmlFor={id} required={required}>
      {useDropdown ? (
        <ChoiceInput<string>
          layout="popover"
          inputId={id}
          options={options}
          value={value.trim() ? value : null}
          onChange={onSelect}
          placeholder="State / province"
          listboxLabel="State or province"
          inputClassName={textInputClassName}
          required={required}
          autoComplete="address-level1"
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onTextChange(e.target.value)}
          className={textInputClassName}
          required={required}
          autoComplete="address-level1"
        />
      )}
    </FormField>
  );
});

const CountryField = memo(function CountryField({
  id,
  tone,
  required,
  textInputClassName,
  options,
  value,
  onSelect,
}: {
  id: string;
  tone: 'public' | 'app';
  required: boolean;
  textInputClassName: string;
  options: ChoiceOption<string>[];
  value: string;
  onSelect: (value: string | string[] | null) => void;
}) {
  return (
    <FormField tone={tone} label="Country" htmlFor={id} required={required}>
      <ChoiceInput<string>
        layout="popover"
        inputId={id}
        options={options}
        value={value.trim() ? value : null}
        onChange={onSelect}
        placeholder="Country"
        listboxLabel="Countries"
        inputClassName={textInputClassName}
        required={required}
        autoComplete="country-name"
      />
    </FormField>
  );
});

export default function PhysicalAddressCollect({
  value,
  onChange,
  fillWhenEmpty,
  entryMode = 'auto',
  required = false,
  tone = 'public',
  sectionTitle = 'Mailing address',
  sectionDescription,
  className,
  textInputClassName = 'app-input',
  nominatimContext = 'address',
}: PhysicalAddressCollectProps) {
  const sectionId = useId();
  const searchInputId = `${sectionId}-addr-search`;
  const line1Id = `${sectionId}-addr-line1`;
  const line2Id = `${sectionId}-addr-line2`;
  const cityId = `${sectionId}-addr-city`;
  const stateId = `${sectionId}-addr-state`;
  const countryId = `${sectionId}-addr-country`;
  const postalId = `${sectionId}-addr-postal`;

  const emptyDefaults = useMemo(
    () => emptyStructuredPostalAddress({ state: fillWhenEmpty?.state, country: fillWhenEmpty?.country }),
    [fillWhenEmpty?.country, fillWhenEmpty?.state],
  );

  const [view, setView] = useState<AddressView>(() => initialView(value, entryMode));
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDirty, setSearchDirty] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupSeqRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const patch = useCallback(
    (partial: Partial<StructuredPostalAddress>) => {
      onChange({ ...value, ...partial });
    },
    [onChange, value],
  );

  const linkBtnClass =
    'text-sm font-medium text-primary-teal underline decoration-primary-teal/40 underline-offset-2 hover:decoration-primary-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/30 rounded-sm';

  const subdivisions = useMemo(() => [...postalSubdivisionNamesForCountry(value.country)], [value.country]);
  const useStateProvinceDropdown = subdivisions.length > 0;

  const countrySelectOptions = useMemo(() => {
    const c = value.country.trim();
    if (c && !POSTAL_COUNTRY_NAMES.includes(c)) return [{ value: c, label: c }, ...COUNTRY_SELECT_OPTIONS];
    return COUNTRY_SELECT_OPTIONS;
  }, [value.country]);

  const stateSelectOptions = useMemo(() => {
    const s = value.state.trim();
    const opts = subdivisions.map((name) => ({ value: name, label: name }));
    if (!s) return opts;
    if (!subdivisions.some((name) => name === s)) return [{ value: s, label: s }, ...opts];
    return opts;
  }, [value.state, subdivisions]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    fetchAbortRef.current?.abort();

    if (view !== 'search' || !searchDirty) {
      setSuggestions([]);
      setLookupLoading(false);
      return;
    }

    const q = searchQuery.trim();
    const seq = ++lookupSeqRef.current;

    if (q.length === 0) {
      setSuggestions([]);
      setLookupLoading(false);
      return;
    }

    if (q.length < 3) {
      debounceRef.current = setTimeout(() => {
        if (seq !== lookupSeqRef.current) return;
        setLookupLoading(false);
        setSuggestions([]);
      }, NOMINATIM_DEBOUNCE_MS);
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }

    debounceRef.current = setTimeout(() => {
      if (seq !== lookupSeqRef.current) return;
      const ac = new AbortController();
      fetchAbortRef.current = ac;
      void (async () => {
        try {
          setLookupLoading(true);
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=5`;
          const res = await fetch(url, {
            signal: ac.signal,
            headers: {
              Accept: 'application/json',
              'User-Agent': `BroomStack/1.0 (${nominatimContext})`,
            },
          });
          const data = (await res.json()) as NominatimSearchItem[];
          if (seq !== lookupSeqRef.current) return;
          setSuggestions(
            data.map((item) => {
              const structured = nominatimItemToStructuredAddress(item, fillWhenEmpty);
              return {
                label: item.display_name ?? [structured.addressLine1, structured.city, structured.state]
                  .filter(Boolean)
                  .join(', '),
                structured,
              };
            }),
          );
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          if (seq !== lookupSeqRef.current) return;
          setSuggestions([]);
        } finally {
          if (seq === lookupSeqRef.current) setLookupLoading(false);
        }
      })();
    }, NOMINATIM_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fillWhenEmpty, nominatimContext, searchDirty, searchQuery, view]);

  const trimmedSearch = searchQuery.trim();
  const showSearchDropdown = view === 'search' && searchDirty && trimmedSearch.length > 0;

  function openManualEntry(seedLine1?: string) {
    if (seedLine1?.trim()) {
      patch({ addressLine1: seedLine1.trim() });
    }
    setView('manual');
  }

  function openSearch() {
    setSearchQuery(value.addressLine1);
    setSearchDirty(false);
    setSuggestions([]);
    setView('search');
  }

  function clearAddress() {
    onChange(emptyDefaults);
    setSearchQuery('');
    setSearchDirty(false);
    setSuggestions([]);
    setView('search');
  }

  function selectSuggestion(suggestion: Suggestion) {
    onChange(suggestion.structured);
    setSearchDirty(false);
    setSuggestions([]);
    setLookupLoading(false);
    setView('manual');
  }

  return (
    <FormSection
      tone={tone}
      title={sectionTitle}
      description={sectionDescription}
      className={joinClasses('space-y-4', className)}
    >
      {view === 'search' ? (
        <div className="space-y-2">
          <FormField tone={tone} label="Search for your address" htmlFor={searchInputId} required={required}>
            <AutocompleteInput<Suggestion>
              inputId={searchInputId}
              inputValue={searchQuery}
              onInputValueChange={(next) => {
                setSearchDirty(true);
                setSearchQuery(next);
                if (next.trim().length >= 1) setLookupLoading(true);
              }}
              options={suggestions}
              onSelectOption={selectSuggestion}
              getOptionKey={(s) =>
                `${s.label}|${s.structured.city}|${s.structured.postalCode}|${s.structured.addressLine1}`
              }
              renderOption={(s) => <span>{s.label}</span>}
              placeholder=""
              loading={lookupLoading}
              loadingText="Loading…"
              noMatchesText={trimmedSearch.length >= 3 ? 'No results' : 'Keep typing to search.'}
              listboxLabel="Address search results"
              shouldShowDropdown={showSearchDropdown}
              inputClassName={textInputClassName}
              required={required}
              autoComplete="off"
              chromeOffAutocompleteWhileFocused
            />
          </FormField>
          <button type="button" className={linkBtnClass} onClick={() => openManualEntry(searchQuery)}>
            Enter address manually
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {!value.addressLine1.trim() && structuredPostalHasMeaningfulLocation(value) ? (
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Add a street address in line 1 so we can mail correspondence to you.
            </p>
          ) : null}

          <FormField tone={tone} label="Address line 1" htmlFor={line1Id} required={required}>
            <input
              id={line1Id}
              type="text"
              value={value.addressLine1}
              onChange={(e) => patch({ addressLine1: e.target.value })}
              className={textInputClassName}
              required={required}
              autoComplete="address-line1"
            />
          </FormField>

          <FormField tone={tone} label="Address line 2 (optional)" htmlFor={line2Id}>
            <input
              id={line2Id}
              type="text"
              value={value.addressLine2}
              onChange={(e) => patch({ addressLine2: e.target.value })}
              className={textInputClassName}
              autoComplete="address-line2"
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField tone={tone} label="City" htmlFor={cityId} required={required}>
              <input
                id={cityId}
                type="text"
                value={value.city}
                onChange={(e) => patch({ city: e.target.value })}
                className={textInputClassName}
                required={required}
                autoComplete="address-level2"
              />
            </FormField>
            <StateProvinceField
              id={stateId}
              tone={tone}
              required={required}
              textInputClassName={textInputClassName}
              useDropdown={useStateProvinceDropdown}
              options={stateSelectOptions}
              value={value.state}
              onSelect={(v) => patch({ state: singleChoiceText(v) })}
              onTextChange={(state) => patch({ state })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <CountryField
              id={countryId}
              tone={tone}
              required={required}
              textInputClassName={textInputClassName}
              options={countrySelectOptions}
              value={value.country}
              onSelect={(v) => patch({ country: singleChoiceText(v) })}
            />
            <FormField tone={tone} label="Postal code" htmlFor={postalId} required={required}>
              <input
                id={postalId}
                type="text"
                value={value.postalCode}
                onChange={(e) => patch({ postalCode: e.target.value })}
                className={textInputClassName}
                required={required}
                autoComplete="postal-code"
              />
            </FormField>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <button type="button" className={linkBtnClass} onClick={openSearch}>
              Search for address
            </button>
            {structuredPostalHasMeaningfulLocation(value) ? (
              <button type="button" className={linkBtnClass} onClick={clearAddress}>
                Clear address
              </button>
            ) : null}
          </div>
        </div>
      )}
    </FormSection>
  );
}
