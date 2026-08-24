import { describe, expect, test } from 'bun:test';
import { pathMatchesPublicBootstrapMutation } from './publicBootstrapCacheInvalidation.js';

describe('pathMatchesPublicBootstrapMutation', () => {
  test('matches article writes with and without the /api prefix', () => {
    expect(pathMatchesPublicBootstrapMutation('/api/content/articles/12', 'PATCH')).toBe(true);
    expect(pathMatchesPublicBootstrapMutation('/content/articles/12', 'PATCH')).toBe(true);
    expect(pathMatchesPublicBootstrapMutation('/api/content/articles/12?draft=1', 'PATCH')).toBe(true);
    expect(pathMatchesPublicBootstrapMutation('/content/articles/12/', 'DELETE')).toBe(true);
    expect(
      pathMatchesPublicBootstrapMutation('/api/content/articles/12/versions/3/restore', 'POST'),
    ).toBe(true);
  });

  test('ignores reads and unrelated writes', () => {
    expect(pathMatchesPublicBootstrapMutation('/api/content/articles/12', 'GET')).toBe(false);
    expect(pathMatchesPublicBootstrapMutation('/api/members/1', 'PATCH')).toBe(false);
    expect(pathMatchesPublicBootstrapMutation('/api/health', 'POST')).toBe(false);
  });
});
