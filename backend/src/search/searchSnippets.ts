const DEFAULT_SNIPPET_LENGTH = 160;
const SNIPPET_CONTEXT_BEFORE = 40;

export function extractQueryTerms(query: string, maxTerms = 8): string[] {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);

  const unique: string[] = [];
  for (const term of terms) {
    if (!unique.includes(term)) {
      unique.push(term);
    }
    if (unique.length >= maxTerms) break;
  }
  return unique;
}

export function buildSearchSnippet(
  plainText: string,
  fallbackSnippet: string,
  queryTerms: string[],
  maxLength = DEFAULT_SNIPPET_LENGTH,
): string {
  const normalizedPlainText = plainText.replace(/\s+/g, ' ').trim();
  const source = normalizedPlainText || fallbackSnippet.replace(/\s+/g, ' ').trim();
  if (!source) return '';

  const lower = source.toLowerCase();
  let matchIndex = -1;
  for (const term of queryTerms) {
    const idx = lower.indexOf(term);
    if (idx >= 0 && (matchIndex < 0 || idx < matchIndex)) {
      matchIndex = idx;
    }
  }

  if (matchIndex < 0) {
    if (source.length <= maxLength) return source;
    return `${source.slice(0, maxLength - 1).trimEnd()}…`;
  }

  const start = Math.max(0, matchIndex - SNIPPET_CONTEXT_BEFORE);
  const excerpt = source.slice(start, start + maxLength).trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = start + maxLength < source.length ? '…' : '';
  return `${prefix}${excerpt}${suffix}`;
}
