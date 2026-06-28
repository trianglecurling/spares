import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArticleMarkdown } from '../components/ArticleMarkdown';
import api from '../utils/api';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';

interface ArticleSummary {
  id: number;
  title: string;
  slug: string;
  snippet: string;
  hasMore: boolean;
  publishedAt: string | null;
}

export default function PublicArticles() {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ArticleSummary[]>('/public/articles')
      .then((res) => setArticles(res.data))
      .catch((err) => setError(err?.response?.data?.error || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return (
      <PublicLayout>
        <section className="public-section">
          <div className="public-container">
            <div className="public-content">
              <PublicStateCard
                title="Unable to load resources"
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
        title="Curling resources | Triangle Curling Club"
        description="Read Triangle Curling Club resources about learning to curl, club events, bonspiels, and updates for the Raleigh, Durham, and Chapel Hill area."
        canonicalPath="/articles"
      />
      <section className="public-section">
        <div className="public-container">
          <div className="public-content">
            <h1 className="public-subheading mb-6">
              Learning resources
            </h1>
            {loading ? (
              <PublicStateCard
                title="Loading resources..."
                description="Gathering the latest articles and guides."
              />
            ) : articles.length === 0 ? (
              <PublicStateCard
                title="No published resources yet."
                description="Check back soon for club guides, updates, and beginner-friendly curling resources."
              />
            ) : (
              <ul className="space-y-4">
                {articles.map((a) => (
                  <li key={a.id} className="public-card p-5">
                    <h2 className="text-lg font-semibold text-gray-900 line-clamp-2">
                      <Link to={`/articles/${a.slug}`} className="hover:text-primary-teal-link">
                        {a.title}
                      </Link>
                    </h2>
                    {a.snippet ? (
                      <div className="mt-2">
                        <ArticleMarkdown markdown={a.snippet} />
                      </div>
                    ) : null}
                    {a.hasMore && (
                      <Link
                        to={`/articles/${a.slug}`}
                        className="mt-3 inline-block text-sm font-medium text-primary-teal-link hover:underline"
                      >
                        Read details
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
