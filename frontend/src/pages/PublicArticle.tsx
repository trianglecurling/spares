import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArticleBody } from '../components/ArticleBody';
import api from '../utils/api';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import PublicNotFoundPage from './PublicNotFoundPage';
import { useAuth } from '../contexts/AuthContext';
import { memberHasScope } from '../utils/permissions';

interface ArticleData {
  id: number;
  title: string;
  slug: string;
  contentType?: 'markdown' | 'html';
  content: string;
  snippet: string | null;
  publishedAt: string | null;
}

/** Only show a loading indicator after this delay so fast responses avoid a flash of loading UI. */
const SLOW_LOAD_INDICATOR_MS = 450;

export default function PublicArticle() {
  const { slug } = useParams<{ slug: string }>();
  const { member } = useAuth();
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [redirectEventSlug, setRedirectEventSlug] = useState<string | null>(null);
  const [showSlowLoadIndicator, setShowSlowLoadIndicator] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setRedirectEventSlug(null);
    setError(null);
    setNotFound(false);
    setArticle(null);
    setShowSlowLoadIndicator(false);
    const slowLoadTimer = window.setTimeout(() => setShowSlowLoadIndicator(true), SLOW_LOAD_INDICATOR_MS);
    let canceled = false;
    api
      .get<ArticleData>(`/public/articles/${slug}`)
      .then((res) => {
        if (!canceled) setArticle(res.data);
      })
      .catch((err) => {
        const redirectToEventSlug = err?.response?.data?.redirectToEventSlug as unknown;
        if (
          err?.response?.status === 404 &&
          typeof redirectToEventSlug === 'string' &&
          redirectToEventSlug.length > 0
        ) {
          if (!canceled) setRedirectEventSlug(redirectToEventSlug);
          return;
        }
        if (!canceled) {
          if (err?.response?.status === 404) {
            setNotFound(true);
          } else {
            setError(err?.response?.data?.error || 'Failed to load');
          }
        }
      })
      .finally(() => {
        window.clearTimeout(slowLoadTimer);
      });
    return () => {
      canceled = true;
      window.clearTimeout(slowLoadTimer);
    };
  }, [slug]);

  const canEditArticle =
    Boolean(member && memberHasScope(member, 'content.manage'));

  if (redirectEventSlug) {
    return <Navigate to={`/events/${redirectEventSlug}`} replace />;
  }

  if (notFound) {
    return (
      <PublicNotFoundPage
        title="Article not found"
        description="This article may have been removed, unpublished, or the link may be outdated."
        seoTitle="Article not found | Triangle Curling Club"
        showCode={false}
      />
    );
  }

  if (error) {
    return (
      <PublicLayout>
        <section className="public-section">
          <div className="public-container">
            <div className="public-content">
              <PublicStateCard
                title="Unable to load article"
                description={error}
                tone="error"
              />
            </div>
          </div>
        </section>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <SeoMeta
        title={
          article
            ? `${article.title} | Triangle Curling Club`
            : 'Resource | Triangle Curling Club'
        }
        description={
          article?.snippet?.trim()
            ? article.snippet.trim().slice(0, 160)
            : 'Read curling resources, guides, event updates, and club news from Triangle Curling Club.'
        }
        canonicalPath={article ? `/articles/${article.slug}` : undefined}
        ogType="article"
        jsonLd={
          article
            ? {
                '@context': 'https://schema.org',
                '@type': 'Article',
                headline: article.title,
                description: article.snippet ?? undefined,
                datePublished: article.publishedAt ?? undefined,
                mainEntityOfPage:
                  typeof window !== 'undefined'
                    ? `${window.location.origin}/articles/${article.slug}`
                    : undefined,
                publisher: {
                  '@type': 'Organization',
                  name: 'Triangle Curling Club',
                },
              }
            : null
        }
      />
      <section className="public-section">
        <div className="public-container">
          <div className="public-content">
            {!article ? (
              showSlowLoadIndicator ? (
                <div
                  className="flex min-h-[12rem] items-center justify-center py-12"
                  role="status"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <span className="sr-only">Loading</span>
                  <div
                    className="h-9 w-9 shrink-0 rounded-full border-2 border-gray-200 border-t-primary-teal motion-reduce:animate-none motion-reduce:border-primary-teal/50 motion-reduce:opacity-80 animate-spin"
                    aria-hidden
                  />
                </div>
              ) : null
            ) : (
              <article>
                <div className="public-page-title-rule">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h1 className="public-heading text-balance min-w-0 flex-1">{article.title}</h1>
                    {canEditArticle ? (
                      <Link
                        to={`/admin/content/articles/${article.id}`}
                        className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
                      >
                        Edit
                      </Link>
                    ) : null}
                  </div>
                </div>
                <ArticleBody contentType={article.contentType} content={article.content} />
              </article>
            )}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
