import MiniSearch from 'minisearch';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import {
  buildAllSearchDocuments,
  computeSearchFingerprint,
  fingerprintsMatch,
} from './searchDocuments.js';
import { buildSearchSnippet, extractQueryTerms } from './searchSnippets.js';
import type { PublicSearchResponse, PublicSearchResult, SearchDocument, SearchFingerprint } from './types.js';

const MINI_SEARCH_OPTIONS = {
  fields: ['title', 'content', 'keywords'] as const,
  storeFields: ['type', 'title', 'url', 'snippet', 'plainText', 'recencyMs'] as const,
  searchOptions: {
    boost: { title: 3, keywords: 2 },
    prefix: true,
    fuzzy: 0.2,
  },
};

const STALENESS_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const REBUILD_DEBOUNCE_MS = 2_000;

type SnapshotFile = {
  fingerprint: SearchFingerprint;
  index: ReturnType<MiniSearch<SearchDocument>['toJSON']>;
};

let miniSearch: MiniSearch<SearchDocument> | null = null;
let loadedFingerprint: SearchFingerprint | null = null;
let rebuildPromise: Promise<void> | null = null;
let rebuildDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let stalenessTimer: ReturnType<typeof setInterval> | null = null;
let rebuildRequestedDuringFlight = false;

function getSearchIndexPath(): string {
  const dataDir = path.dirname(path.resolve(config.databasePath));
  return path.join(dataDir, 'search-index.json');
}

function createMiniSearchInstance(): MiniSearch<SearchDocument> {
  return new MiniSearch<SearchDocument>({
    fields: [...MINI_SEARCH_OPTIONS.fields],
    storeFields: [...MINI_SEARCH_OPTIONS.storeFields],
  });
}

function indexDocuments(documents: SearchDocument[]): MiniSearch<SearchDocument> {
  const index = createMiniSearchInstance();
  if (documents.length > 0) {
    index.addAll(documents);
  }
  return index;
}

async function saveSnapshot(index: MiniSearch<SearchDocument>, fingerprint: SearchFingerprint): Promise<void> {
  const snapshot: SnapshotFile = {
    fingerprint,
    index: index.toJSON(),
  };
  const filePath = getSearchIndexPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot), 'utf8');
}

async function loadSnapshotFromDisk(currentFingerprint: SearchFingerprint): Promise<MiniSearch<SearchDocument> | null> {
  try {
    const raw = await fs.readFile(getSearchIndexPath(), 'utf8');
    const parsed = JSON.parse(raw) as SnapshotFile;
    if (!parsed?.fingerprint || !parsed?.index) return null;
    if (!fingerprintsMatch(parsed.fingerprint, currentFingerprint)) return null;
    const index = MiniSearch.loadJSON<SearchDocument>(JSON.stringify(parsed.index), {
      fields: [...MINI_SEARCH_OPTIONS.fields],
      storeFields: [...MINI_SEARCH_OPTIONS.storeFields],
    });
    return index;
  } catch {
    return null;
  }
}

async function rebuildSearchIndex(): Promise<void> {
  const [documents, fingerprint] = await Promise.all([buildAllSearchDocuments(), computeSearchFingerprint()]);
  const index = indexDocuments(documents);
  miniSearch = index;
  loadedFingerprint = fingerprint;
  try {
    await saveSnapshot(index, fingerprint);
  } catch (error) {
    console.error('Failed to persist search index snapshot:', error);
  }
}

async function ensureSearchIndexReady(forceRebuild = false): Promise<void> {
  if (rebuildPromise) {
    if (forceRebuild) rebuildRequestedDuringFlight = true;
    await rebuildPromise;
    if (rebuildRequestedDuringFlight) {
      rebuildRequestedDuringFlight = false;
      await ensureSearchIndexReady(true);
    }
    return;
  }

  if (!forceRebuild && miniSearch && loadedFingerprint) {
    const currentFingerprint = await computeSearchFingerprint();
    if (fingerprintsMatch(loadedFingerprint, currentFingerprint)) {
      return;
    }
  }

  rebuildPromise = rebuildSearchIndex()
    .catch((error) => {
      console.error('Failed to rebuild search index:', error);
      throw error;
    })
    .finally(() => {
      rebuildPromise = null;
    });

  await rebuildPromise;

  if (rebuildRequestedDuringFlight) {
    rebuildRequestedDuringFlight = false;
    await ensureSearchIndexReady(true);
  }
}

