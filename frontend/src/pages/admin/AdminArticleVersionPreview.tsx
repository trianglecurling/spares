import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PublicLayout from '../../components/PublicLayout';
import SeoMeta from '../../components/SeoMeta';
import api from '../../utils/api';
import { ArticleHtmlBundlePreview, ArticleMarkdownPreview } from './ArticlePreviewDisplay';

type VersionPreview = {
  id: number;
  articleId: number;
  versionNumber: number;
  title: string;
  slug: string;
  contentType: 'markdown' | 'html';
  content: string;
  revisionNote: string | null;
  isSmallEdit: boolean;
  createdAt: string;
  savedByName: string | null;
};

export default function AdminArticleVersionPreview() {
  const { id, versionId } = useParams<{ id: string; versionId: string }>();
  const [data, setData] = useState<VersionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const articleId = Number.parseInt(id ?? '', 10);
    const vId = Number.parseInt(versionId ?? '', 10);
    if (!Number.isFinite(articleId) || !Number.isFinite(vId)) {
      setError('Invalid preview link');
      return;
    }
    api
      .get<VersionPreview>(`/content/articles/${articleId}/versions/${vId}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err?.response?.data?.error || 'Failed to load version preview'));
  }, [id, versionId]);

  if (error) {
    return (
      <PublicLayout backToHome>
        <section className="public-section">
          <div className="public-container">
            <div className="public-content">
              <div className="public-card p-6 text-red-700">{error}</div>
            </div>
          </div>
        </section>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout backToHome>
      <SeoMeta
        title={data ? `${data.title} | Triangle Curling Club` : 'Resource | Triangle Curling Club'}
        description="Article preview"
        canonicalPath={data ? `/articles/${data.slug}` : undefined}
        ogType="article"
      />
      <section className="public-section">
        <div className="public-container">
          <div className="public-content">
            {!data ? (
              <div className="public-card p-6 text-gray-600">Loading preview...</div>
            ) : (
              <article>
                <h1 className="text-3xl font-bold text-gray-900 mb-2 text-balance">{data.title}</h1>
                {data.contentType === 'html' ? (
                  <ArticleHtmlBundlePreview content={data.content} />
                ) : (
                  <ArticleMarkdownPreview markdown={data.content} />
                )}
              </article>
            )}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
