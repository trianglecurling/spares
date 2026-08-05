import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import { ArticleBody } from '../components/ArticleBody';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
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

export default function MemberArticlePage() {
  const { articleSlug } = useParams<{ navLabel: string; articleSlug: string }>();
  const { member } = useAuth();
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [redirectEventSlug, setRedirectEventSlug] = useState<string | null>(null);
  const [showSlowLoadIndicator, setShowSlowLoadIndicator] = useState(false);

  useEffect(() => {
    if (!articleSlug) return;
    setRedirectEventSlug(null);
    setError(null);
    setNotFound(false);
    setArticle(null);
    setShowSlowLoadIndicator(false);
    const slowLoadTimer = window.setTimeout(() => setShowSlowLoadIndicator(true), SLOW_LOAD_INDICATOR_MS);
    let canceled = false;
    api
      .get<ArticleData>(`/public/articles/${articleSlug}`)
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
  }, [articleSlug]);

  const canEditArticle = Boolean(member && memberHasScope(member, 'content.manage'));

  if (redirectEventSlug) {
    return <Navigate to={`/events/${redirectEventSlug}`} replace />;
  }

  if (notFound) {
    return (
      <AppPage>
        <AppStateCard
          title="Article not found"
          description="This article may have been removed, unpublished, or the link may be outdated."
        />
      </AppPage>
    );
  }

  if (error) {
    return (
      <AppPage>
        <AppStateCard title="Unable to load article" description={error} />
      </AppPage>
    );
  }

  if (!article) {
    return (
      <AppPage>
        {showSlowLoadIndicator ? <AppStateCard title="Loading..." /> : null}
      </AppPage>
    );
  }

  return (
    <AppPage>
      <AppPageHeader
        title={article.title}
        actions={
          canEditArticle ? (
            <Link
              to={`/admin/content/articles/${article.id}`}
              className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Edit
            </Link>
          ) : null
        }
      />
      <div className="app-card">
        <ArticleBody contentType={article.contentType} content={article.content} />
      </div>
    </AppPage>
  );
}
