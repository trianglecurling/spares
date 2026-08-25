import { describe, expect, test } from 'bun:test';
import {
  articleHasReadMoreMarker,
  getEffectiveArticleSnippet,
} from './articleSnippet.js';

describe('getEffectiveArticleSnippet', () => {
  test('uses the custom snippet when there is no read more marker', () => {
    expect(getEffectiveArticleSnippet('Full article body', 'Custom teaser')).toEqual({
      snippet: 'Custom teaser',
      hasMore: true,
    });
  });

  test('uses content before the asterism even when a custom snippet is stored', () => {
    expect(
      getEffectiveArticleSnippet('Shown on the homepage.\n\n⁂\n\nThe rest of the article.', 'Stale custom snippet'),
    ).toEqual({
      snippet: 'Shown on the homepage.',
      hasMore: true,
    });
  });

  test('uses HTML before the asterism even when a custom snippet is stored', () => {
    const content = JSON.stringify({
      html: '<p>League rules preface.</p>⁂<p>R1. Sheet</p>',
    });
    expect(getEffectiveArticleSnippet(content, 'Old HTML snippet', 'html')).toEqual({
      snippet: 'League rules preface.',
      hasMore: true,
    });
  });

  test('falls back to the full markdown body when neither snippet nor marker is present', () => {
    expect(getEffectiveArticleSnippet('Short notice', null)).toEqual({
      snippet: 'Short notice',
      hasMore: false,
    });
  });
});

describe('articleHasReadMoreMarker', () => {
  test('detects an asterism in markdown and in HTML article JSON', () => {
    expect(articleHasReadMoreMarker('Hello ⁂ world')).toBe(true);
    expect(articleHasReadMoreMarker(JSON.stringify({ html: '<p>Hello ⁂ world</p>' }), 'html')).toBe(true);
    expect(articleHasReadMoreMarker('Hello world')).toBe(false);
  });
});
