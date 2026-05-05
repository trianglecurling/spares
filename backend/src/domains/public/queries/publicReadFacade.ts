import { and, asc, desc, eq, exists, inArray, isNotNull, notExists, or, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../../../db/drizzle-db.js';
import { getUpcomingBonspiels } from '../../calendar/queries/calendarReadFacade.js';
import { publicFileUrl } from '../../../utils/managedFiles.js';

export type MenuItemNode = {
  id: number;
  label: string;
  linkType: 'internal' | 'external' | null;
  url: string | null;
  openInNewTab: boolean;
  children: MenuItemNode[];
};

type PublicSiteConfig = {
  clubName: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  footerMarkdown: string | null;
  disableSms: boolean;
  /** `MM-DD` (month-day) fiscal year start from governance; used for public season labels (e.g. 2025-26). */
  fiscalYearStartMmdd: string;
};

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
  const snippetLimit = 420;
  const clamp = (value: string): { snippet: string; truncated: boolean } => {
    const normalized = value.trim();
    if (normalized.length <= snippetLimit) return { snippet: normalized, truncated: false };
    return { snippet: `${normalized.slice(0, snippetLimit).trimEnd()}...`, truncated: true };
  };

  if (customSnippet != null && customSnippet.trim() !== '') {
    const clamped = clamp(customSnippet);
    return { snippet: clamped.snippet, hasMore: true };
  }
  if (contentType === 'html') {
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
    const clamped = clamp(content.slice(0, idx).trim().replace(/\$\$widget\d+\s*$/, '').trim());
    return { snippet: clamped.snippet, hasMore: true };
  }

  const clamped = clamp(content);
  return { snippet: clamped.snippet, hasMore: clamped.truncated };
}

function stripMarker(content: string): string {
  return content.replace(/⁂/g, '').replace(/<!--more-->/gi, '').trim();
}

export async function getMenuTree(menuType: string): Promise<MenuItemNode[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.menuItems.id,
      parent_id: schema.menuItems.parent_id,
      label: schema.menuItems.label,
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

  const items = rows.map((row) => {
    const useArticleTitle = row.use_article_title_for_label === 1 && row.article_id != null;
    return {
      id: row.id,
      parentId: row.parent_id ?? null,
      label: useArticleTitle && row.articleTitle ? row.articleTitle : row.label,
      linkType: row.link_type ?? null,
      url: row.url ?? null,
      openInNewTab: row.open_in_new_tab === 1,
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
      continue;
    }

    const parent = byId.get(item.parentId);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function getPublicSiteConfig(): Promise<PublicSiteConfig> {
  const { db, schema } = getDrizzleDb();
  const [siteConfigRows, serverConfigRows, governanceRows] = await Promise.all([
    db.select().from(schema.siteConfig).where(eq(schema.siteConfig.id, 1)).limit(1),
    db
      .select({ disable_sms: schema.serverConfig.disable_sms })
      .from(schema.serverConfig)
      .where(eq(schema.serverConfig.id, 1))
      .limit(1),
    db
      .select({ mmdd: schema.governanceSettings.fiscal_year_start_mmdd })
      .from(schema.governanceSettings)
      .where(eq(schema.governanceSettings.id, 1))
      .limit(1),
  ]);

  const siteConfig = siteConfigRows[0];
  const serverConfig = serverConfigRows[0];
  const fiscalYearStartMmdd = governanceRows[0]?.mmdd?.trim() || '09-01';
  if (!siteConfig) {
    return {
      clubName: null,
      logoUrl: null,
      contactEmail: null,
      contactPhone: null,
      footerMarkdown: null,
      disableSms: serverConfig?.disable_sms === 1,
      fiscalYearStartMmdd,
    };
  }

  return {
    clubName: siteConfig.club_name ?? null,
    logoUrl: siteConfig.logo_url ?? null,
    contactEmail: siteConfig.contact_email ?? null,
    contactPhone: siteConfig.contact_phone ?? null,
    footerMarkdown: siteConfig.footer_markdown ?? null,
    disableSms: serverConfig?.disable_sms === 1,
    fiscalYearStartMmdd,
  };
}

export async function getPublicHomeData() {
  const { db, schema } = getDrizzleDb();
  const now = new Date().toISOString();
  const todayDate = now.split('T')[0];

  const featuredPublishedNormally = and(
    isNotNull(schema.articles.published_at),
    sql`${schema.articles.published_at} <= ${now}`,
  );
  const featuredViaPublishedPublicEvent = exists(
    db
      .select({ one: sql`1` })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.article_id, schema.articles.id),
          eq(schema.events.published, 1),
          eq(schema.events.visibility, 'public'),
        ),
      ),
  );

  const [siteConfig, featuredArticleRows, showcaseRows, sponsorshipRows, upcomingBonspiels] = await Promise.all([
    getPublicSiteConfig(),
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
          or(featuredPublishedNormally, featuredViaPublishedPublicEvent),
        ),
      )
      .orderBy(
        asc(schema.articles.featured_sort_order),
        desc(sql`coalesce(${schema.articles.published_at}, ${schema.articles.updated_at})`),
      )
      .limit(6),
    db
      .select()
      .from(schema.showcaseImages)
      .orderBy(asc(schema.showcaseImages.sort_order), asc(schema.showcaseImages.id))
      .limit(12),
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
          or(sql`${schema.sponsorships.end_date} IS NULL`, sql`${schema.sponsorships.end_date} >= ${todayDate}`),
        ),
      )
      .orderBy(asc(schema.sponsorshipLevels.sort_order), asc(schema.sponsorships.id)),
    getUpcomingBonspiels(),
  ]);

  const featuredIds = featuredArticleRows.map((a) => a.id);
  const eventSlugByArticleId = new Map<number, string>();
  if (featuredIds.length > 0) {
    const eventLinkRows = await db
      .select({
        articleId: schema.events.article_id,
        slug: schema.events.slug,
      })
      .from(schema.events)
      .where(and(isNotNull(schema.events.article_id), inArray(schema.events.article_id, featuredIds)));

    for (const row of eventLinkRows) {
      if (row.articleId != null && !eventSlugByArticleId.has(row.articleId)) {
        eventSlugByArticleId.set(row.articleId, row.slug);
      }
    }
  }

  return {
    siteConfig,
    featuredArticles: featuredArticleRows.map((article) => {
      const { snippet, hasMore } = getEffectiveSnippet(
        article.content ?? '',
        article.snippet,
        (article.content_type ?? 'markdown') as 'markdown' | 'html',
      );
      return {
        id: article.id,
        title: article.title,
        slug: article.slug,
        snippet,
        hasMore,
        eventSlug: eventSlugByArticleId.get(article.id) ?? null,
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
            row.logoChecksumSha256,
          )
        : null,
      levelSortOrder: row.levelSortOrder,
    })),
    upcomingBonspiels,
  };
}

