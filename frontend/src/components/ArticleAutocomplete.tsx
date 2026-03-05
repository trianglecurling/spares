import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
};

const EMPTY_EXCLUDE_IDS: number[] = [];

export default function ArticleAutocomplete({
  value,
  onChange,
  placeholder = 'Search articles...',
  disabled = false,
  excludeIds = EMPTY_EXCLUDE_IDS,
}: ArticleAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<ArticleOption[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const listboxId = useId();

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const displayText = query || (value ? `${value.title} (/articles/${value.slug})` : '');

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!boxRef.current) return;
      if (boxRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

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

  useEffect(() => {
    if (!open || options.length === 0) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex((prev) => {
      if (prev >= 0 && prev < options.length) return prev;
      return 0;
    });
  }, [open, options]);

  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    const active = document.getElementById(`${listboxId}-option-${highlightedIndex}`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [open, highlightedIndex, listboxId]);

  const selectArticle = (article: ArticleOption) => {
    onChange(article);
    setQuery('');
    setOpen(false);
    setHighlightedIndex(-1);
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={displayText}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined
        }
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          if (!open) setOpen(true);
          setHighlightedIndex(0);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            if (options.length === 0) return;
            setHighlightedIndex((prev) => (prev + 1) % options.length);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            if (options.length === 0) return;
            setHighlightedIndex((prev) => (prev <= 0 ? options.length - 1 : prev - 1));
            return;
          }
          if (event.key === 'Enter' && open && highlightedIndex >= 0 && highlightedIndex < options.length) {
            event.preventDefault();
            selectArticle(options[highlightedIndex]);
            return;
          }
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            setOpen(false);
            return;
          }
          if (event.key === 'Tab') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-800 dark:text-gray-100"
      />
      {value && !query && !disabled && (
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setQuery('');
            setOpen(true);
            inputRef.current?.focus();
          }}
          aria-label="Clear selected article"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
        >
          Clear
        </button>
      )}
      {open && !disabled && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Article suggestions"
          className="absolute z-30 mt-1 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg max-h-72 overflow-auto"
        >
          {loading ? (
            <p className="px-3 py-2 text-sm text-gray-500">Loading...</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">
              {query.trim() ? 'No matching articles' : 'No recent articles'}
            </p>
          ) : (
            options.map((article, index) => (
              <div
                key={article.id}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === highlightedIndex}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectArticle(article)}
                className={`w-full text-left px-3 py-2 cursor-pointer ${
                  index === highlightedIndex
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <div className="text-sm font-medium truncate">{article.title}</div>
                <div className="text-xs text-gray-500 truncate">/articles/{article.slug}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
