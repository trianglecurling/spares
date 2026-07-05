import api from './api';
import { formatApiError } from './api';

export type PublicSearchResultType = 'article' | 'event' | 'page';

export type PublicSearchResult = {
  type: PublicSearchResultType;
  title: string;
  url: string;
  snippet: string;
  score: number;
  matchedTerms: string[];
};

export type PublicSearchResponse = {
  results: PublicSearchResult[];
  total: number;
};

export async function fetchPublicSearch(
  query: string,
  limit = 8,
): Promise<PublicSearchResponse> {
  const response = await api.get<PublicSearchResponse>('/public/search', {
    params: { q: query, limit },
  });
  return response.data;
}

export function getPublicSearchErrorMessage(error: unknown, fallback: string): string {
  return formatApiError(error, fallback);
}

export const PUBLIC_SEARCH_TYPE_LABELS: Record<PublicSearchResultType, string> = {
  article: 'Article',
  event: 'Event',
  page: 'Page',
};

export function publicSearchTypeBadgeClass(type: PublicSearchResultType): string {
  switch (type) {
    case 'article':
      return 'bg-sky-100 text-sky-800';
    case 'event':
      return 'bg-emerald-100 text-emerald-800';
    case 'page':
      return 'bg-violet-100 text-violet-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}
