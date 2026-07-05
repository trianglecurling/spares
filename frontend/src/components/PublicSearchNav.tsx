import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HiMagnifyingGlass } from 'react-icons/hi2';
import AutocompleteInput from './AutocompleteInput';
import {
  fetchPublicSearch,
  getPublicSearchErrorMessage,
  PUBLIC_SEARCH_TYPE_LABELS,
  publicSearchTypeBadgeClass,
  type PublicSearchResult,
} from '../utils/publicSearch';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
const SUGGESTION_LIMIT = 8;

type PublicSearchNavProps = {
  variant?: 'nav' | 'page';
  initialQuery?: string;
  onNavigate?: () => void;
  onSubmitQuery?: (query: string) => void;
  forceExpanded?: boolean;
  /** Desktop nav: hide items to the left of search while search is expanded. */
  onSearchOpenChange?: (open: boolean) => void;
};

export default function PublicSearchNav({
  variant = 'nav',
  initialQuery = '',
  onNavigate,
  onSubmitQuery,
  forceExpanded = false,
  onSearchOpenChange,
}: PublicSearchNavProps) {
  const navigate = useNavigate();
  const inputId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [expanded, setExpanded] = useState(variant === 'page' || forceExpanded);
  const [results, setResults] = useState<PublicSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const setSearchOpen = (open: boolean) => {
    onSearchOpenChange?.(open);
  };

  const closeSearch = () => {
    setExpanded(false);
    setQuery('');
    setResults([]);
    setSearchOpen(false);
  };

  const openSearch = () => {
    setExpanded(true);
    setSearchOpen(true);
  };

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    if (forceExpanded) {
      setExpanded(true);
    }
  }, [forceExpanded]);

  useEffect(() => {
    if (!expanded || variant === 'page' || forceExpanded) return;
    const input = document.getElementById(inputId);
    if (input instanceof HTMLInputElement) {
      input.focus();
    }
  }, [expanded, forceExpanded, inputId, variant]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    debounceRef.current = setTimeout(() => {
      void fetchPublicSearch(trimmed, SUGGESTION_LIMIT)
        .then((response) => {
          if (requestIdRef.current !== requestId) return;
          setResults(response.results);
        })
        .catch((fetchError) => {
          if (requestIdRef.current !== requestId) return;
          setResults([]);
          setError(getPublicSearchErrorMessage(fetchError, 'Search is temporarily unavailable.'));
        })
        .finally(() => {
          if (requestIdRef.current === requestId) {
            setLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  const shouldShowDropdown =
    query.trim().length >= MIN_QUERY_LENGTH &&
    (variant === 'page' || loading || results.length > 0 || Boolean(error));
  const noMatchesText = useMemo(() => {
    if (error) return error;
    if (loading) return 'Searching…';
    return 'No matches found';
  }, [error, loading]);

  const goToSearchPage = (nextQuery: string) => {
    const trimmed = nextQuery.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    if (onSubmitQuery) {
      onSubmitQuery(trimmed);
      onNavigate?.();
      return;
    }
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    onNavigate?.();
  };

  const goToResult = (result: PublicSearchResult) => {
    navigate(result.url);
    onNavigate?.();
  };

  const navSearchInputClassName = forceExpanded
    ? 'app-input w-full max-w-none'
    : 'app-input w-60 max-w-none sm:w-72 lg:w-80 xl:w-96';

  const searchField = (
    <AutocompleteInput
      inputId={inputId}
      inputValue={query}
      onInputValueChange={setQuery}
      options={results}
      onSelectOption={goToResult}
      getOptionKey={(result) => `${result.type}:${result.url}`}
      renderOption={(result) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-gray-900">{result.title}</span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${publicSearchTypeBadgeClass(result.type)}`}
            >
              {PUBLIC_SEARCH_TYPE_LABELS[result.type]}
            </span>
          </div>
          {result.snippet ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">{result.snippet}</p>
          ) : null}
        </div>
      )}
      placeholder="Search the site"
      loading={loading}
      loadingText="Searching…"
      noMatchesText={noMatchesText}
      listboxLabel="Search suggestions"
      shouldShowDropdown={shouldShowDropdown}
      inputClassName={variant === 'page' ? 'app-input w-full' : navSearchInputClassName}
      autoComplete="off"
      chromeOffAutocompleteWhileFocused
      onEnterKey={() => {
        goToSearchPage(query);
      }}
    />
  );

  if (variant === 'page' || forceExpanded) {
    return (
      <form
        role="search"
        className="w-full"
        onSubmit={(event) => {
          event.preventDefault();
          goToSearchPage(query);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Search the site
        </label>
        {searchField}
      </form>
    );
  }

  return (
    <form
      role="search"
      className="flex items-center"
      onSubmit={(event) => {
        event.preventDefault();
        goToSearchPage(query);
      }}
    >
      {expanded ? (
        <div className="flex items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            Search the site
          </label>
          {searchField}
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={closeSearch}
          >
            Close
          </button>
        </div>
      ) : (
        <button
          type="button"
          aria-label="Open site search"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
          onClick={openSearch}
        >
          <HiMagnifyingGlass className="h-4 w-4" aria-hidden />
        </button>
      )}
    </form>
  );
}
