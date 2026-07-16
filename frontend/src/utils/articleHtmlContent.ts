import { marked } from 'marked';
import { htmlReplaceYoutubeMarkdownImagesWithEmbeds } from './youtubeMarkdown';

const ARTICLE_HTML_DEFAULT_CSS = `/* Basic typography - edit as needed */
.content { max-width: 42rem; margin: 0 auto; }
h1 { font-size: 1.5rem; font-weight: 700; margin: 1em 0 0.5em; }
h2 { font-size: 1.25rem; font-weight: 600; margin: 1em 0 0.5em; }
h3 { font-size: 1.125rem; font-weight: 600; margin: 0.75em 0 0.5em; }
p { line-height: 1.6; margin: 0.5em 0; }
ul, ol { margin: 0.5em 0; padding-left: 1.5rem; }
ul { list-style-type: disc; }
ol { list-style-type: decimal; }
a { color: #0d9488; text-decoration: underline; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #d1d5db; padding: 0.5rem 1rem; text-align: left; }
th { font-weight: 600; background: #f3f4f6; }
.markdown-youtube-embed { display: block; width: 100%; max-width: 560px; margin: 1rem 0; min-width: 0; }
.markdown-youtube-inner { position: relative; width: 100%; height: 0; padding-bottom: 56.25%; overflow: hidden; border-radius: 0.5rem; background: #111827; }
.markdown-youtube-inner iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0; }
`;

/** True when there is no meaningful saved HTML/CSS/JS payload yet. */
export function isArticleHtmlContentEmpty(htmlContent: string): boolean {
  if (!htmlContent.trim()) return true;
  try {
    const parsed = JSON.parse(htmlContent) as Partial<{ html: string; css: string; js: string }>;
    return !(parsed.html ?? '').trim() && !(parsed.css ?? '').trim() && !(parsed.js ?? '').trim();
  } catch {
    return !htmlContent.trim();
  }
}

/** Convert markdown into the JSON HTML/CSS/JS blob stored on articles. */
export async function buildArticleHtmlContentFromMarkdown(markdown: string): Promise<string> {
  let html = (await marked.parse(markdown)) as string;
  html = htmlReplaceYoutubeMarkdownImagesWithEmbeds(html);
  return JSON.stringify({
    html: `<div class="content">\n${html}\n</div>`,
    css: ARTICLE_HTML_DEFAULT_CSS,
    js: '// Optional JavaScript\n',
  });
}
