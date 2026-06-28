import { describe, expect, test } from 'bun:test';
import { resolveSpaDocumentHttpStatus } from './spaDocumentStatus.js';

describe('resolveSpaDocumentHttpStatus', () => {
  test('returns 200 for known static public routes', async () => {
    await expect(resolveSpaDocumentHttpStatus('/')).resolves.toBe(200);
    await expect(resolveSpaDocumentHttpStatus('/contact')).resolves.toBe(200);
    await expect(resolveSpaDocumentHttpStatus('/help/quick-start')).resolves.toBe(200);
    await expect(resolveSpaDocumentHttpStatus('/events')).resolves.toBe(200);
  });

  test('returns 200 for known authenticated routes', async () => {
    await expect(resolveSpaDocumentHttpStatus('/dashboard')).resolves.toBe(200);
    await expect(resolveSpaDocumentHttpStatus('/admin/members')).resolves.toBe(200);
    await expect(resolveSpaDocumentHttpStatus('/calendar/events/new')).resolves.toBe(200);
  });

  test('returns 404 for unknown routes', async () => {
    await expect(resolveSpaDocumentHttpStatus('/this-page-does-not-exist')).resolves.toBe(404);
    await expect(resolveSpaDocumentHttpStatus('/articles')).resolves.toBe(200);
    await expect(resolveSpaDocumentHttpStatus('/mailing-list/not-a-real-list')).resolves.toBe(404);
  });

  test('normalizes trailing slashes', async () => {
    await expect(resolveSpaDocumentHttpStatus('/contact/')).resolves.toBe(200);
    await expect(resolveSpaDocumentHttpStatus('/this-page-does-not-exist/')).resolves.toBe(404);
  });
});
