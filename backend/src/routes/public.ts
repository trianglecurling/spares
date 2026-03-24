import { FastifyInstance } from 'fastify';
import { eq, and, or, sql, asc, desc, gte, isNotNull } from 'drizzle-orm';
import { config } from '../config.js';
import { getFileStorageAdapter } from '../utils/fileStorage.js';
import { publicFileUrl, sanitizeFilename, shouldUseInlineContentDisposition } from '../utils/managedFiles.js';

export type MenuItemNode = {
  id: number;
  label: string;
  linkType: 'internal' | 'external' | null;
  url: string | null;
  openInNewTab: boolean;
  children: MenuItemNode[];
};

/** Markers in article content: everything above is the snippet. Stripped when showing full article. */

function findMarkerIndex(content: string): number {
  const idx = content.indexOf('⁂');
  if (idx >= 0) return idx;
  const legacy = content.indexOf('<!--more-->');
  return legacy >= 0 ? legacy : -1;
}

function getEffectiveSnippet(
  content: string,
  customSnippet: string | null,
  contentType: 'markdown' | 'html' = 'markdown'
): { snippet: string; hasMore: boolean } {
  const SNIPPET_LIMIT = 420;
  const clamp = (value: string): { snippet: string; truncated: boolean } => {
    const normalized = value.trim();
    if (normalized.length <= SNIPPET_LIMIT) return { snippet: normalized, truncated: false };
    return { snippet: `${normalized.slice(0, SNIPPET_LIMIT).trimEnd()}...`, truncated: true };
  };

  if (customSnippet != null && customSnippet.trim() !== '') {
    const clamped = clamp(customSnippet);
    return { snippet: clamped.snippet, hasMore: true };
  }
  if (contentType === 'html') {
    // HTML articles: use custom snippet only; no read-more marker in JSON content
    try {
      const parsed = JSON.parse(content) as { html?: string };
      const html = parsed?.html ?? '';
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      return { snippet: text || '(Custom content)', hasMore: true };
    } catch {
      return { snippet: '(Custom content)', hasMore: true };
    }
  }
  const idx = findMarkerIndex(content);
  if (idx >= 0) {
    let snippet = content.slice(0, idx).trim();
    snippet = snippet.replace(/\$\$widget\d+\s*$/, '').trim();
    const clamped = clamp(snippet);
    return { snippet: clamped.snippet, hasMore: true };
  }
  const clamped = clamp(content);
  return { snippet: clamped.snippet, hasMore: clamped.truncated };
}

function stripMarker(content: string): string {
  return content.replace(/⁂/g, '').replace(/<!--more-->/gi, '').trim();
}
import rrule from 'rrule';
const { RRule } = rrule;
import { getDrizzleDb } from '../db/drizzle-db.js';
import { fetchDirectCalendarEventsForRange } from '../services/calendarExpansion.js';
import { fetchIceBookingsAsCalendarEvents } from '../services/iceBookingsCalendar.js';

const BONSPIEL_LIMIT = 10;

function expandRecurrence(
  startDt: string,
  endDt: string,
  recurrenceRule: string,
  rangeStart: Date,
  rangeEnd: Date,
  endDate?: string
): Array<{ start: string; end: string }> {
  try {
    const start = new Date(startDt);
    const end = new Date(endDt);
    const durationMs = end.getTime() - start.getTime();

    const options = RRule.parseString(recurrenceRule);
    if (endDate) {
      options.until = new Date(endDate + 'T23:59:59');
    }
    (options as { dtstart?: Date }).dtstart = start;

    const rrule = new RRule(options);
    const dates = rrule.between(rangeStart, rangeEnd, true);

    return dates.map((dt) => {
      const instanceStart = dt.toISOString();
      const instanceEnd = new Date(dt.getTime() + durationMs).toISOString();
      return { start: instanceStart, end: instanceEnd };
    });
  } catch {
    return [];
  }
}

