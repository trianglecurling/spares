import { describe, expect, test } from 'bun:test';
import { parseArticleHashId, scrollArticleToHash } from './articleHashScroll';

describe('parseArticleHashId', () => {
  test('returns null for an empty hash', () => {
    expect(parseArticleHashId('')).toBeNull();
    expect(parseArticleHashId('#')).toBeNull();
  });

  test('strips the leading hash and decodes the id', () => {
    expect(parseArticleHashId('#spirit')).toBe('spirit');
    expect(parseArticleHashId('#late%20for%20game')).toBe('late for game');
  });
});

describe('scrollArticleToHash', () => {
  test('scrolls the matching element into view', () => {
    let scrolled = false;
    const target = {
      scrollIntoView: () => {
        scrolled = true;
      },
    };
    const root = {
      querySelector: (selector: string) => (selector === '#spirit' ? target : null),
    } as unknown as ParentNode;

    expect(scrollArticleToHash('#spirit', root)).toBe(true);
    expect(scrolled).toBe(true);
  });

  test('returns false when the hash target is missing', () => {
    const root = {
      querySelector: () => null,
    } as unknown as ParentNode;
    expect(scrollArticleToHash('#missing', root)).toBe(false);
  });
});
