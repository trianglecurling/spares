import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { scrollArticleToHash } from '../utils/articleHashScroll';
import { ArticleMarkdown } from './ArticleMarkdown';

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
    <div ref={containerRef} className="article-html-content">
      <div dangerouslySetInnerHTML={{ __html: parsed.html }} />
    </div>
  );
}

export function ArticleBody({
  contentType,
  content,
}: {
  contentType?: 'markdown' | 'html';
  content: string;
}) {
  const location = useLocation();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !content) return;

    let canceled = false;
    let timer = 0;
    let attempts = 0;

    const tryScroll = () => {
      if (canceled) return;
      if (scrollArticleToHash(location.hash, root)) return;
      if (attempts >= 20) return;
      attempts += 1;
      timer = window.setTimeout(tryScroll, 50);
    };

    const frame = window.requestAnimationFrame(tryScroll);
    return () => {
      canceled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [content, contentType, location.hash, location.pathname]);

  return (
    <div ref={rootRef}>
      {contentType === 'html' ? <ArticleHtmlContent content={content} /> : <ArticleMarkdown markdown={content} />}
    </div>
  );
}
