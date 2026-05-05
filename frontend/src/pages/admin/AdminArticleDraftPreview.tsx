import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PublicLayout from '../../components/PublicLayout';
import SeoMeta from '../../components/SeoMeta';
import { useTheme } from '../../contexts/ThemeContext';
import { readArticleDraftPreviewOnce, type ArticleDraftPreviewPayloadV1 } from '../../utils/articleDraftPreviewSession';
import { ArticleHtmlBundlePreview, ArticleMarkdownPreview } from './ArticlePreviewDisplay';

function useDraftPreviewData(): { data: ArticleDraftPreviewPayloadV1 | null; error: string | null } {
  const [searchParams] = useSearchParams();
  const k = searchParams.get('k')?.trim() ?? '';
  return useMemo(() => {
    if (!k) {
      return { data: null, error: 'Missing preview link. Use Preview from the article editor.' };
    }
    const payload = readArticleDraftPreviewOnce(k);
    if (!payload) {
      return {
        data: null,
        error:
          'Preview data is missing or was already shown. Close this tab and click Preview again from the editor (page refresh clears draft preview).',
      };
    }
    return { data: payload, error: null };
  }, [k]);
}

export default function AdminArticleDraftPreview() {
  const { setForcedResolvedTheme } = useTheme();
  const { data, error } = useDraftPreviewData();

  /** Public article pages are light; match that even when the editor tab uses dark mode. */
  useEffect(() => {
    setForcedResolvedTheme('light');
    return () => setForcedResolvedTheme(null);
  }, [setForcedResolvedTheme]);

  if (error) {
    return (
      <PublicLayout>
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

  const title = data!.title.trim() || 'Untitled draft';
  const description = (data!.snippet ?? '').trim().slice(0, 160) || 'Draft article preview';

  return (
    <PublicLayout>
      <SeoMeta
        title={`${title} (draft preview) | Triangle Curling Club`}
        description={description}
        canonicalPath={data!.slug.trim() ? `/articles/${data!.slug.trim()}` : undefined}
        ogType="article"
      />
      <section className="public-section">
        <div className="public-container">
          <div className="public-content">
            <article>
              <div className="public-page-title-rule">
                <h1 className="public-heading text-balance">{title}</h1>
              </div>
              {data!.contentType === 'html' ? (
                <ArticleHtmlBundlePreview content={data!.content} />
              ) : (
                <ArticleMarkdownPreview markdown={data!.content} />
              )}
            </article>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
