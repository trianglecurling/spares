import { READ_MORE_MARKER } from '../components/MarkdownDescriptionEditor';

export function articleSnippetForSave(content: string, snippet: string): string | null {
  if (content.includes(READ_MORE_MARKER) || /<!--more-->/i.test(content)) {
    return null;
  }
  const trimmed = snippet.trim();
  return trimmed ? trimmed : null;
}
