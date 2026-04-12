import { useEffect, useMemo, useRef, useState } from 'react';
import AutocompleteInput from './AutocompleteInput';
import api from '../utils/api';

export type ArticleOption = {
  id: number;
  title: string;
  slug: string;
  updatedAt?: string;
};

type ArticleAutocompleteProps = {
  value: ArticleOption | null;
  onChange: (value: ArticleOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
  excludeIds?: number[];
  /** Associates an external `<label htmlFor={inputId}>` with the combobox input. */
  inputId?: string;
};

const EMPTY_EXCLUDE_IDS: number[] = [];

export default function ArticleAutocomplete({
  value,
  onChange,
  placeholder = 'Search articles...',
  disabled = false,
  excludeIds = EMPTY_EXCLUDE_IDS,
  inputId,
}: ArticleAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<ArticleOption[]>([]);
  const debounceRef = useRef<number | null>(null);

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const displayText = query || (value ? `${value.title} (/articles/${value.slug})` : '');

  useEffect(() => {
    if (!open || disabled) return;
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get<ArticleOption[]>('/content/articles/lookup', {
          params: { q: query.trim(), limit: 10 },
        });
        const next = (Array.isArray(res.data) ? res.data : []).filter((article) => !excluded.has(article.id));
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

  const selectArticle = (article: ArticleOption) => {
    onChange(article);
    setQuery('');
  };

  return (
    <AutocompleteInput
      inputId={inputId}
      inputValue={displayText}
      onInputValueChange={setQuery}
      options={options}
      onSelectOption={selectArticle}
      getOptionKey={(article) => article.id}
      renderOption={(article) => (
        <>
          <div className="text-sm font-medium truncate">{article.title}</div>
          <div className="text-xs text-gray-500 truncate">/articles/{article.slug}</div>
        </>
      )}
      placeholder={placeholder}
      disabled={disabled}
      loading={loading}
      loadingText="Loading..."
      noMatchesText={query.trim() ? 'No matching articles' : 'No recent articles'}
      listboxLabel="Article suggestions"
      inputClassName="w-full rounded border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      clearButton={
        value && !query && !disabled
          ? {
              visible: true,
              label: 'Clear selected article',
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
