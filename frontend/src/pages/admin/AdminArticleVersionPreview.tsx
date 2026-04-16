import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import PublicLayout from '../../components/PublicLayout';
import SeoMeta from '../../components/SeoMeta';
import api from '../../utils/api';

const executedArticleScripts = new Set<string>();

function HtmlPreview({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => {
    try {
      const p = JSON.parse(content) as { html?: string; css?: string; js?: string; generated_css?: string };
      return { html: p.html ?? '', css: p.css ?? '', js: p.js ?? '', generated_css: p.generated_css ?? '' };
    } catch {
      return { html: '<p>Invalid content</p>', css: '', js: '', generated_css: '' };
    }
  }, [content]);

  useEffect(() => {
    const toInject = [parsed.generated_css, parsed.css].filter(Boolean).join('\n');
    if (!toInject) return;
    const style = document.createElement('style');
    style.textContent = toInject;
    style.setAttribute('data-article-content', 'true');
    document.head.appendChild(style);
    return () => style.remove();
  }, [parsed.css, parsed.generated_css]);

  useEffect(() => {
    if (!parsed.js || !containerRef.current) return;
    if (executedArticleScripts.has(parsed.js)) return;
    executedArticleScripts.add(parsed.js);
    const script = document.createElement('script');
    script.textContent = parsed.js;
    containerRef.current.appendChild(script);
    return () => {
      script.remove();
      const key = parsed.js;
      setTimeout(() => executedArticleScripts.delete(key), 0);
    };
  }, [parsed.js]);

  return (
    <div ref={containerRef} className="article-html-content [&_a]:text-primary-teal [&_a]:underline">
      <div dangerouslySetInnerHTML={{ __html: parsed.html }} />
    </div>
  );
}

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
                  <HtmlPreview content={data.content} />
                ) : (
                  <div className="markdown-content max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkBreaks, remarkGfm]}>{data.content}</ReactMarkdown>
                  </div>
                )}
              </article>
            )}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