function startStalenessWatcher(): void {
  if (stalenessTimer != null) return;
  stalenessTimer = setInterval(() => {
    void ensureSearchIndexReady().catch((error) => {
      console.error('Search index staleness check failed:', error);
    });
  }, STALENESS_CHECK_INTERVAL_MS);
}

export async function warmSearchIndex(): Promise<void> {
  const currentFingerprint = await computeSearchFingerprint();
  const loaded = await loadSnapshotFromDisk(currentFingerprint);
  if (loaded) {
    miniSearch = loaded;
    loadedFingerprint = currentFingerprint;
  } else {
    await ensureSearchIndexReady(true);
  }
  startStalenessWatcher();
}

export function markSearchIndexDirty(): void {
  if (rebuildDebounceTimer != null) {
    clearTimeout(rebuildDebounceTimer);
  }
  rebuildDebounceTimer = setTimeout(() => {
    rebuildDebounceTimer = null;
    void ensureSearchIndexReady(true).catch((error) => {
      console.error('Failed to rebuild search index after invalidation:', error);
    });
  }, REBUILD_DEBOUNCE_MS);
}

export function validateSearchQuery(rawQuery: string): { ok: true; query: string } | { ok: false; error: string } {
  const query = rawQuery.trim();
  if (query.length < 2) {
    return { ok: false, error: 'Search query must be at least 2 characters' };
  }
  if (query.length > 100) {
    return { ok: false, error: 'Search query must be 100 characters or fewer' };
  }
  return { ok: true, query };
}

export function normalizeSearchLimit(rawLimit: number | undefined): number {
  if (rawLimit == null || Number.isNaN(rawLimit)) return 10;
  return Math.max(1, Math.min(20, Math.floor(rawLimit)));
}

export async function searchPublicContent(query: string, limit: number): Promise<PublicSearchResponse> {
  await ensureSearchIndexReady();
  if (!miniSearch) {
    return { results: [], total: 0 };
  }

  const queryTerms = extractQueryTerms(query);
  const rawResults = miniSearch.search(query, {
    ...MINI_SEARCH_OPTIONS.searchOptions,
    boostDocument: (_documentId, _term, storedFields) => {
      const type = storedFields?.type as SearchDocument['type'] | undefined;
      const recencyMs = Number(storedFields?.recencyMs ?? 0);
      let boost = 1;
      if (type === 'event') boost *= 1.15;
      if (type === 'page') boost *= 1.05;
      if (recencyMs > 0) {
        const ageDays = (Date.now() - recencyMs) / (1000 * 60 * 60 * 24);
        boost *= Math.max(0.75, 1.25 - ageDays / 365);
      }
      return boost;
    },
  });

  const results: PublicSearchResult[] = rawResults.slice(0, limit).map((result) => {
    const type = result.type as PublicSearchResult['type'];
    const title = String(result.title ?? '');
    const url = String(result.url ?? '');
    const plainText = String(result.plainText ?? '');
    const fallbackSnippet = String(result.snippet ?? '');
    const snippet = buildSearchSnippet(plainText, fallbackSnippet, queryTerms);
    const matchedTerms = queryTerms.filter((term) => {
      const haystack = `${title} ${plainText} ${fallbackSnippet}`.toLowerCase();
      return haystack.includes(term);
    });

    return {
      type,
      title,
      url,
      snippet,
      score: Number(result.score ?? 0),
      matchedTerms,
    };
  });

  return {
    results,
    total: rawResults.length,
  };
}
