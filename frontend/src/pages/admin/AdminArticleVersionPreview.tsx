import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PublicLayout from '../../components/PublicLayout';
import PublicStateCard from '../../components/PublicStateCard';
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
      <PublicLayout>
        <section className="public-section">
          <div className="public-container">
            <div className="public-content">
              <PublicStateCard title="Unable to load preview" description={error} tone="error" />
            </div>
          </div>
        </section>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <SeoMeta
        title={data ? `${data.title} | Triangle Curling Club` : 'Resource | Triangle Curling Club'}
        description={
          data?.revisionNote?.trim()
            ? data.revisionNote.trim().slice(0, 160)
            : 'Article preview'
        }
        canonicalPath={data ? `/articles/${data.slug}` : undefined}
        ogType="article"
      />
      <section className="public-section">
        <div className="public-container">
          <div className="public-content">
            {!data ? (
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
            ) : (
              <article>
                <div className="public-page-title-rule">
                  <h1 className="public-heading text-balance">{data.title}</h1>
                </div>
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
