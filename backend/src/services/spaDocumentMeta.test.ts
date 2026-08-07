import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_META_DESCRIPTION,
  DEFAULT_SITE_NAME,
  formatDocumentTitle,
  formatHomeDocumentTitle,
  injectSpaDocumentMeta,
  resolveSpaDocumentMeta,
  type SpaDocumentMeta,
} from './spaDocumentMeta.js';

describe('formatDocumentTitle', () => {
  test('joins page title and site name', () => {
    expect(formatDocumentTitle('Calendar', 'Triangle Curling')).toBe('Calendar | Triangle Curling');
  });

  test('does not duplicate site name or reformat composed titles', () => {
    expect(formatDocumentTitle('Triangle Curling', 'Triangle Curling')).toBe('Triangle Curling');
    expect(formatDocumentTitle('Calendar | Triangle Curling', 'Triangle Curling')).toBe(
      'Calendar | Triangle Curling',
    );
    expect(formatDocumentTitle('Triangle Curling | Curling in the Triangle', 'Triangle Curling')).toBe(
      'Triangle Curling | Curling in the Triangle',
    );
  });
});

describe('formatHomeDocumentTitle', () => {
  test('uses marketing home pattern', () => {
    expect(formatHomeDocumentTitle('Triangle Curling')).toBe(
      'Triangle Curling | Curling in the Triangle',
    );
  });
});

describe('injectSpaDocumentMeta', () => {
  const baseHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="old description" />
    <title>Old Title</title>
  </head>
  <body></body>
</html>`;

  const meta: SpaDocumentMeta = {
    status: 200,
    title: 'Calendar | Triangle Curling',
    description: 'View the club calendar with ice times, draws, leagues, and upcoming events.',
    ogType: 'website',
    canonicalPath: '/calendar/public',
    siteName: 'Triangle Curling',
  };

  test('rewrites title, description, og tags, and canonical', () => {
    const html = injectSpaDocumentMeta(baseHtml, meta, 'https://tccnc.club');
    expect(html).toContain('<title>Calendar | Triangle Curling</title>');
    expect(html).toContain(
      'content="View the club calendar with ice times, draws, leagues, and upcoming events."',
    );
    expect(html).toContain('property="og:site_name" content="Triangle Curling"');
    expect(html).toContain('property="og:title" content="Calendar | Triangle Curling"');
    expect(html).toContain('property="og:url" content="https://tccnc.club/calendar/public"');
    expect(html).toContain('rel="canonical" href="https://tccnc.club/calendar/public"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  test('escapes HTML in meta content', () => {
    const html = injectSpaDocumentMeta(
      baseHtml,
      {
        ...meta,
        title: 'A <script> & "quotes"',
        description: 'Desc <b>bold</b>',
      },
      'https://tccnc.club',
    );
    expect(html).toContain('<title>A &lt;script&gt; &amp; "quotes"</title>');
    expect(html).toContain('content="Desc &lt;b&gt;bold&lt;/b&gt;"');
    expect(html).toContain('content="A &lt;script&gt; &amp; &quot;quotes&quot;"');
  });
});

describe('resolveSpaDocumentMeta', () => {
  test('returns calendar meta for the public calendar path', async () => {
    const meta = await resolveSpaDocumentMeta('/calendar/public');
    expect(meta.status).toBe(200);
    expect(meta.siteName).toBe(DEFAULT_SITE_NAME);
    expect(meta.title).toBe('Calendar | Triangle Curling');
    expect(meta.description).toContain('club calendar');
    expect(meta.canonicalPath).toBe('/calendar/public');
    expect(meta.ogType).toBe('website');
  });

  test('returns home marketing title', async () => {
    const meta = await resolveSpaDocumentMeta('/');
    expect(meta.status).toBe(200);
    expect(meta.title).toBe('Triangle Curling | Curling in the Triangle');
    expect(meta.description).not.toContain('member portal');
  });

  test('returns not-found meta for unknown routes', async () => {
    const meta = await resolveSpaDocumentMeta('/this-page-does-not-exist');
    expect(meta.status).toBe(404);
    expect(meta.title).toBe('Page not found | Triangle Curling');
    expect(meta.description).toBe(DEFAULT_META_DESCRIPTION);
  });

  test('normalizes trailing slashes and query strings', async () => {
    const meta = await resolveSpaDocumentMeta('/contact/?utm=1');
    expect(meta.status).toBe(200);
    expect(meta.canonicalPath).toBe('/contact');
    expect(meta.title).toContain('Facility & Contact Info');
  });
});
