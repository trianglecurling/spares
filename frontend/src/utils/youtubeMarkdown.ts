/** Markdown image destination for embedded players: `![Title](youtube://VIDEO_ID)` */

const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export function isValidYoutubeVideoId(id: string): boolean {
  return YOUTUBE_VIDEO_ID_RE.test(id);
}

/** Image CDN used only in Toast UI WYSIWYG; stored markdown uses `youtube://`. */
export function youtubeEmbedEditorThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

/** Turn saved markdown into the image URLs the WYSIWYG can render (real thumbnails). */
export function markdownYoutubeEmbedsForWysiwyg(markdown: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(youtube:\/\/([a-zA-Z0-9_-]{11})\/?\)/gi,
    (_, alt: string, vid: string) => `![${alt}](${youtubeEmbedEditorThumbnailUrl(vid)})`
  );
}

const THUMB_FILE_RE =
  /^(?:hqdefault|mqdefault|sddefault|maxresdefault)\.jpg(?:\?[^)]*)?$/i;

/** Normalize WYSIWYG markdown back to `youtube://` for persistence and public rendering. */
export function markdownStorageFromWysiwygYoutubeThumbnails(markdown: string): string {
  return markdown.replace(
    /!\[([^\]]*)]\(https?:\/\/img\.youtube\.com\/vi\/([a-zA-Z0-9_-]{11})\/([^)]+)\)/gi,
    (full, alt: string, vid: string, filePart: string) => {
      if (!isValidYoutubeVideoId(vid) || !THUMB_FILE_RE.test(filePart.trim())) {
        return full;
      }
      return `![${alt}](youtube://${vid})`;
    }
  );
}

/** Parses `youtube://VIDEO_ID` from an image `src` (as produced by ReactMarkdown). */
export function parseYoutubeVideoIdFromMarkdownImageSrc(src: string | undefined | null): string | null {
  if (src == null || src === '') return null;
  const trimmed = src.trim();
  const m = /^youtube:\/\/([a-zA-Z0-9_-]{11})\/?$/i.exec(trimmed);
  return m && isValidYoutubeVideoId(m[1]) ? m[1] : null;
}

/**
 * Accepts a bare 11-char id or common YouTube URLs (watch, embed, shorts, youtu.be).
 */
export function extractYoutubeVideoIdFromUserInput(input: string): string | null {
  const s = input.trim();
  if (isValidYoutubeVideoId(s)) return s;

  let m = /[?&#]v=([a-zA-Z0-9_-]{11})(?:[^a-zA-Z0-9_-]|$)/i.exec(s);
  if (m && isValidYoutubeVideoId(m[1])) return m[1];

  m = /youtu\.be\/([a-zA-Z0-9_-]{11})(?:[^a-zA-Z0-9_-]|$)/i.exec(s);
  if (m && isValidYoutubeVideoId(m[1])) return m[1];

  m = /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})(?:[^a-zA-Z0-9_-]|$)/i.exec(s);
  if (m && isValidYoutubeVideoId(m[1])) return m[1];

  m = /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})(?:[^a-zA-Z0-9_-]|$)/i.exec(s);
  if (m && isValidYoutubeVideoId(m[1])) return m[1];

  return null;
}

export function buildYoutubeMarkdownImageLine(title: string, videoId: string): string {
  const id = extractYoutubeVideoIdFromUserInput(videoId);
  if (!id) return '';
  const rawTitle = title.trim() || 'YouTube video';
  const alt = rawTitle.replace(/\]/g, '');
  return `![${alt}](youtube://${id})`;
}

function escapeHtmlAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * After `marked` turns `![alt](youtube://id)` into an img tag, replace those blocks with iframes
 * so HTML-mode articles still show video.
 */
export function htmlReplaceYoutubeMarkdownImagesWithEmbeds(html: string): string {
  return html.replace(/<img([^>]*?)>/gi, (full, attrs: string) => {
    const srcM = /src\s*=\s*["']youtube:\/\/([a-zA-Z0-9_-]{11})\/?["']/i.exec(attrs);
    if (!srcM || !isValidYoutubeVideoId(srcM[1])) return full;
    const videoId = srcM[1];
    const altM = /alt\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const title = escapeHtmlAttr(altM?.[1]?.trim() || 'YouTube video');
    return `<div class="markdown-youtube-embed"><div class="markdown-youtube-inner"><iframe src="https://www.youtube.com/embed/${videoId}" title="${title}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"></iframe></div></div>`;
  });
}
