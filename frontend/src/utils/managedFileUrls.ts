/**
 * Resolve managed storage file id from an image URL shown in the app
 * (public or authenticated file routes).
 */
export function parseManagedFileIdFromImageSrc(src: string): number | null {
  try {
    const url = new URL(src, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const path = url.pathname;
    const publicMatch = path.match(/\/api\/public\/files\/(\d+)(?:\/|$)/);
    const authMatch = path.match(/\/api\/files\/(\d+)(?:\/|$)/);
    const m = publicMatch ?? authMatch;
    if (!m) return null;
    const id = Number.parseInt(m[1] ?? '', 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** File row shape returned from /content/files APIs (subset used for URL rewriting). */
export type ManagedFileUrlTarget = {
  id: number;
  publicUrl: string;
  authenticatedUrl: string;
  thumbnailPublicUrl: string | null;
  thumbnailAuthenticatedUrl: string | null;
};

/**
 * Rewrite markdown that references a file by id (e.g. after resize with a new row id, or checksum bump).
 * Replaces full URL substrings (optional origin) for public/auth main and thumbnail routes.
 */
export function replaceManagedFileUrlsInMarkdown(
  markdown: string,
  sourceFileId: number,
  updated: ManagedFileUrlTarget
): string {
  const sid = String(sourceFileId);

  const publicThumbRe = new RegExp(
    `(?:https?:\\/\\/[^\\s\\[\\]()'"]+)?/api/public/files/${sid}/thumbnail[^\\s\\)\\]"']*`,
    'g'
  );
  const authThumbRe = new RegExp(
    `(?:https?:\\/\\/[^\\s\\[\\]()'"]+)?/api/files/${sid}/thumbnail[^\\s\\)\\]"']*`,
    'g'
  );
  const publicFileRe = new RegExp(
    `(?:https?:\\/\\/[^\\s\\[\\]()'"]+)?/api/public/files/${sid}/[^\\s\\)\\]"']+`,
    'g'
  );
  const authFileRe = new RegExp(`(?:https?:\\/\\/[^\\s\\[\\]()'"]+)?/api/files/${sid}/[^\\s\\)\\]"']+`, 'g');

  let out = markdown.replace(publicThumbRe, updated.thumbnailPublicUrl ?? updated.publicUrl);
  out = out.replace(authThumbRe, updated.thumbnailAuthenticatedUrl ?? updated.authenticatedUrl);
  out = out.replace(publicFileRe, updated.publicUrl);
  out = out.replace(authFileRe, updated.authenticatedUrl);
  return out;
}

const withCacheBustParam = (url: string, ts: string): string => {
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const u = new URL(url, base);
    u.searchParams.set('_cb', ts);
    const pathQs = u.pathname + u.search + u.hash;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return u.toString();
    }
    return pathQs.startsWith('/') ? pathQs : `/${pathQs}`;
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_cb=${ts}`;
  }
};

/**
 * Append `_cb` on managed file / thumbnail URLs so the WYSIWYG reloads image bytes when the
 * markdown URL string is otherwise unchanged (in-place edit, same publicUrl from API).
 */
export function bustManagedFileUrlsCacheInMarkdown(markdown: string, fileId: number): string {
  const sid = String(fileId);
  const ts = String(Date.now());
  const replaceUrl = (match: string) => withCacheBustParam(match, ts);

  let out = markdown.replace(
    new RegExp(`(?:https?:\\/\\/[^\\s\\[\\]()'"]+)?/api/public/files/${sid}/thumbnail[^\\s\\)\\]"']*`, 'g'),
    replaceUrl
  );
  out = out.replace(
    new RegExp(`(?:https?:\\/\\/[^\\s\\[\\]()'"]+)?/api/files/${sid}/thumbnail[^\\s\\)\\]"']*`, 'g'),
    replaceUrl
  );
  out = out.replace(
    new RegExp(`(?:https?:\\/\\/[^\\s\\[\\]()'"]+)?/api/public/files/${sid}/[^\\s\\)\\]"']+`, 'g'),
    replaceUrl
  );
  out = out.replace(
    new RegExp(`(?:https?:\\/\\/[^\\s\\[\\]()'"]+)?/api/files/${sid}/[^\\s\\)\\]"']+`, 'g'),
    replaceUrl
  );
  return out;
}
