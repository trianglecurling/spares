import { useEffect, useMemo, useRef } from 'react';
import { ArticleMarkdown } from '../../components/ArticleMarkdown';

const executedArticleScripts = new Set<string>();

export function ArticleHtmlBundlePreview({ content }: { content: string }) {
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
    <div ref={containerRef} className="article-html-content [&_a]:text-primary-teal-link [&_a]:underline dark:[&_a]:text-primary-teal">
      <div dangerouslySetInnerHTML={{ __html: parsed.html }} />
    </div>
  );
}

export function ArticleMarkdownPreview({ markdown }: { markdown: string }) {
  return <ArticleMarkdown markdown={markdown} />;
}
