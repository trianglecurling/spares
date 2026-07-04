import { load } from 'cheerio';
import { marked } from 'marked';

export type ArticleContentSearchMode = 'markdown' | 'content';

function extractHtmlArticleBody(content: string): string {
  try {
    const parsed = JSON.parse(content) as { html?: string };
    return parsed?.html ?? '';
  } catch {
    return content;
  }
}

function htmlToPlainText(html: string): string {
  return load(html).text().replace(/\s+/g, ' ').trim();
}

export function articleToSearchableText(
  content: string,
  contentType: 'markdown' | 'html',
): string {
  if (contentType === 'html') {
    return htmlToPlainText(extractHtmlArticleBody(content));
  }

  const html = marked.parse(content, { async: false }) as string;
  return htmlToPlainText(html);
}

export function articleMatchesContentSearch(
  content: string,
  contentType: 'markdown' | 'html',
  query: string,
  mode: ArticleContentSearchMode,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  if (mode === 'markdown') {
    return content.toLowerCase().includes(normalizedQuery);
  }

  return articleToSearchableText(content, contentType).toLowerCase().includes(normalizedQuery);
}
