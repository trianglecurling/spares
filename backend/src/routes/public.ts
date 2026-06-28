import { FastifyInstance } from 'fastify';
import { eq, and, sql, desc, isNotNull, notExists } from 'drizzle-orm';
import { config } from '../config.js';
import { getFileStorageAdapter } from '../utils/fileStorage.js';
import { publicFileUrl, sanitizeFilename, shouldUseInlineContentDisposition } from '../utils/managedFiles.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { getPublicCalendarBundle, getUpcomingBonspiels } from '../domains/calendar/queries/calendarReadFacade.js';
import {
  getMenuTree,
  getPublicArticleBySlug,
  getPublishedPublicEventSlugForArticlePathAlias,
  getPublicArticleBodyByIdForPublishedPublicEvent,
  getPublicHomeData,
  getPublicSiteConfig,
  listPublicArticles,
} from '../domains/public/queries/publicReadFacade.js';
import {
  getCachedPublicBootstrap,
  getPublicBootstrapCacheEtag,
} from '../services/publicBootstrapCache.js';
import { getPublicLeaguesPage } from '../services/publicLeaguesService.js';
import { listPublicContactRecipients } from '../domains/content/publicContactRecipients.js';
import { resolveSpaDocumentHttpStatus } from '../services/spaDocumentStatus.js';

