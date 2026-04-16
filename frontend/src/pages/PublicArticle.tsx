import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import api from '../utils/api';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';

/** Tracks executed script content to avoid double-run under React Strict Mode */
const executedArticleScripts = new Set<string>();

/** Renders HTML/CSS/JS article content directly in the page */
function ArticleHtmlContent({ content }: { content: string }) {
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

interface ArticleData {
  id: number;
  title: string;
  slug: string;
  contentType?: 'markdown' | 'html';
  content: string;
  snippet: string | null;
  publishedAt: string | null;
}

export default function PublicArticle() {
  const { slug } = useParams<{ slug: string }>();
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    api
      .get<ArticleData>(`/public/articles/${slug}`)
      .then((res) => setArticle(res.data))
      .catch((err) => {
        if (err?.response?.status === 404) {
          setError('Resource not found');
        } else {
          setError(err?.response?.data?.error || 'Failed to load');
        }
      });
  }, [slug]);

  if (error) {
    return (
      <PublicLayout backToHome>
        <section className="public-section">
          <div className="public-container">
            <div className="public-content">
              <PublicStateCard
                title="Unable to load resource"
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
    <PublicLayout backToHome>
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
              <PublicStateCard
                title="Loading resource..."
                description="Retrieving the full article content."
              />
            ) : (
              <article>
                <h1 className="text-3xl font-bold text-gray-900 mb-2 text-balance">{article.title}</h1>
                {article.contentType === 'html' ? (
                  <ArticleHtmlContent content={article.content} />
                ) : (
                  <div className="markdown-content max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkBreaks, remarkGfm]}>{article.content}</ReactMarkdown>
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
