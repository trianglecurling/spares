export const ARTICLE_READ_MORE_MARKER = '⁂';
const LEGACY_READ_MORE_MARKER = /<!--more-->/i;

export type ArticleContentType = 'markdown' | 'html';

function htmlArticleBody(content: string): string {
  try {
    const parsed = JSON.parse(content) as { html?: string };
    if (parsed && typeof parsed.html === 'string') return parsed.html;
  } catch {
    // Raw HTML or markdown stored in the content column.
  }
  return content;
}

function snippetSource(content: string, contentType: ArticleContentType): string {
  return contentType === 'html' ? htmlArticleBody(content) : content;
}

export function findArticleReadMoreIndex(source: string): number {
  const asterism = source.indexOf(ARTICLE_READ_MORE_MARKER);
  if (asterism >= 0) return asterism;
  const legacy = source.search(LEGACY_READ_MORE_MARKER);
  return legacy >= 0 ? legacy : -1;
}

export function articleHasReadMoreMarker(
  content: string,
  contentType: ArticleContentType = 'markdown',
): boolean {
  return findArticleReadMoreIndex(snippetSource(content, contentType)) >= 0;
}

function htmlToPlainText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Homepage and article-list snippets.
 * A read-more marker in the body wins over a stored custom snippet, matching the editor
 * (the custom snippet field is disabled when an asterism is present).
 */
export function getEffectiveArticleSnippet(
  content: string,
  customSnippet: string | null | undefined,
  contentType: ArticleContentType = 'markdown',
): { snippet: string; hasMore: boolean } {
  const source = snippetSource(content, contentType);
  const markerIndex = findArticleReadMoreIndex(source);
  if (markerIndex >= 0) {
    const beforeMarker = source.slice(0, markerIndex);
    if (contentType === 'html') {
      return { snippet: htmlToPlainText(beforeMarker) || '(Custom content)', hasMore: true };
    }
    const snippet = beforeMarker.trim().replace(/\$\$widget\d+\s*$/, '').trim();
    return { snippet, hasMore: true };
  }

  if (customSnippet != null && customSnippet.trim() !== '') {
    return { snippet: customSnippet.trim(), hasMore: true };
  }

  if (contentType === 'html') {
    return { snippet: htmlToPlainText(source) || '(Custom content)', hasMore: true };
  }

  return { snippet: content.trim(), hasMore: false };
}
