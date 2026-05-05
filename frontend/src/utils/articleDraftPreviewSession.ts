/**
 * Key prefix for unsaved article previews (browser only; never hits the server).
 * Uses localStorage (not sessionStorage) so the editor tab can write and the preview tab
 * opened via window.open can read — sessionStorage is isolated per tab.
 */
export const ARTICLE_DRAFT_PREVIEW_STORAGE_PREFIX = 'tccArticleDraftPreview:';

export type ArticleDraftPreviewPayloadV1 = {
  v: 1;
  title: string;
  slug: string;
  contentType: 'markdown' | 'html';
  content: string;
  snippet: string | null;
};

/** Store draft snapshot for a new tab; returns the storage token for the preview URL, or null if storage failed. */
export function storeArticleDraftPreview(payload: Omit<ArticleDraftPreviewPayloadV1, 'v'>): string | null {
  const k = crypto.randomUUID();
  const full: ArticleDraftPreviewPayloadV1 = { v: 1, ...payload };
  try {
    localStorage.setItem(`${ARTICLE_DRAFT_PREVIEW_STORAGE_PREFIX}${k}`, JSON.stringify(full));
    return k;
  } catch {
    return null;
  }
}

/** In-memory cache so React Strict Mode remounts still see the payload after localStorage is cleared. */
const draftPreviewHydrated = new Map<string, ArticleDraftPreviewPayloadV1>();

/**
 * Read draft preview once from localStorage, then from memory on remount (e.g. Strict Mode).
 * Removes the localStorage entry after first successful read so the URL is single-use.
 */
export function readArticleDraftPreviewOnce(key: string): ArticleDraftPreviewPayloadV1 | null {
  const cached = draftPreviewHydrated.get(key);
  if (cached) return cached;

  const storageKey = `${ARTICLE_DRAFT_PREVIEW_STORAGE_PREFIX}${key}`;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ArticleDraftPreviewPayloadV1;
    if (parsed?.v !== 1) return null;
    if (parsed.contentType !== 'markdown' && parsed.contentType !== 'html') return null;
    if (typeof parsed.content !== 'string') return null;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    draftPreviewHydrated.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}
