/** Decode a URL hash such as `#spirit` into an element id. */
export function parseArticleHashId(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function escapeSelectorId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/([^\w-])/g, '\\$1');
}

/**
 * Scroll to the article element matching the current URL hash.
 * Returns true when a matching target was found.
 */
export function scrollArticleToHash(hash: string, root: ParentNode = document): boolean {
  const id = parseArticleHashId(hash);
  if (!id) return false;
  let el: Element | null = null;
  try {
    el = root.querySelector(`#${escapeSelectorId(id)}`);
  } catch {
    return false;
  }
  if (!el || typeof (el as HTMLElement).scrollIntoView !== 'function') return false;
  (el as HTMLElement).scrollIntoView({ block: 'start' });
  return true;
}