export async function getPublicBootstrap(includeHome: boolean) {
  if (includeHome) {
    const [home, navbarMenu] = await Promise.all([getPublicHomeData(), getMenuTree('navbar')]);
    return {
      siteConfig: home.siteConfig,
      navbarMenu,
      home,
    };
  }

  const [siteConfig, navbarMenu] = await Promise.all([getPublicSiteConfig(), getMenuTree('navbar')]);
  return {
    siteConfig,
    navbarMenu,
    home: null,
  };
}

export async function listPublicArticles(featuredOnly: boolean) {
  const { db, schema } = getDrizzleDb();
  const now = new Date().toISOString();
  const notOwnedByEvent = notExists(
    db
      .select({ one: sql`1` })
      .from(schema.events)
      .where(eq(schema.events.article_id, schema.articles.id)),
  );
  const conditions = [
    isNotNull(schema.articles.published_at),
    sql`${schema.articles.published_at} <= ${now}`,
    notOwnedByEvent,
  ];
  if (featuredOnly) {
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
      featuredOnly ? asc(schema.articles.featured_sort_order) : desc(schema.articles.published_at),
      desc(schema.articles.published_at),
    )
    .limit(50);

  return rows.map((row) => {
    const { snippet, hasMore } = getEffectiveSnippet(
      row.content ?? '',
      row.snippet ?? null,
      (row.content_type ?? 'markdown') as 'markdown' | 'html',
    );
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      snippet,
      hasMore,
      publishedAt: row.publishedAt ?? null,
    };
  });
}

/**
 * Article body for an event detail page: no standalone publish date required;
 * visibility is gated by a linked published public event.
 */
export async function getPublicArticleBodyByIdForPublishedPublicEvent(articleId: number) {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      title: schema.articles.title,
      content_type: schema.articles.content_type,
      content: schema.articles.content,
    })
    .from(schema.articles)
    .innerJoin(schema.events, eq(schema.events.article_id, schema.articles.id))
    .where(
      and(
        eq(schema.articles.id, articleId),
        eq(schema.events.published, 1),
        eq(schema.events.visibility, 'public'),
      ),
    )
    .limit(1);

  const article = rows[0];
  if (!article) {
    return null;
  }

  const contentType = (article.content_type as 'markdown' | 'html') ?? 'markdown';
  return {
    title: article.title,
    contentType,
    content: contentType === 'markdown' ? stripMarker(article.content ?? '') : article.content ?? '',
  };
}

/**
 * When `/articles/:slug` is requested but there is no standalone published article with that
 * slug (event detail articles are excluded from that list), still allow navigation if a
 * published public event uses the same path segment as its `slug` or its linked article's slug.
 * Returns the event's canonical `slug` for redirect to `/events/:slug`.
 */
export async function getPublishedPublicEventSlugForArticlePathAlias(slug: string): Promise<string | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ slug: schema.events.slug })
    .from(schema.events)
    .leftJoin(schema.articles, eq(schema.events.article_id, schema.articles.id))
    .where(
      and(
        eq(schema.events.published, 1),
        eq(schema.events.visibility, 'public'),
        or(
          eq(schema.events.slug, slug),
          and(isNotNull(schema.events.article_id), eq(schema.articles.slug, slug)),
        ),
      ),
    )
    .limit(1);

  return rows[0]?.slug ?? null;
}

export async function getPublicArticleBySlug(slug: string) {
  const { db, schema } = getDrizzleDb();
  const now = new Date().toISOString();
  const notOwnedByEvent = notExists(
    db
      .select({ one: sql`1` })
      .from(schema.events)
      .where(eq(schema.events.article_id, schema.articles.id)),
  );
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
        sql`${schema.articles.published_at} <= ${now}`,
        notOwnedByEvent,
      ),
    )
    .limit(1);

  const article = rows[0];
  if (!article) {
    return null;
  }

  const contentType = (article.content_type as 'markdown' | 'html') ?? 'markdown';
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    contentType,
    content: contentType === 'markdown' ? stripMarker(article.content ?? '') : article.content ?? '',
    snippet: article.snippet ?? null,
    publishedAt: article.publishedAt ?? null,
  };
}
