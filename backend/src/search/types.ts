export type SearchResultType = 'article' | 'event' | 'page';

export type SearchDocument = {
  id: string;
  type: SearchResultType;
  title: string;
  url: string;
  content: string;
  keywords: string;
  snippet: string;
  plainText: string;
  recencyMs: number;
};

export type SearchFingerprint = {
  version: number;
  articleCount: number;
  eventCount: number;
  pageCount: number;
  maxArticleUpdatedAt: string | null;
  maxEventUpdatedAt: string | null;
};

export type PublicSearchResult = {
  type: SearchResultType;
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
