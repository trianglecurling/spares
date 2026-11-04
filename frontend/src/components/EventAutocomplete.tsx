import { useEffect, useMemo, useRef, useState } from 'react';
import AutocompleteInput from './AutocompleteInput';
import api from '../utils/api';

export type EventOption = {
  id: number;
  title: string;
  slug: string;
  published?: boolean;
  visibility?: string;
  updatedAt?: string;
};

type EventAutocompleteProps = {
  value: EventOption | null;
  onChange: (value: EventOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
  excludeIds?: number[];
  /** Associates an external `<label htmlFor={inputId}>` with the combobox input. */
  inputId?: string;
};

const EMPTY_EXCLUDE_IDS: number[] = [];

export default function EventAutocomplete({
  value,
  onChange,
  placeholder = 'Search events...',
  disabled = false,
  excludeIds = EMPTY_EXCLUDE_IDS,
  inputId,
}: EventAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<EventOption[]>([]);
  const debounceRef = useRef<number | null>(null);

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const displayText = query || (value ? `${value.title} (/events/${value.slug})` : '');

  useEffect(() => {
    if (!open || disabled) return;
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get<EventOption[]>('/content/homepage/event-lookup', {
          params: { q: query.trim(), limit: 10 },
        });
        const next = (Array.isArray(res.data) ? res.data : []).filter((event) => !excluded.has(event.id));
        setOptions(next);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [open, query, excluded, disabled]);

  const selectEvent = (event: EventOption) => {
    onChange(event);
    setQuery('');
  };

  return (
    <AutocompleteInput
      inputId={inputId}
      inputValue={displayText}
      onInputValueChange={setQuery}
      options={options}
      onSelectOption={selectEvent}
      getOptionKey={(event) => event.id}
      renderOption={(event) => (
        <>
          <div className="text-sm font-medium truncate">{event.title}</div>
          <div className="text-xs text-gray-500 truncate">/events/{event.slug}</div>
        </>
      )}
      placeholder={placeholder}
      disabled={disabled}
      loading={loading}
      loadingText="Loading..."
      noMatchesText={query.trim() ? 'No matching events' : 'No recent events'}
      listboxLabel="Event suggestions"
      inputClassName="w-full rounded border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      clearButton={
        value && !query && !disabled
          ? {
              visible: true,
              label: 'Clear selected event',
              onClear: () => {
                onChange(null);
                setQuery('');
              },
              openAfterClear: true,
            }
          : undefined
      }
      onInputFocus={() => {
        setQuery('');
      }}
      onOpenChange={setOpen}
    />
  );
}
