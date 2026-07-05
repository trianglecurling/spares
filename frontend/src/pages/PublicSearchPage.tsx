import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import PublicSearchNav from '../components/PublicSearchNav';
import PublicStateCard from '../components/PublicStateCard';
import SearchHighlightText from '../components/SearchHighlightText';
import SeoMeta from '../components/SeoMeta';
import {
  fetchPublicSearch,
  getPublicSearchErrorMessage,
  PUBLIC_SEARCH_TYPE_LABELS,
  publicSearchTypeBadgeClass,
  type PublicSearchResult,
} from '../utils/publicSearch';

const RESULT_LIMIT = 20;
const MIN_QUERY_LENGTH = 2;

export default function PublicSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = (searchParams.get('q') ?? '').trim();
  const [results, setResults] = useState<PublicSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const hasValidQuery = query.length >= MIN_QUERY_LENGTH;
  const pageTitle = useMemo(() => {
    if (!hasValidQuery) return 'Search | Triangle Curling Club';
    return `Search results for "${query}" | Triangle Curling Club`;
  }, [hasValidQuery, query]);

  useEffect(() => {
    if (!hasValidQuery) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);

    void fetchPublicSearch(query, RESULT_LIMIT)
      .then((response) => {
        if (requestIdRef.current !== requestId) return;
        setResults(response.results);
        setTotal(response.total);
      })
      .catch((fetchError) => {
        if (requestIdRef.current !== requestId) return;
        setResults([]);
        setTotal(0);
        setError(getPublicSearchErrorMessage(fetchError, 'Search is temporarily unavailable.'));
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      });
  }, [hasValidQuery, query]);

  const handleQuerySubmit = (nextQuery: string) => {
    const trimmed = nextQuery.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSearchParams({});
      return;
    }
    setSearchParams({ q: trimmed });
  };

  return (
    <PublicLayout>
      <SeoMeta title={pageTitle} description="Search Triangle Curling Club articles, events, and site pages." canonicalPath="/search" />
      <section className="public-section">
        <div className="public-container">
          <div className="public-content mx-auto max-w-3xl space-y-6">
            <div className="space-y-2">
              <h1 className="public-subheading">Search</h1>
              <p className="text-sm text-gray-600">Find articles, events, and other pages.</p>
            </div>

            <PublicSearchNav
              variant="page"
              initialQuery={query}
              onSubmitQuery={handleQuerySubmit}
            />

            <div aria-live="polite" className="sr-only">
              {loading
                ? 'Loading search results.'
                : hasValidQuery
                  ? `${total} result${total === 1 ? '' : 's'} found.`
                  : 'Enter a search query.'}
            </div>

            {!hasValidQuery ? (
              <PublicStateCard
                title="Start searching"
                description="Enter at least two characters to search articles, events, and site pages."
              />
            ) : loading ? (
              <PublicStateCard title="Searching…" description={`Looking for results matching "${query}".`} />
            ) : error ? (
              <PublicStateCard title="Search unavailable" description={error} tone="error" />
            ) : results.length === 0 ? (
              <PublicStateCard
                title={`No results for "${query}"`}
                description="Try different keywords, fewer words, or check spelling."
              />
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  {total} result{total === 1 ? '' : 's'}
                  {total > results.length ? ` (showing top ${results.length})` : ''}
                </p>
                <ul className="space-y-3">
                  {results.map((result) => (
                    <li key={`${result.type}:${result.url}`} className="public-card p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-gray-900">
                          <Link to={result.url} className="hover:text-primary-teal-link">
                            {result.title}
                          </Link>
                        </h2>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${publicSearchTypeBadgeClass(result.type)}`}
                        >
                          {PUBLIC_SEARCH_TYPE_LABELS[result.type]}
                        </span>
                      </div>
                      {result.snippet ? (
                        <p className="mt-2 text-sm leading-relaxed text-gray-700">
                          <SearchHighlightText text={result.snippet} terms={result.matchedTerms} />
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
