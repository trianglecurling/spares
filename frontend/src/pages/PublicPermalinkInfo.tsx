import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../utils/api';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import Button from '../components/Button';
import PublicNotFoundPage from './PublicNotFoundPage';

type PublicPermalinkMeta = {
  slug: string;
  label: string | null;
  destinationUrl: string;
  destinationMayChange: boolean;
  shortLinkUrl: string;
  infoUrl: string;
};

export default function PublicPermalinkInfo() {
  const { slug: slugParam } = useParams<{ slug: string }>();
  const slug = slugParam?.trim().toLowerCase() ?? '';
  const [data, setData] = useState<PublicPermalinkMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    let canceled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setNotFound(false);
      try {
        const res = await api.get<PublicPermalinkMeta>(`/public/permalinks/${encodeURIComponent(slug)}`);
        if (!canceled) setData(res.data);
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (!canceled) {
          if (status === 404) setNotFound(true);
          else setError('Could not load link information.');
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [slug]);

  if (notFound) {
    return (
      <PublicNotFoundPage
        title="Short link not found"
        description="This short link was not found. It may have expired or the URL may be incorrect."
        seoTitle="Short link not found | Triangle Curling Club"
        showCode={false}
      />
    );
  }

  const pageTitle = data?.label ? `${data.label} · Short link` : 'Short link';

  return (
    <PublicLayout>
      <SeoMeta title={pageTitle} description="Where this short link goes before you follow it." />

      <div className="max-w-xl mx-auto px-4 py-10">
        {loading ? (
          <PublicStateCard title="Loading" description="Fetching link details…" />
        ) : error ? (
          <PublicStateCard title="Unavailable" description={error} tone="error" />
        ) : data ? (
          <div className="app-card p-6 space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-[#121033] dark:text-gray-100">{pageTitle}</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                You are viewing the info page for this short link. Following the button below sends you to the destination
                URL.
              </p>
            </div>

            <div>
              <p className="app-label">Destination URL</p>
              <p className="text-sm break-all font-mono bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-600 rounded-md p-3 mt-1">
                {data.destinationUrl}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <Button
                type="button"
                variant="primary"
                className="w-full sm:w-auto justify-center"
                onClick={() => {
                  window.location.href = data.destinationUrl;
                }}
              >
                Continue to destination
              </Button>
              <Link to="/" className="text-sm text-center sm:text-left text-gray-600 dark:text-gray-400 hover:underline">
                Back to home
              </Link>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Redirect type: {data.destinationMayChange ? 'temporary (302)' : 'permanent (301)'} when you use the short
              URL <code className="text-[0.8rem]">{data.shortLinkUrl.replace(/^https?:\/\/[^/]+/i, '')}</code>.
            </p>
          </div>
        ) : null}
      </div>
    </PublicLayout>
  );
}
