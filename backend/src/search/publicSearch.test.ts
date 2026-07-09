import { describe, expect, test } from 'bun:test';
import { articleToSearchableText } from '../content/articleContentSearch.js';
import { buildStaticPageDocuments } from './staticPages.js';
import { fingerprintsMatch } from './searchDocuments.js';
import { buildSearchSnippet, extractQueryTerms } from './searchSnippets.js';
import { validateSearchQuery, normalizeSearchLimit } from './searchIndexService.js';

describe('searchSnippets', () => {
  test('extractQueryTerms caps and deduplicates terms', () => {
    expect(extractQueryTerms('curling bonspiel curling league', 2)).toEqual(['curling', 'bonspiel']);
  });

  test('buildSearchSnippet returns excerpt around first match', () => {
    const text =
      'Triangle Curling Club welcomes beginners with learn to curl sessions throughout the season in Raleigh.';
    const snippet = buildSearchSnippet(text, '', ['beginners']);
    expect(snippet.toLowerCase()).toContain('beginners');
    expect(snippet.startsWith('…') || snippet.includes('welcomes')).toBe(true);
  });
});

describe('staticPages', () => {
  test('includes key public pages', () => {
    const pages = buildStaticPageDocuments();
    const urls = pages.map((page) => page.url);
    expect(urls).toContain('/calendar/public');
    expect(urls).toContain('/donate');
    expect(urls).toContain('/contact');
  });
});

describe('articleToSearchableText', () => {
  test('strips markdown to plain text', () => {
    const text = articleToSearchableText('# Learn to curl\n\nTry **curling** tonight.', 'markdown');
    expect(text).toContain('Learn to curl');
    expect(text).toContain('curling');
    expect(text).not.toContain('**');
  });

  test('extracts html article body text', () => {
    const content = JSON.stringify({ html: '<p>Donate to <strong>Triangle Curling</strong></p>' });
    const text = articleToSearchableText(content, 'html');
    expect(text).toContain('Donate to Triangle Curling');
  });
});

describe('searchIndexService helpers', () => {
  test('validateSearchQuery enforces length bounds', () => {
    expect(validateSearchQuery('a').ok).toBe(false);
    expect(validateSearchQuery('ab').ok).toBe(true);
    expect(validateSearchQuery('x'.repeat(101)).ok).toBe(false);
  });

  test('normalizeSearchLimit clamps to 1..20', () => {
    expect(normalizeSearchLimit(undefined)).toBe(10);
    expect(normalizeSearchLimit(0)).toBe(1);
    expect(normalizeSearchLimit(99)).toBe(20);
  });
});

describe('fingerprintsMatch', () => {
  test('returns true only when all fingerprint fields match', () => {
    const left = {
      version: 1,
      articleCount: 2,
      eventCount: 3,
      pageCount: 10,
      maxArticleUpdatedAt: '2026-01-01T00:00:00.000Z',
      maxEventUpdatedAt: '2026-01-02T00:00:00.000Z',
    };
    const right = { ...left };
    expect(fingerprintsMatch(left, right)).toBe(true);
    expect(fingerprintsMatch(left, { ...right, articleCount: 1 })).toBe(false);
  });
});