export async function publicRoutes(fastify: FastifyInstance) {
  const { db, schema } = getDrizzleDb();
  const frontendBaseUrl = config.frontendUrl.replace(/\/+$/, '');

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

  // GET /public/calendar/events?start=&end= — same shape as /calendar/events; includes anonymized member ice bookings
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
      },
    },
    async (request, reply) => {
      const q = request.query;
      const rangeStart = new Date(q.start);
      const rangeEnd = new Date(q.end);
      if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
        return reply.code(400).send({ error: 'Invalid date range' });
      }
      const [direct, ice] = await Promise.all([
        fetchDirectCalendarEventsForRange(rangeStart, rangeEnd),
        fetchIceBookingsAsCalendarEvents(rangeStart, rangeEnd, 'public'),
      ]);
      return [...direct, ...ice];
    }
  );

  const loadMenuTree = async (menuType: string): Promise<MenuItemNode[]> => {
    const rows = await db
      .select({
        id: schema.menuItems.id,
        parent_id: schema.menuItems.parent_id,
        label: schema.menuItems.label,
        sort_order: schema.menuItems.sort_order,
        link_type: schema.menuItems.link_type,
        url: schema.menuItems.url,
        open_in_new_tab: schema.menuItems.open_in_new_tab,
        article_id: schema.menuItems.article_id,
        use_article_title_for_label: schema.menuItems.use_article_title_for_label,
        articleTitle: schema.articles.title,
      })
      .from(schema.menuItems)
      .leftJoin(schema.articles, eq(schema.menuItems.article_id, schema.articles.id))
      .where(eq(schema.menuItems.menu_type, menuType))
      .orderBy(asc(schema.menuItems.sort_order), asc(schema.menuItems.id));
    const items = rows.map((r) => {
      const useArticleTitle = r.use_article_title_for_label === 1 && r.article_id != null;
      const label = useArticleTitle && r.articleTitle ? r.articleTitle : r.label;
      return {
        id: r.id,
        parentId: r.parent_id ?? null,
        label,
        linkType: r.link_type ?? null,
        url: r.url ?? null,
        openInNewTab: r.open_in_new_tab === 1,
        children: [] as MenuItemNode[],
      };
    });
    const byId = new Map<number, MenuItemNode>();
    for (const item of items) {
      byId.set(item.id, {
        id: item.id,
        label: item.label,
        linkType: item.linkType,
        url: item.url,
        openInNewTab: item.openInNewTab,
        children: [],
      });
    }
    const roots: MenuItemNode[] = [];
    for (const item of items) {
      const node = byId.get(item.id)!;
      if (item.parentId == null) {
        roots.push(node);
      } else {
        const parent = byId.get(item.parentId);
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
    }
    return roots;
  };

  const loadPublicSiteConfig = async () => {
    const [siteConfigRows, serverConfigRows] = await Promise.all([
      db
        .select()
        .from(schema.siteConfig)
        .where(eq(schema.siteConfig.id, 1))
        .limit(1),
      db
        .select({ disable_sms: schema.serverConfig.disable_sms })
        .from(schema.serverConfig)
        .where(eq(schema.serverConfig.id, 1))
        .limit(1),
    ]);
    const row = siteConfigRows[0];
    const serverConfig = serverConfigRows[0];
    if (!row) {
      return {
        clubName: null,
        logoUrl: null,
        contactEmail: null,
        contactPhone: null,
        footerMarkdown: null,
        disableSms: serverConfig?.disable_sms === 1,
      };
    }
    return {
      clubName: row.club_name ?? null,
      logoUrl: row.logo_url ?? null,
      contactEmail: row.contact_email ?? null,
      contactPhone: row.contact_phone ?? null,
      footerMarkdown: row.footer_markdown ?? null,
      disableSms: serverConfig?.disable_sms === 1,
    };
  };

  const loadPublicHomeData = async () => {
    const now = new Date().toISOString();
    const todayDate = now.split('T')[0];

    const [siteConfigRows, serverConfigRows, featuredArticles, showcaseRows, bonspielEvents, sponsorshipRows] = await Promise.all([
      db
        .select()
        .from(schema.siteConfig)
        .where(eq(schema.siteConfig.id, 1))
        .limit(1),
      db
        .select({ disable_sms: schema.serverConfig.disable_sms })
        .from(schema.serverConfig)
        .where(eq(schema.serverConfig.id, 1))
        .limit(1),
      db
        .select({
          id: schema.articles.id,
          title: schema.articles.title,
          slug: schema.articles.slug,
          content_type: schema.articles.content_type,
          content: schema.articles.content,
          snippet: schema.articles.snippet,
        })
        .from(schema.articles)
        .where(
          and(
            eq(schema.articles.featured, 1),
            isNotNull(schema.articles.published_at),
            sql`${schema.articles.published_at} <= ${now}`
          )
        )
        .orderBy(asc(schema.articles.featured_sort_order), desc(schema.articles.published_at))
        .limit(6),
      db
        .select()
        .from(schema.showcaseImages)
        .orderBy(asc(schema.showcaseImages.sort_order), asc(schema.showcaseImages.id))
        .limit(12),
      db
        .select()
        .from(schema.calendarEvents)
        .where(
          and(
            eq(schema.calendarEvents.source, 'direct'),
            eq(schema.calendarEvents.type_id, 'bonspiel'),
            sql`${schema.calendarEvents.parent_event_id} IS NULL`,
            sql`${schema.calendarEvents.recurrence_date} IS NULL`,
            or(
              sql`${schema.calendarEvents.recurrence_rule} IS NOT NULL`,
              sql`${schema.calendarEvents.start_dt} >= ${now}`
            )
          )
        )
        .orderBy(asc(schema.calendarEvents.start_dt)),
      db
        .select({
          sponsorshipId: schema.sponsorships.id,
          sponsorId: schema.sponsors.id,
          sponsorName: schema.sponsors.name,
          sponsorWebsiteUrl: schema.sponsors.website_url,
          logoFileId: schema.sponsors.logo_file_id,
          logoChecksumSha256: schema.files.checksum_sha256,
          logoDisplayName: schema.files.display_name,
          logoOriginalFilename: schema.files.original_filename,
          levelSortOrder: schema.sponsorshipLevels.sort_order,
        })
        .from(schema.sponsorships)
        .innerJoin(schema.sponsors, eq(schema.sponsorships.sponsor_id, schema.sponsors.id))
        .innerJoin(schema.sponsorshipLevels, eq(schema.sponsorships.sponsorship_level_id, schema.sponsorshipLevels.id))
        .leftJoin(schema.files, eq(schema.sponsors.logo_file_id, schema.files.id))
        .where(
          and(
            or(sql`${schema.sponsorships.start_date} IS NULL`, sql`${schema.sponsorships.start_date} <= ${todayDate}`),
            or(sql`${schema.sponsorships.end_date} IS NULL`, sql`${schema.sponsorships.end_date} >= ${todayDate}`)
          )
        )
        .orderBy(asc(schema.sponsorshipLevels.sort_order), asc(schema.sponsorships.id)),
    ]);

    const siteConfig = siteConfigRows[0];
    const serverConfig = serverConfigRows[0];
    const rangeStart = new Date();
    const rangeEnd = new Date();
    rangeEnd.setMonth(rangeEnd.getMonth() + 6);

    const bonspiels: Array<{ id: string; title: string; start: string; end: string; allDay: boolean }> = [];
    for (const ev of bonspielEvents) {
      if (ev.recurrence_rule) {
        const expanded = expandRecurrence(
          ev.start_dt,
          ev.end_dt,
          ev.recurrence_rule,
          rangeStart,
          rangeEnd
        );
        for (const inc of expanded) {
          if (new Date(inc.start) >= rangeStart && bonspiels.length < BONSPIEL_LIMIT) {
            bonspiels.push({
              id: `direct:${ev.id}:${inc.start.slice(0, 10)}`,
              title: ev.title,
              start: inc.start,
              end: inc.end,
              allDay: ev.all_day === 1,
            });
          }
        }
      } else if (ev.start_dt >= now && bonspiels.length < BONSPIEL_LIMIT) {
        bonspiels.push({
          id: `direct:${ev.id}`,
          title: ev.title,
          start: ev.start_dt,
          end: ev.end_dt,
          allDay: ev.all_day === 1,
        });
      }
      if (bonspiels.length >= BONSPIEL_LIMIT) break;
    }
    bonspiels.sort((a, b) => a.start.localeCompare(b.start));
    const upcomingBonspiels = bonspiels.slice(0, BONSPIEL_LIMIT);

    return {
      siteConfig: siteConfig
        ? {
            clubName: siteConfig.club_name ?? null,
            logoUrl: siteConfig.logo_url ?? null,
            contactEmail: siteConfig.contact_email ?? null,
            contactPhone: siteConfig.contact_phone ?? null,
            footerMarkdown: siteConfig.footer_markdown ?? null,
            disableSms: serverConfig?.disable_sms === 1,
          }
        : null,
      featuredArticles: featuredArticles.map((a) => {
        const { snippet, hasMore } = getEffectiveSnippet(
          a.content ?? '',
          a.snippet,
          (a.content_type ?? 'markdown') as 'markdown' | 'html'
        );
        return {
          id: a.id,
          title: a.title,
          slug: a.slug,
          snippet,
          hasMore,
        };
      }),
      showcaseImages: showcaseRows.map((img) => ({
        id: img.id,
        url: img.url,
        caption: img.caption ?? null,
      })),
      currentSponsorships: sponsorshipRows.map((row) => ({
        sponsorshipId: row.sponsorshipId,
        sponsorId: row.sponsorId,
        sponsorName: row.sponsorName,
        sponsorWebsiteUrl: row.sponsorWebsiteUrl,
        sponsorLogoUrl: row.logoFileId
          ? publicFileUrl(
              row.logoFileId,
              row.logoDisplayName || row.logoOriginalFilename || `file-${row.logoFileId}`,
              row.logoChecksumSha256
            )
          : null,
        levelSortOrder: row.levelSortOrder,
      })),
      upcomingBonspiels,
    };
  };

  // GET /public/menus/:type - Menu tree for public nav (e.g. navbar, footer)
  fastify.get<{ Params: { type: string } }>('/public/menus/:type', async (request) => {
    const menuType = request.params.type || 'navbar';
    return loadMenuTree(menuType);
  });

  // GET /public/site-config - Lightweight site config for header/footer
  fastify.get('/public/site-config', async () => {
    return loadPublicSiteConfig();
  });

  // GET /public/bootstrap?includeHome=true - Shared payload for public shell (+ optional homepage content)
  fastify.get<{ Querystring: { includeHome?: string } }>('/public/bootstrap', async (request) => {
    const includeHome = request.query.includeHome === 'true' || request.query.includeHome === '1';
    if (includeHome) {
      const [home, navbarMenu] = await Promise.all([loadPublicHomeData(), loadMenuTree('navbar')]);
      return {
        siteConfig: home.siteConfig,
        navbarMenu,
        home,
      };
    }
    const [siteConfig, navbarMenu] = await Promise.all([loadPublicSiteConfig(), loadMenuTree('navbar')]);
    return {
      siteConfig,
      navbarMenu,
      home: null,
    };
  });

  // GET /public/home - Homepage data
  fastify.get('/public/home', async () => {
    return loadPublicHomeData();
  });

  // GET /public/articles?featured=true
  fastify.get<{
    Querystring: { featured?: string };
  }>('/public/articles', async (request) => {
    const { featured: featuredParam } = request.query ?? {};
    const now = new Date().toISOString();

    const conditions = [
      isNotNull(schema.articles.published_at),
      sql`${schema.articles.published_at} <= ${now}`,
    ];
    if (featuredParam === 'true') {
      conditions.push(eq(schema.articles.featured, 1));
    }

    const rows = await db
      .select({
        id: schema.articles.id,
        title: schema.articles.title,
        slug: schema.articles.slug,
        content_type: schema.articles.content_type,
        content: schema.articles.content,
        snippet: schema.articles.snippet,
        publishedAt: schema.articles.published_at,
      })
      .from(schema.articles)
      .where(and(...conditions))
      .orderBy(
        featuredParam === 'true'
          ? asc(schema.articles.featured_sort_order)
          : desc(schema.articles.published_at),
        desc(schema.articles.published_at)
      )
      .limit(50);

    return rows.map((r) => {
      const { snippet, hasMore } = getEffectiveSnippet(
        r.content ?? '',
        r.snippet ?? null,
        (r.content_type ?? 'markdown') as 'markdown' | 'html'
      );
      return {
        id: r.id,
        title: r.title,
        slug: r.slug,
        snippet,
        hasMore,
        publishedAt: r.publishedAt ?? null,
      };
    });
  });

  // GET /public/articles/:slug - Single article
  fastify.get<{ Params: { slug: string } }>('/public/articles/:slug', async (request, reply) => {
    const { slug } = request.params;
    const now = new Date().toISOString();

    const rows = await db
      .select({
        id: schema.articles.id,
        title: schema.articles.title,
        slug: schema.articles.slug,
        content_type: schema.articles.content_type,
        content: schema.articles.content,
        snippet: schema.articles.snippet,
        publishedAt: schema.articles.published_at,
      })
      .from(schema.articles)
      .where(
        and(
          eq(schema.articles.slug, slug),
          isNotNull(schema.articles.published_at),
          sql`${schema.articles.published_at} <= ${now}`
        )
      )
      .limit(1);

    const article = rows[0];
    if (!article) {
      return reply.code(404).send({ error: 'Article not found' });
    }

    const contentType = (article.content_type as 'markdown' | 'html') ?? 'markdown';
    const content =
      contentType === 'markdown' ? stripMarker(article.content ?? '') : article.content ?? '';

    return {
      id: article.id,
      title: article.title,
      slug: article.slug,
      contentType,
      content,
      snippet: article.snippet ?? null,
      publishedAt: article.publishedAt ?? null,
    };
  });

  // GET /public/upcoming-bonspiels
  fastify.get('/public/upcoming-bonspiels', async () => {
    const now = new Date().toISOString();
    const rangeStart = new Date();
    const rangeEnd = new Date();
    rangeEnd.setMonth(rangeEnd.getMonth() + 6);

    const events = await db
      .select()
      .from(schema.calendarEvents)
      .where(
        and(
          eq(schema.calendarEvents.source, 'direct'),
          eq(schema.calendarEvents.type_id, 'bonspiel'),
          sql`${schema.calendarEvents.parent_event_id} IS NULL`,
          sql`${schema.calendarEvents.recurrence_date} IS NULL`,
          or(
            sql`${schema.calendarEvents.recurrence_rule} IS NOT NULL`,
            sql`${schema.calendarEvents.start_dt} >= ${now}`
          )
        )
      )
      .orderBy(asc(schema.calendarEvents.start_dt));

    const bonspiels: Array<{ id: string; title: string; start: string; end: string; allDay: boolean }> = [];
    for (const ev of events) {
      if (ev.recurrence_rule) {
        const expanded = expandRecurrence(
          ev.start_dt,
          ev.end_dt,
          ev.recurrence_rule,
          rangeStart,
          rangeEnd
        );
        for (const inc of expanded) {
          if (new Date(inc.start) >= rangeStart && bonspiels.length < BONSPIEL_LIMIT) {
            bonspiels.push({
              id: `direct:${ev.id}:${inc.start.slice(0, 10)}`,
              title: ev.title,
              start: inc.start,
              end: inc.end,
              allDay: ev.all_day === 1,
            });
          }
        }
      } else if (ev.start_dt >= now && bonspiels.length < BONSPIEL_LIMIT) {
        bonspiels.push({
          id: `direct:${ev.id}`,
          title: ev.title,
          start: ev.start_dt,
          end: ev.end_dt,
          allDay: ev.all_day === 1,
        });
      }
      if (bonspiels.length >= BONSPIEL_LIMIT) break;
    }
    bonspiels.sort((a, b) => a.start.localeCompare(b.start));
    return bonspiels.slice(0, BONSPIEL_LIMIT);
  });

  // GET /sitemap.xml - Sitemap for search engines
  fastify.get('/sitemap.xml', async (_request, reply) => {
    const now = new Date().toISOString();
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
          sql`${schema.articles.published_at} <= ${now}`
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
}