export async function publicRoutes(fastify: FastifyInstance) {
  const { db, schema } = getDrizzleDb();
  const frontendBaseUrl = config.frontendUrl.replace(/\/+$/, '');

  fastify.get<{ Querystring: { path?: string } }>('/public/document-status', async (request, reply) => {
    const rawPath = request.query.path;
    if (!rawPath || typeof rawPath !== 'string' || !rawPath.startsWith('/')) {
      return reply.code(400).send({ error: 'path query parameter is required' });
    }
    const status = await resolveSpaDocumentHttpStatus(rawPath);
    return reply.code(status).send({ status });
  });

  fastify.get<{ Params: { id: string }; Querystring: { v?: string } }>('/public/files/:id/:slug?', async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });

    const [row] = await db.select().from(schema.files).where(eq(schema.files.id, id)).limit(1);
    if (!row || row.visibility !== 'public') {
      return reply.code(404).send({ error: 'File not found' });
    }
    const requestedVersion = request.query.v;
    if (row.checksum_sha256 && requestedVersion !== row.checksum_sha256) {
      const latestUrl = publicFileUrl(row.id, row.display_name || row.original_filename, row.checksum_sha256);
      return reply.redirect(latestUrl, 302);
    }

    const downloadName = sanitizeFilename(row.display_name || row.original_filename);
    const isInline = shouldUseInlineContentDisposition(row.mime_type);
    const etag = row.checksum_sha256 ? `"${row.checksum_sha256}"` : `W/"${row.id}-${row.byte_size}"`;

    reply.header('Content-Type', row.mime_type);
    reply.header('Content-Length', String(row.byte_size));
    reply.header('ETag', etag);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.header('Content-Disposition', `${isInline ? 'inline' : 'attachment'}; filename="${downloadName}"`);

    const stream = await getFileStorageAdapter().getReadStream(row.storage_key);
    return reply.send(stream);
  });

  fastify.get<{ Params: { id: string }; Querystring: { v?: string } }>('/public/files/:id/thumbnail', async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const [row] = await db.select().from(schema.files).where(eq(schema.files.id, id)).limit(1);
    if (!row || row.visibility !== 'public') {
      return reply.code(404).send({ error: 'File not found' });
    }
    if (!row.thumbnail_storage_key || !row.thumbnail_mime_type || !row.thumbnail_byte_size) {
      return reply.code(404).send({ error: 'Thumbnail not found' });
    }
    const latestVersion = row.thumbnail_checksum_sha256 || row.checksum_sha256;
    if (latestVersion && request.query.v !== latestVersion) {
      return reply.redirect(`/api/public/files/${row.id}/thumbnail?v=${latestVersion}`, 302);
    }

    const etag = row.thumbnail_checksum_sha256
      ? `"${row.thumbnail_checksum_sha256}"`
      : `W/"thumb-${row.id}-${row.thumbnail_byte_size}"`;
    reply.header('Content-Type', row.thumbnail_mime_type);
    reply.header('Content-Length', String(row.thumbnail_byte_size));
    reply.header('ETag', etag);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.header('Content-Disposition', 'inline');
    const stream = await getFileStorageAdapter().getReadStream(row.thumbnail_storage_key);
    return reply.send(stream);
  });

  // GET /public/calendar/events?start=&end=
  // Bundle: direct/public ice/registrable events, league draw schedule, and active sheet id/name (no auth).
  fastify.get<{ Querystring: { start: string; end: string } }>(
    '/public/calendar/events',
    {
      schema: {
        tags: ['public'],
        querystring: {
          type: 'object',
          required: ['start', 'end'],
          properties: {
            start: { type: 'string', description: 'ISO date or datetime' },
            end: { type: 'string', description: 'ISO date or datetime' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['events', 'sheets', 'leagueEvents'],
            properties: {
              events: {
                type: 'array',
                description: 'Calendar event payloads (same shape as GET /calendar/events for a public-only viewer).',
                items: { type: 'object', additionalProperties: true },
              },
              leagueEvents: {
                type: 'array',
                description: 'League draw schedule (same shape as GET /calendar/league-events).',
                items: { type: 'object', additionalProperties: true },
              },
              sheets: {
                type: 'array',
                description: 'Active ice sheets for resolving location labels.',
                items: {
                  type: 'object',
                  required: ['id', 'name'],
                  properties: {
                    id: { type: 'number' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query;
      if (Number.isNaN(new Date(q.start).getTime()) || Number.isNaN(new Date(q.end).getTime())) {
        return reply.code(400).send({ error: 'Invalid date range' });
      }
      return getPublicCalendarBundle(q.start, q.end);
    }
  );

  // GET /public/menus/:type - Menu tree for public nav (e.g. navbar, footer)
  fastify.get<{ Params: { type: string } }>('/public/menus/:type', async (request) => {
    const menuType = request.params.type || 'navbar';
    return getMenuTree(menuType);
  });

  // GET /public/site-config - Lightweight site config for header/footer
  fastify.get('/public/site-config', async () => {
    return getPublicSiteConfig();
  });

  // GET /public/bootstrap?includeHome=true - Shared payload for public shell (+ optional homepage content)
  fastify.get<{ Querystring: { includeHome?: string } }>('/public/bootstrap', async (request, reply) => {
    const includeHome = request.query.includeHome === 'true' || request.query.includeHome === '1';
    const etag = getPublicBootstrapCacheEtag(includeHome);
    reply.header('Cache-Control', 'private, max-age=0, must-revalidate');
    reply.header('ETag', etag);
    if (request.headers['if-none-match'] === etag) {
      return reply.code(304).send();
    }
    return getCachedPublicBootstrap(includeHome);
  });

  // GET /public/home - Homepage data
  fastify.get('/public/home', async () => {
    return getPublicHomeData();
  });

  // GET /public/articles?featured=true
  fastify.get<{
    Querystring: { featured?: string };
  }>('/public/articles', async (request) => {
    const { featured: featuredParam } = request.query ?? {};
    return listPublicArticles(featuredParam === 'true');
  });

  // GET /public/articles/by-id/:id — event detail body (linked published public event only)
  fastify.get<{ Params: { id: string } }>('/public/articles/by-id/:id', async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    const article = await getPublicArticleBodyByIdForPublishedPublicEvent(id);
    if (!article) {
      return reply.code(404).send({ error: 'Article not found' });
    }
    return article;
  });

  // GET /public/articles/:slug - Single article (or hint to redirect to a public event page)
  fastify.get<{ Params: { slug: string } }>('/public/articles/:slug', async (request, reply) => {
    const { slug } = request.params;
    const article = await getPublicArticleBySlug(slug);
    if (article) {
      return article;
    }
    const eventSlug = await getPublishedPublicEventSlugForArticlePathAlias(slug);
    if (eventSlug) {
      return reply.code(404).send({ error: 'Article not found', redirectToEventSlug: eventSlug });
    }
    return reply.code(404).send({ error: 'Article not found' });
  });

  // GET /public/upcoming-bonspiels
  fastify.get('/public/upcoming-bonspiels', async () => {
    return getUpcomingBonspiels();
  });

  // GET /sitemap.xml - Sitemap for search engines
  fastify.get('/sitemap.xml', async (_request, reply) => {
    const now = new Date().toISOString();
    const notEventBodyArticle = notExists(
      db
        .select({ one: sql`1` })
        .from(schema.events)
        .where(eq(schema.events.article_id, schema.articles.id)),
    );
    const articleRows = await db
      .select({
        slug: schema.articles.slug,
        updatedAt: schema.articles.updated_at,
        publishedAt: schema.articles.published_at,
      })
      .from(schema.articles)
      .where(
        and(
          isNotNull(schema.articles.published_at),
          sql`${schema.articles.published_at} <= ${now}`,
          notEventBodyArticle,
        )
      )
      .orderBy(desc(schema.articles.published_at))
      .limit(5000);

    type SitemapEntry = {
      loc: string;
      lastmod?: string;
      changefreq: 'daily' | 'weekly' | 'monthly';
      priority: string;
    };

    const staticUrls: SitemapEntry[] = [
      { loc: `${frontendBaseUrl}/`, changefreq: 'daily', priority: '1.0' },
      { loc: `${frontendBaseUrl}/articles`, changefreq: 'daily', priority: '0.8' },
      { loc: `${frontendBaseUrl}/contact`, changefreq: 'weekly', priority: '0.7' },
    ];
    const articleUrls: SitemapEntry[] = articleRows.map((row) => ({
      loc: `${frontendBaseUrl}/articles/${row.slug}`,
      lastmod: row.updatedAt
        ? new Date(row.updatedAt).toISOString()
        : row.publishedAt
          ? new Date(row.publishedAt).toISOString()
          : undefined,
      changefreq: 'weekly',
      priority: '0.7',
    }));

    const items = [...staticUrls, ...articleUrls]
      .map(
        (item) => `
  <url>
    <loc>${item.loc}</loc>${item.lastmod ? `\n    <lastmod>${item.lastmod}</lastmod>` : ''}
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`
      )
      .join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}
</urlset>`;

    return reply
      .type('application/xml; charset=utf-8')
      .send(xml);
  });

  // GET /robots.txt - crawler directives
  fastify.get('/robots.txt', async (_request, reply) => {
    const body = `User-agent: *
Allow: /

Sitemap: ${frontendBaseUrl}/api/sitemap.xml
`;
    return reply.type('text/plain; charset=utf-8').send(body);
  });

  /** Public metadata for a permalink (used by /go/:slug/info page). */
  fastify.get<{ Params: { slug: string } }>('/public/permalinks/:slug', async (request, reply) => {
    const slug = request.params.slug?.trim().toLowerCase();
    if (!slug) return reply.code(400).send({ error: 'Invalid slug' });
    const [row] = await db
      .select()
      .from(schema.permalinks)
      .where(eq(schema.permalinks.slug, slug))
      .limit(1);
    if (!row) return reply.code(404).send({ error: 'Permalink not found' });
    return {
      slug: row.slug,
      label: row.label,
      destinationUrl: row.destination_url,
      destinationMayChange: row.destination_may_change === 1,
      shortLinkUrl: `${frontendBaseUrl}/go/${row.slug}`,
      infoUrl: `${frontendBaseUrl}/go/${row.slug}/info`,
    };
  });

  fastify.get<{ Querystring: { sessionId?: string } }>('/public/leagues', async (request, reply) => {
    const rawSessionId = request.query.sessionId;
    const sessionId =
      rawSessionId != null && rawSessionId !== ''
        ? Number.parseInt(String(rawSessionId), 10)
        : undefined;
    if (sessionId != null && !Number.isFinite(sessionId)) {
      return reply.code(400).send({ error: 'Invalid sessionId' });
    }

    const payload = await getPublicLeaguesPage(sessionId);
    if (!payload) {
      return reply.code(404).send({ error: 'No leagues found for the requested session' });
    }
    return payload;
  });

  fastify.get('/public/contact-recipients', async () => {
    const rows = await listPublicContactRecipients({ activeOnly: true });
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      label: row.label,
      sortOrder: row.sortOrder,
    }));
  });
}
