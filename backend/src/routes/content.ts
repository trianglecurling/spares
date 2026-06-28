import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, asc, desc, inArray, notExists, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isUniqueConstraintViolation } from '../api/errors.js';
import { isContentAdmin } from '../utils/auth.js';
import { generateArticleCss } from '../utils/generateArticleCss.js';
import type { Member } from '../types.js';

async function ensureGeneratedCss(content: string, contentType: string): Promise<string> {
  if (contentType !== 'html') return content;
  try {
    const parsed = JSON.parse(content) as { html?: string; css?: string; js?: string; generated_css?: string };
    const html = parsed?.html ?? '';
    if (!html.trim()) return content;
    const generatedCss = await generateArticleCss(html);
    const updated = { ...parsed, generated_css: generatedCss };
    return JSON.stringify(updated);
  } catch {
    return content;
  }
}

const articleBodySchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  contentType: z.enum(['markdown', 'html']).optional(),
  content: z.string(),
  revisionNote: z.string().max(500).nullable().optional(),
  smallEdit: z.boolean().optional(),
  snippet: z.string().nullable().optional(),
  featured: z.boolean().optional(),
  featuredSortOrder: z.number().int().nonnegative().optional(),
  publishedAt: z.string().nullable().optional(),
});

function isAbsoluteOrRootRelativeUrl(value: string): boolean {
  if (value.startsWith('/')) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const absoluteOrRootRelativeUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isAbsoluteOrRootRelativeUrl, 'URL must be absolute or root-relative');

const optionalAbsoluteOrRootRelativeUrlSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => {
    if (value == null) return value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  })
  .refine(
    (value) => value == null || isAbsoluteOrRootRelativeUrl(value),
    'URL must be absolute or root-relative',
  );

const siteConfigBodySchema = z.object({
  clubName: z.string().nullable().optional(),
  logoUrl: optionalAbsoluteOrRootRelativeUrlSchema,
  contactEmail: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  physicalAddressLine1: z.string().nullable().optional(),
  physicalAddressLine2: z.string().nullable().optional(),
  mailingAddressLine1: z.string().nullable().optional(),
  mailingAddressLine2: z.string().nullable().optional(),
  footerMarkdown: z.string().nullable().optional(),
  heroBadge: z.string().nullable().optional(),
  heroTitle: z.string().nullable().optional(),
  heroSubtitle: z.string().nullable().optional(),
  announcementMarkdown: z.string().nullable().optional(),
  announcementExpiresAt: z
    .string()
    .nullable()
    .optional()
    .refine((value) => value == null || !Number.isNaN(new Date(value).getTime()), {
      message: 'Invalid date',
    }),
});

function siteConfigTimestampToIso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const showcaseImageUrlSchema = absoluteOrRootRelativeUrlSchema;

const showcaseImageBodySchema = z.object({
  url: showcaseImageUrlSchema,
  caption: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
});

const menuItemBodySchema = z.object({
  menuType: z.string().min(1).default('navbar'),
  parentId: z.number().nullable().optional(),
  label: z.string().min(1),
  sortOrder: z.number().optional(),
  linkType: z.enum(['internal', 'external']).nullable().optional(),
  url: z.string().nullable().optional(),
  openInNewTab: z.boolean().optional(),
  articleId: z.number().nullable().optional(),
  useArticleTitleForLabel: z.boolean().optional(),
});

const contactRecipientSlugSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/);

const contactRecipientCreateSchema = z.object({
  slug: contactRecipientSlugSchema,
  label: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const contactRecipientUpdateSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(320).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const contactRecipientsReorderSchema = z.object({
  updates: z.array(z.object({ id: z.number(), sortOrder: z.number() })).min(1),
});

function mapContactRecipientRow(row: {
  id: number;
  slug: string;
  label: string;
  email: string;
  sort_order: number;
  is_active: number;
  created_at: string | Date;
  updated_at: string | Date;
}) {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    email: row.email,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function requireContentAdmin(
  request: { member?: Member },
  reply: { code: (n: number) => { send: (o: object) => unknown } }
): boolean {
  const member = request.member;
  if (!member || !isContentAdmin(member)) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

type ArticleSnapshot = {
  id: number;
  title: string;
  slug: string;
  content_type: string | null;
  content: string;
  revision_note: string | null;
  is_small_edit: number;
  snippet: string | null;
  featured: number;
  published_at: string | Date | null;
};

function fuzzyScore(value: string, query: string): number {
  const haystack = value.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (!needle) return 0;
  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 750 - (haystack.length - needle.length);
  if (haystack.includes(needle)) return 500 - haystack.indexOf(needle);

  let score = 0;
  let qIndex = 0;
  let lastMatch = -2;
  for (let i = 0; i < haystack.length && qIndex < needle.length; i += 1) {
    if (haystack[i] !== needle[qIndex]) continue;
    score += lastMatch === i - 1 ? 12 : 6;
    lastMatch = i;
    qIndex += 1;
  }
  if (qIndex !== needle.length) return -1;
  return score;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- shared PG/SQLite article version helpers; drizzle insert row types differ by driver */
async function createArticleVersion(
  db: any,
  schema: { articleVersions: any },
  article: ArticleSnapshot,
  savedByMemberId: number | null,
  revisionNote?: string | null,
  isSmallEdit = false
): Promise<void> {
  const [maxRow] = await db
    .select({
      maxVersion: sql<number>`coalesce(max(${schema.articleVersions.version_number}), 0)`,
    })
    .from(schema.articleVersions)
    .where(eq(schema.articleVersions.article_id, article.id));
  const nextVersion = Number(maxRow?.maxVersion ?? 0) + 1;
  await db.insert(schema.articleVersions).values({
    article_id: article.id,
    version_number: nextVersion,
    title: article.title,
    slug: article.slug,
    content_type: article.content_type ?? 'markdown',
    content: article.content,
    revision_note: revisionNote?.trim() || article.revision_note || null,
    is_small_edit: isSmallEdit ? 1 : 0,
    snippet: article.snippet ?? null,
    featured: article.featured === 1 ? 1 : 0,
    published_at: article.published_at ?? null,
    saved_by_member_id: savedByMemberId,
  });
}

async function overwriteLatestArticleVersion(
  db: any,
  schema: { articleVersions: any },
  article: ArticleSnapshot,
  savedByMemberId: number | null
): Promise<void> {
  const [latest] = await db
    .select({
      id: schema.articleVersions.id,
      versionNumber: schema.articleVersions.version_number,
    })
    .from(schema.articleVersions)
    .where(eq(schema.articleVersions.article_id, article.id))
    .orderBy(desc(schema.articleVersions.version_number))
    .limit(1);

  if (!latest) {
    await createArticleVersion(db, schema, article, savedByMemberId, null, false);
    return;
  }

  await db
    .update(schema.articleVersions)
    .set({
      title: article.title,
      slug: article.slug,
      content_type: article.content_type ?? 'markdown',
      content: article.content,
      snippet: article.snippet ?? null,
      featured: article.featured === 1 ? 1 : 0,
      published_at: article.published_at ?? null,
    })
    .where(eq(schema.articleVersions.id, latest.id));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function contentRoutes(fastify: FastifyInstance) {
  // Articles
  fastify.get<{
    Querystring: {
      page?: string;
      pageSize?: string;
      search?: string;
      sort?: string;
      order?: string;
    };
  }>('/content/articles', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const { db, schema } = getDrizzleDb();
    const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1);
    const pageSizeRaw = Number.parseInt(request.query.pageSize ?? '25', 10) || 25;
    const pageSize = Math.max(1, Math.min(100, pageSizeRaw));
    const search = (request.query.search ?? '').trim().toLowerCase();
    const sort = request.query.sort ?? 'updatedAt';
    const order = request.query.order === 'asc' ? 'asc' : 'desc';

    const sortMap = {
      title: schema.articles.title,
      slug: schema.articles.slug,
      createdAt: schema.articles.created_at,
      publishedAt: schema.articles.published_at,
      updatedAt: schema.articles.updated_at,
    } as const;
    const sortColumn = sortMap[sort as keyof typeof sortMap] ?? sortMap.updatedAt;
    const notEventOwnedArticle = notExists(
      db
        .select({ one: sql`1` })
        .from(schema.events)
        .where(eq(schema.events.article_id, schema.articles.id)),
    );
    const searchClause = search
      ? sql`lower(${schema.articles.title}) like ${`%${search}%`}`
      : undefined;
    const listWhere = searchClause ? and(searchClause, notEventOwnedArticle) : notEventOwnedArticle;

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.articles)
      .where(listWhere);
    const total = Number(totalRow?.count ?? 0);

    const rows = await db
      .select({
        id: schema.articles.id,
        title: schema.articles.title,
        slug: schema.articles.slug,
        snippet: schema.articles.snippet,
        featured: schema.articles.featured,
        featuredSortOrder: schema.articles.featured_sort_order,
        publishedAt: schema.articles.published_at,
        createdAt: schema.articles.created_at,
        updatedAt: schema.articles.updated_at,
      })
      .from(schema.articles)
      .where(listWhere)
      .orderBy(order === 'asc' ? asc(sortColumn) : desc(sortColumn), desc(schema.articles.updated_at))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        snippet: r.snippet ?? null,
        featured: r.featured === 1,
        featuredSortOrder: r.featuredSortOrder ?? 0,
        publishedAt: r.publishedAt ?? null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      total,
      page,
      pageSize,
    };
  });

  fastify.get<{
    Querystring: {
      q?: string;
      limit?: string;
    };
  }>('/content/articles/lookup', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const { db, schema } = getDrizzleDb();
    const q = (request.query.q ?? '').trim();
    const limitRaw = Number.parseInt(request.query.limit ?? '10', 10) || 10;
    const limit = Math.max(1, Math.min(25, limitRaw));

    const notEventOwnedArticle = notExists(
      db
        .select({ one: sql`1` })
        .from(schema.events)
        .where(eq(schema.events.article_id, schema.articles.id)),
    );

    if (!q) {
      const rows = await db
        .select({
          id: schema.articles.id,
          title: schema.articles.title,
          slug: schema.articles.slug,
          updatedAt: schema.articles.updated_at,
        })
        .from(schema.articles)
        .where(notEventOwnedArticle)
        .orderBy(desc(schema.articles.updated_at), desc(schema.articles.id))
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        updatedAt: row.updatedAt,
      }));
    }

    const rows = await db
      .select({
        id: schema.articles.id,
        title: schema.articles.title,
        slug: schema.articles.slug,
        updatedAt: schema.articles.updated_at,
      })
      .from(schema.articles)
      .where(
        and(
          notEventOwnedArticle,
          sql`lower(${schema.articles.title}) like ${`%${q.toLowerCase()}%`} OR lower(${schema.articles.slug}) like ${`%${q.toLowerCase()}%`}`,
        ),
      )
      .limit(250);

    return rows
      .map((row) => {
        const score = Math.max(fuzzyScore(row.title, q), fuzzyScore(row.slug, q));
        return { ...row, score };
      })
      .filter((row) => row.score >= 0)
      .sort((a, b) => b.score - a.score || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        updatedAt: row.updatedAt,
      }));
  });

  fastify.get('/content/homepage/featured-articles', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select({
        id: schema.articles.id,
        title: schema.articles.title,
        slug: schema.articles.slug,
        snippet: schema.articles.snippet,
        featured: schema.articles.featured,
        featuredSortOrder: schema.articles.featured_sort_order,
        publishedAt: schema.articles.published_at,
        createdAt: schema.articles.created_at,
        updatedAt: schema.articles.updated_at,
      })
      .from(schema.articles)
      .where(eq(schema.articles.featured, 1))
      .orderBy(asc(schema.articles.featured_sort_order), asc(schema.articles.id));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      snippet: r.snippet ?? null,
      featured: r.featured === 1,
      featuredSortOrder: r.featuredSortOrder ?? 0,
      publishedAt: r.publishedAt ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  });

  const featuredArticleReorderSchema = z.object({
    ids: z.array(z.number().int().positive()),
  });

  fastify.patch('/content/homepage/featured-articles/reorder', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const parsed = featuredArticleReorderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { ids } = parsed.data;
    const { db, schema } = getDrizzleDb();
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length !== ids.length) {
      return reply.code(400).send({ error: 'Duplicate article ids in reorder list' });
    }
    if (uniqueIds.length === 0) return { success: true };

    const rows = await db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(and(eq(schema.articles.featured, 1), inArray(schema.articles.id, uniqueIds)));
    if (rows.length !== uniqueIds.length) {
      return reply.code(400).send({ error: 'Reorder list must contain only featured article ids' });
    }

    await db.transaction(async (tx) => {
      for (let index = 0; index < uniqueIds.length; index += 1) {
        await tx
          .update(schema.articles)
          .set({ featured_sort_order: index })
          .where(eq(schema.articles.id, uniqueIds[index]));
      }
    });

    return { success: true };
  });

  fastify.post('/content/articles', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const member = request.member!;
    const parsed = articleBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    if (!body.revisionNote?.trim()) {
      return reply.code(400).send({ error: 'Revision note is required' });
    }
    const contentType = body.contentType ?? 'markdown';
    const content = await ensureGeneratedCss(body.content, contentType);
    const { db, schema } = getDrizzleDb();
    let featuredSortOrder = body.featuredSortOrder ?? 0;
    if (body.featured && body.featuredSortOrder === undefined) {
      const [maxFeaturedRow] = await db
        .select({ maxSort: sql<number>`coalesce(max(${schema.articles.featured_sort_order}), 0)` })
        .from(schema.articles)
        .where(eq(schema.articles.featured, 1));
      featuredSortOrder = Number(maxFeaturedRow?.maxSort ?? 0) + 1;
    }
    let row: typeof schema.articles.$inferSelect | undefined;
    try {
      const inserted = await db
        .insert(schema.articles)
        .values({
          title: body.title,
          slug: body.slug,
          content_type: contentType,
          content,
          snippet: body.snippet ?? null,
          featured: body.featured ? 1 : 0,
          featured_sort_order: body.featured ? featuredSortOrder : 0,
          published_at: body.publishedAt ? new Date(body.publishedAt) : null,
          created_by_member_id: member.id,
        })
        .returning();
      row = inserted[0];
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        return reply.code(409).send({ error: 'An article with this slug already exists' });
      }
      throw err;
    }
    if (row) {
      await createArticleVersion(
        db,
        schema,
        {
          id: row.id,
          title: row.title,
          slug: row.slug,
          content_type: row.content_type ?? 'markdown',
          content: row.content,
          revision_note: null,
          is_small_edit: 0,
          snippet: row.snippet ?? null,
          featured: row.featured ?? 0,
          published_at: row.published_at ?? null,
        },
        member.id,
        body.revisionNote ?? null
      );
    }
    return {
      id: row!.id,
      title: row!.title,
      slug: row!.slug,
      contentType: row!.content_type ?? 'markdown',
      content: row!.content,
      snippet: row!.snippet ?? null,
      featured: row!.featured === 1,
      featuredSortOrder: row!.featured_sort_order ?? 0,
      publishedAt: row!.published_at ?? null,
    };
  });

  fastify.get<{ Params: { id: string } }>('/content/articles/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select({
        id: schema.articles.id,
        title: schema.articles.title,
        slug: schema.articles.slug,
        content_type: schema.articles.content_type,
        content: schema.articles.content,
        snippet: schema.articles.snippet,
        featured: schema.articles.featured,
        featured_sort_order: schema.articles.featured_sort_order,
        published_at: schema.articles.published_at,
        created_at: schema.articles.created_at,
        updated_at: schema.articles.updated_at,
      })
      .from(schema.articles)
      .where(eq(schema.articles.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return reply.code(404).send({ error: 'Article not found' });
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      contentType: row.content_type ?? 'markdown',
      content: row.content,
      snippet: row.snippet ?? null,
      featured: row.featured === 1,
      featuredSortOrder: row.featured_sort_order ?? 0,
      publishedAt: row.published_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  fastify.get<{ Params: { id: string } }>('/content/articles/:id/versions', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { db, schema } = getDrizzleDb();
    const [article] = await db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.id, id))
      .limit(1);
    if (!article) return reply.code(404).send({ error: 'Article not found' });

    const rows = await db
      .select({
        id: schema.articleVersions.id,
        versionNumber: schema.articleVersions.version_number,
        title: schema.articleVersions.title,
        slug: schema.articleVersions.slug,
        contentType: schema.articleVersions.content_type,
        revisionNote: schema.articleVersions.revision_note,
        isSmallEdit: schema.articleVersions.is_small_edit,
        snippet: schema.articleVersions.snippet,
        featured: schema.articleVersions.featured,
        publishedAt: schema.articleVersions.published_at,
        savedByMemberId: schema.articleVersions.saved_by_member_id,
        savedByName: schema.members.name,
        createdAt: schema.articleVersions.created_at,
      })
      .from(schema.articleVersions)
      .leftJoin(schema.members, eq(schema.articleVersions.saved_by_member_id, schema.members.id))
      .where(eq(schema.articleVersions.article_id, id))
      .orderBy(desc(schema.articleVersions.version_number));
    return rows.map((r) => ({
      id: r.id,
      versionNumber: r.versionNumber,
      title: r.title,
      slug: r.slug,
      contentType: (r.contentType ?? 'markdown') as 'markdown' | 'html',
      revisionNote: r.revisionNote ?? null,
      isSmallEdit: r.isSmallEdit === 1,
      snippet: r.snippet ?? null,
      featured: r.featured === 1,
      publishedAt: r.publishedAt ?? null,
      savedByMemberId: r.savedByMemberId ?? null,
      savedByName: r.savedByName ?? null,
      createdAt: r.createdAt,
    }));
  });

  fastify.get<{ Params: { id: string; versionId: string } }>(
    '/content/articles/:id/versions/:versionId',
    async (request, reply) => {
      if (!requireContentAdmin(request, reply)) return;
      const id = parseInt(request.params.id, 10);
      const versionId = parseInt(request.params.versionId, 10);
      if (isNaN(id) || isNaN(versionId)) return reply.code(400).send({ error: 'Invalid id' });
      const { db, schema } = getDrizzleDb();
      const [row] = await db
        .select({
          id: schema.articleVersions.id,
          articleId: schema.articleVersions.article_id,
          versionNumber: schema.articleVersions.version_number,
          title: schema.articleVersions.title,
          slug: schema.articleVersions.slug,
          contentType: schema.articleVersions.content_type,
          content: schema.articleVersions.content,
          revisionNote: schema.articleVersions.revision_note,
          isSmallEdit: schema.articleVersions.is_small_edit,
          snippet: schema.articleVersions.snippet,
          featured: schema.articleVersions.featured,
          publishedAt: schema.articleVersions.published_at,
          savedByMemberId: schema.articleVersions.saved_by_member_id,
          savedByName: schema.members.name,
          createdAt: schema.articleVersions.created_at,
        })
        .from(schema.articleVersions)
        .leftJoin(schema.members, eq(schema.articleVersions.saved_by_member_id, schema.members.id))
        .where(and(eq(schema.articleVersions.id, versionId), eq(schema.articleVersions.article_id, id)))
        .limit(1);
      if (!row) return reply.code(404).send({ error: 'Version not found' });
      return {
        id: row.id,
        articleId: row.articleId,
        versionNumber: row.versionNumber,
        title: row.title,
        slug: row.slug,
        contentType: (row.contentType ?? 'markdown') as 'markdown' | 'html',
        content: row.content,
        revisionNote: row.revisionNote ?? null,
        isSmallEdit: row.isSmallEdit === 1,
        snippet: row.snippet ?? null,
        featured: row.featured === 1,
        publishedAt: row.publishedAt ?? null,
        savedByMemberId: row.savedByMemberId ?? null,
        savedByName: row.savedByName ?? null,
        createdAt: row.createdAt,
      };
    }
  );

  fastify.post<{ Params: { id: string; versionId: string } }>(
    '/content/articles/:id/versions/:versionId/restore',
    async (request, reply) => {
      if (!requireContentAdmin(request, reply)) return;
      const id = parseInt(request.params.id, 10);
      const versionId = parseInt(request.params.versionId, 10);
      if (isNaN(id) || isNaN(versionId)) return reply.code(400).send({ error: 'Invalid id' });
      const { db, schema } = getDrizzleDb();

      const [article] = await db.select({ id: schema.articles.id }).from(schema.articles).where(eq(schema.articles.id, id)).limit(1);
      if (!article) return reply.code(404).send({ error: 'Article not found' });

      const [targetVersion] = await db
        .select()
        .from(schema.articleVersions)
        .where(and(eq(schema.articleVersions.id, versionId), eq(schema.articleVersions.article_id, id)))
        .limit(1);
      if (!targetVersion) return reply.code(404).send({ error: 'Version not found' });
      if ((targetVersion.is_small_edit ?? 0) === 1) {
        return reply.code(400).send({ error: 'Small edit revisions cannot be restored' });
      }

      await db.transaction(async (tx) => {
        const [maxVersionRow] = await tx
          .select({
            maxVersion: sql<number>`coalesce(max(${schema.articleVersions.version_number}), 0)`,
          })
          .from(schema.articleVersions)
          .where(eq(schema.articleVersions.article_id, id));
        const nextVersionNumber = Number(maxVersionRow?.maxVersion ?? 0) + 1;

        await tx
          .update(schema.articleVersions)
          .set({
            version_number: nextVersionNumber,
          })
          .where(eq(schema.articleVersions.id, targetVersion.id));

        await tx
          .update(schema.articles)
          .set({
            title: targetVersion.title,
            content_type: targetVersion.content_type ?? 'markdown',
            content: targetVersion.content,
            snippet: targetVersion.snippet ?? null,
            featured: targetVersion.featured ?? 0,
            updated_at: new Date(),
          })
          .where(eq(schema.articles.id, id));
      });

      const [row] = await db
        .select({
          id: schema.articles.id,
          title: schema.articles.title,
          slug: schema.articles.slug,
          content_type: schema.articles.content_type,
          content: schema.articles.content,
          snippet: schema.articles.snippet,
          featured: schema.articles.featured,
          published_at: schema.articles.published_at,
          created_at: schema.articles.created_at,
          updated_at: schema.articles.updated_at,
        })
        .from(schema.articles)
        .where(eq(schema.articles.id, id))
        .limit(1);

      if (!row) return reply.code(404).send({ error: 'Article not found' });
      return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        contentType: row.content_type ?? 'markdown',
        content: row.content,
        snippet: row.snippet ?? null,
        featured: row.featured === 1,
        publishedAt: row.published_at ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }
  );

  fastify.patch<{ Params: { id: string } }>('/content/articles/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const member = request.member!;
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const parsed = articleBodySchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { db, schema } = getDrizzleDb();
    const updates: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.slug !== undefined) updates.slug = parsed.data.slug;
    if (parsed.data.contentType !== undefined) updates.content_type = parsed.data.contentType;
    if (parsed.data.content !== undefined) {
      let contentType: 'markdown' | 'html' = parsed.data.contentType ?? 'markdown';
      if (parsed.data.contentType === undefined) {
        const [existing] = await db.select({ content_type: schema.articles.content_type }).from(schema.articles).where(eq(schema.articles.id, id)).limit(1);
        contentType = (existing?.content_type as 'markdown' | 'html') ?? 'markdown';
      }
      updates.content = await ensureGeneratedCss(parsed.data.content, contentType);
    }
    if (parsed.data.snippet !== undefined) updates.snippet = parsed.data.snippet;
    if (parsed.data.publishedAt !== undefined)
      updates.published_at = parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null;
    const [existing] = await db
      .select({
        id: schema.articles.id,
        title: schema.articles.title,
        slug: schema.articles.slug,
        content_type: schema.articles.content_type,
        content: schema.articles.content,
        revision_note: sql<string | null>`NULL`,
        is_small_edit: sql<number>`0`,
        snippet: schema.articles.snippet,
        featured: schema.articles.featured,
        featured_sort_order: schema.articles.featured_sort_order,
        published_at: schema.articles.published_at,
      })
      .from(schema.articles)
      .where(eq(schema.articles.id, id))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: 'Article not found' });

    if (parsed.data.featured !== undefined) {
      updates.featured = parsed.data.featured ? 1 : 0;
      if (!parsed.data.featured) {
        updates.featured_sort_order = 0;
      } else if (parsed.data.featuredSortOrder !== undefined) {
        updates.featured_sort_order = parsed.data.featuredSortOrder;
      } else if ((existing.featured ?? 0) !== 1) {
        const [maxFeaturedRow] = await db
          .select({ maxSort: sql<number>`coalesce(max(${schema.articles.featured_sort_order}), 0)` })
          .from(schema.articles)
          .where(eq(schema.articles.featured, 1));
        updates.featured_sort_order = Number(maxFeaturedRow?.maxSort ?? 0) + 1;
      }
    } else if (parsed.data.featuredSortOrder !== undefined) {
      updates.featured_sort_order = parsed.data.featuredSortOrder;
    }

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    const nextTitle = (updates.title as string | undefined) ?? existing.title;
    const nextContentType = (updates.content_type as string | undefined) ?? (existing.content_type ?? 'markdown');
    const nextContent = (updates.content as string | undefined) ?? existing.content;
    const versionContentWillChange =
      (existing.title ?? '') !== (nextTitle ?? '') ||
      (existing.content_type ?? 'markdown') !== (nextContentType ?? 'markdown') ||
      (existing.content ?? '') !== (nextContent ?? '');
    if (versionContentWillChange && !parsed.data.smallEdit && !parsed.data.revisionNote?.trim()) {
      return reply.code(400).send({ error: 'Revision note is required unless this is a small edit' });
    }

    updates.updated_at = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(schema.articles)
        .set(updates as Record<string, unknown>)
        .where(eq(schema.articles.id, id));

      const [updatedSnapshot] = await tx
        .select({
          id: schema.articles.id,
          title: schema.articles.title,
          slug: schema.articles.slug,
          content_type: schema.articles.content_type,
          content: schema.articles.content,
          revision_note: sql<string | null>`NULL`,
          is_small_edit: sql<number>`0`,
          snippet: schema.articles.snippet,
          featured: schema.articles.featured,
          featured_sort_order: schema.articles.featured_sort_order,
          published_at: schema.articles.published_at,
        })
        .from(schema.articles)
        .where(eq(schema.articles.id, id))
        .limit(1);
      if (!updatedSnapshot) {
        throw new Error('Article not found after update');
      }

      const versionContentChanged =
        (existing.title ?? '') !== (updatedSnapshot.title ?? '') ||
        (existing.content_type ?? 'markdown') !== (updatedSnapshot.content_type ?? 'markdown') ||
        (existing.content ?? '') !== (updatedSnapshot.content ?? '');

      if (!versionContentChanged) {
        // Settings-only edits (slug/snippet/published/featured) should not create new revisions.
        await overwriteLatestArticleVersion(tx, schema, updatedSnapshot, member.id);
      } else if (parsed.data.smallEdit) {
        await overwriteLatestArticleVersion(tx, schema, updatedSnapshot, member.id);
        await createArticleVersion(tx, schema, updatedSnapshot, member.id, null, true);
      } else {
        await createArticleVersion(tx, schema, updatedSnapshot, member.id, parsed.data.revisionNote ?? null);
      }
    });
    const [row] = await db
      .select({
        id: schema.articles.id,
        title: schema.articles.title,
        slug: schema.articles.slug,
        content_type: schema.articles.content_type,
        content: schema.articles.content,
        snippet: schema.articles.snippet,
        featured: schema.articles.featured,
        featured_sort_order: schema.articles.featured_sort_order,
        published_at: schema.articles.published_at,
      })
      .from(schema.articles)
      .where(eq(schema.articles.id, id))
      .limit(1);
    if (!row) return reply.code(404).send({ error: 'Article not found' });
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      contentType: row.content_type ?? 'markdown',
      content: row.content,
      snippet: row.snippet ?? null,
      featured: row.featured === 1,
      featuredSortOrder: row.featured_sort_order ?? 0,
      publishedAt: row.published_at ?? null,
    };
  });

  fastify.delete<{ Params: { id: string } }>('/content/articles/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { db, schema } = getDrizzleDb();
    const deleted = await db
      .delete(schema.articles)
      .where(eq(schema.articles.id, id))
      .returning({ id: schema.articles.id });
    if (deleted.length === 0) return reply.code(404).send({ error: 'Article not found' });
    return { success: true };
  });

  // Site config
  fastify.get('/content/site-config', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select()
      .from(schema.siteConfig)
      .where(eq(schema.siteConfig.id, 1))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return {
        clubName: null,
        logoUrl: null,
        contactEmail: null,
        contactPhone: null,
        physicalAddressLine1: null,
        physicalAddressLine2: null,
        mailingAddressLine1: null,
        mailingAddressLine2: null,
        footerMarkdown: null,
        heroBadge: null,
        heroTitle: null,
        heroSubtitle: null,
        announcementMarkdown: null,
        announcementExpiresAt: null,
      };
    }
    return {
      clubName: row.club_name ?? null,
      logoUrl: row.logo_url ?? null,
      contactEmail: row.contact_email ?? null,
      contactPhone: row.contact_phone ?? null,
      physicalAddressLine1: row.physical_address_line1 ?? null,
      physicalAddressLine2: row.physical_address_line2 ?? null,
      mailingAddressLine1: row.mailing_address_line1 ?? null,
      mailingAddressLine2: row.mailing_address_line2 ?? null,
      footerMarkdown: row.footer_markdown ?? null,
      heroBadge: row.hero_badge ?? null,
      heroTitle: row.hero_title ?? null,
      heroSubtitle: row.hero_subtitle ?? null,
      announcementMarkdown: row.announcement_markdown ?? null,
      announcementExpiresAt: siteConfigTimestampToIso(row.announcement_expires_at),
    };
  });

  fastify.patch('/content/site-config', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const parsed = siteConfigBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { db, schema } = getDrizzleDb();
    const updates: Record<string, unknown> = {};
    if (parsed.data.clubName !== undefined) updates.club_name = parsed.data.clubName;
    if (parsed.data.logoUrl !== undefined) updates.logo_url = parsed.data.logoUrl;
    if (parsed.data.contactEmail !== undefined) updates.contact_email = parsed.data.contactEmail;
    if (parsed.data.contactPhone !== undefined) updates.contact_phone = parsed.data.contactPhone;
    if (parsed.data.physicalAddressLine1 !== undefined) updates.physical_address_line1 = parsed.data.physicalAddressLine1;
    if (parsed.data.physicalAddressLine2 !== undefined) updates.physical_address_line2 = parsed.data.physicalAddressLine2;
    if (parsed.data.mailingAddressLine1 !== undefined) updates.mailing_address_line1 = parsed.data.mailingAddressLine1;
    if (parsed.data.mailingAddressLine2 !== undefined) updates.mailing_address_line2 = parsed.data.mailingAddressLine2;
    if (parsed.data.footerMarkdown !== undefined) updates.footer_markdown = parsed.data.footerMarkdown;
    if (parsed.data.heroBadge !== undefined) updates.hero_badge = parsed.data.heroBadge;
    if (parsed.data.heroTitle !== undefined) updates.hero_title = parsed.data.heroTitle;
    if (parsed.data.heroSubtitle !== undefined) updates.hero_subtitle = parsed.data.heroSubtitle;
    if (parsed.data.announcementMarkdown !== undefined) updates.announcement_markdown = parsed.data.announcementMarkdown;
    if (parsed.data.announcementExpiresAt !== undefined) {
      // Same convention as the dashboard alert expiry: store a Date (pg timestamp / sqlite text).
      updates.announcement_expires_at = parsed.data.announcementExpiresAt
        ? new Date(parsed.data.announcementExpiresAt)
        : null;
    }
    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }
    await db
      .update(schema.siteConfig)
      .set(updates as Record<string, unknown>)
      .where(eq(schema.siteConfig.id, 1));
    const [row] = await db
      .select()
      .from(schema.siteConfig)
      .where(eq(schema.siteConfig.id, 1))
      .limit(1);
    const r = row ?? {};
    return {
      clubName: r.club_name ?? null,
      logoUrl: r.logo_url ?? null,
      contactEmail: r.contact_email ?? null,
      contactPhone: r.contact_phone ?? null,
      physicalAddressLine1: r.physical_address_line1 ?? null,
      physicalAddressLine2: r.physical_address_line2 ?? null,
      mailingAddressLine1: r.mailing_address_line1 ?? null,
      mailingAddressLine2: r.mailing_address_line2 ?? null,
      footerMarkdown: r.footer_markdown ?? null,
      heroBadge: r.hero_badge ?? null,
      heroTitle: r.hero_title ?? null,
      heroSubtitle: r.hero_subtitle ?? null,
      announcementMarkdown: r.announcement_markdown ?? null,
      announcementExpiresAt: siteConfigTimestampToIso(r.announcement_expires_at),
    };
  });

  // Showcase images
  fastify.get('/content/showcase-images', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select()
      .from(schema.showcaseImages)
      .orderBy(asc(schema.showcaseImages.sort_order), asc(schema.showcaseImages.id));
    return rows.map((img) => ({
      id: img.id,
      url: img.url,
      caption: img.caption ?? null,
      sortOrder: img.sort_order,
    }));
  });

  fastify.post('/content/showcase-images', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const parsed = showcaseImageBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const { db, schema } = getDrizzleDb();
    const [row] = await db
      .insert(schema.showcaseImages)
      .values({
        url: body.url,
        caption: body.caption ?? null,
        sort_order: body.sortOrder ?? 0,
      })
      .returning();
    return { id: row!.id, url: row!.url, caption: row!.caption ?? null, sortOrder: row!.sort_order };
  });

  fastify.patch<{ Params: { id: string } }>('/content/showcase-images/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const parsed = showcaseImageBodySchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { db, schema } = getDrizzleDb();
    const updates: Record<string, unknown> = {};
    if (parsed.data.url !== undefined) updates.url = parsed.data.url;
    if (parsed.data.caption !== undefined) updates.caption = parsed.data.caption;
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder;
    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }
    const [row] = await db
      .update(schema.showcaseImages)
      .set(updates as Record<string, unknown>)
      .where(eq(schema.showcaseImages.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Image not found' });
    return { id: row.id, url: row.url, caption: row.caption ?? null, sortOrder: row.sort_order };
  });

  fastify.delete<{ Params: { id: string } }>('/content/showcase-images/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { db, schema } = getDrizzleDb();
    const deleted = await db
      .delete(schema.showcaseImages)
      .where(eq(schema.showcaseImages.id, id))
      .returning({ id: schema.showcaseImages.id });
    if (deleted.length === 0) return reply.code(404).send({ error: 'Image not found' });
    return { success: true };
  });

  // Menu items
  fastify.get<{ Querystring: { menuType?: string } }>('/content/menu-items', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const menuType = request.query.menuType ?? 'navbar';
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select()
      .from(schema.menuItems)
      .where(eq(schema.menuItems.menu_type, menuType))
      .orderBy(asc(schema.menuItems.sort_order), asc(schema.menuItems.id));
    return rows.map((r) => ({
      id: r.id,
      menuType: r.menu_type,
      parentId: r.parent_id ?? null,
      label: r.label,
      sortOrder: r.sort_order,
      linkType: r.link_type ?? null,
      url: r.url ?? null,
      openInNewTab: r.open_in_new_tab === 1,
      articleId: r.article_id ?? null,
      useArticleTitleForLabel: r.use_article_title_for_label === 1,
    }));
  });

  fastify.post('/content/menu-items', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const parsed = menuItemBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    if (body.linkType && !body.url?.trim()) {
      return reply.code(400).send({ error: 'URL is required when link type is set' });
    }
    const { db, schema } = getDrizzleDb();
    const [row] = await db
      .insert(schema.menuItems)
      .values({
        menu_type: body.menuType,
        parent_id: body.parentId ?? null,
        label: body.label,
        sort_order: body.sortOrder ?? 0,
        link_type: body.linkType ?? null,
        url: body.url?.trim() || null,
        open_in_new_tab: body.openInNewTab ? 1 : 0,
        article_id: body.articleId ?? null,
        use_article_title_for_label: body.useArticleTitleForLabel ? 1 : 0,
      })
      .returning();
    return {
      id: row!.id,
      menuType: row!.menu_type,
      parentId: row!.parent_id ?? null,
      label: row!.label,
      sortOrder: row!.sort_order,
      linkType: row!.link_type ?? null,
      url: row!.url ?? null,
      openInNewTab: row!.open_in_new_tab === 1,
      articleId: row!.article_id ?? null,
      useArticleTitleForLabel: row!.use_article_title_for_label === 1,
    };
  });

  const menuItemsReorderSchema = z.object({
    updates: z.array(z.object({ id: z.number(), sortOrder: z.number() })).min(1),
  });

  fastify.patch('/content/menu-items/reorder', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const parsed = menuItemsReorderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { db, schema } = getDrizzleDb();
    await db.transaction(async (tx) => {
      for (const { id, sortOrder } of parsed.data.updates) {
        await tx
          .update(schema.menuItems)
          .set({ sort_order: sortOrder })
          .where(eq(schema.menuItems.id, id));
      }
    });
    return { success: true };
  });

  fastify.patch<{ Params: { id: string } }>('/content/menu-items/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const parsed = menuItemBodySchema.partial().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    if (body.linkType && body.url !== undefined && !body.url?.trim()) {
      return reply.code(400).send({ error: 'URL is required when link type is set' });
    }
    const { db, schema } = getDrizzleDb();
    const updates: Record<string, unknown> = {};
    if (body.menuType !== undefined) updates.menu_type = body.menuType;
    if (body.parentId !== undefined) updates.parent_id = body.parentId;
    if (body.label !== undefined) updates.label = body.label;
    if (body.sortOrder !== undefined) updates.sort_order = body.sortOrder;
    if (body.linkType !== undefined) updates.link_type = body.linkType;
    if (body.url !== undefined) updates.url = body.url?.trim() || null;
    if (body.openInNewTab !== undefined) updates.open_in_new_tab = body.openInNewTab ? 1 : 0;
    if (body.articleId !== undefined) updates.article_id = body.articleId;
    if (body.useArticleTitleForLabel !== undefined)
      updates.use_article_title_for_label = body.useArticleTitleForLabel ? 1 : 0;
    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }
    const [row] = await db
      .update(schema.menuItems)
      .set(updates as Record<string, unknown>)
      .where(eq(schema.menuItems.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Menu item not found' });
    return {
      id: row.id,
      menuType: row.menu_type,
      parentId: row.parent_id ?? null,
      label: row.label,
      sortOrder: row.sort_order,
      linkType: row.link_type ?? null,
      url: row.url ?? null,
      openInNewTab: row.open_in_new_tab === 1,
      articleId: row.article_id ?? null,
      useArticleTitleForLabel: row.use_article_title_for_label === 1,
    };
  });

  fastify.delete<{ Params: { id: string } }>('/content/menu-items/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { db, schema } = getDrizzleDb();
    const deleted = await db
      .delete(schema.menuItems)
      .where(eq(schema.menuItems.id, id))
      .returning({ id: schema.menuItems.id });
    if (deleted.length === 0) return reply.code(404).send({ error: 'Menu item not found' });
    return { success: true };
  });

  // Public contact recipients (contact page + article link targets)
  fastify.get('/content/contact-recipients', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select()
      .from(schema.publicContactRecipients)
      .orderBy(asc(schema.publicContactRecipients.sort_order), asc(schema.publicContactRecipients.id));
    return rows.map(mapContactRecipientRow);
  });

  fastify.post('/content/contact-recipients', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const parsed = contactRecipientCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const { db, schema } = getDrizzleDb();
    try {
      const [row] = await db
        .insert(schema.publicContactRecipients)
        .values({
          slug: body.slug,
          label: body.label,
          email: body.email,
          sort_order: body.sortOrder ?? 0,
          is_active: body.isActive === false ? 0 : 1,
        })
        .returning();
      return mapContactRecipientRow(row!);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return reply.code(409).send({ error: 'A contact with this slug already exists' });
      }
      throw error;
    }
  });

  fastify.patch('/content/contact-recipients/reorder', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const parsed = contactRecipientsReorderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { db, schema } = getDrizzleDb();
    await db.transaction(async (tx) => {
      for (const { id, sortOrder } of parsed.data.updates) {
        await tx
          .update(schema.publicContactRecipients)
          .set({ sort_order: sortOrder, updated_at: new Date() })
          .where(eq(schema.publicContactRecipients.id, id));
      }
    });
    return { success: true };
  });

  fastify.patch<{ Params: { id: string } }>('/content/contact-recipients/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const parsed = contactRecipientUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const { db, schema } = getDrizzleDb();
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (body.label !== undefined) updates.label = body.label;
    if (body.email !== undefined) updates.email = body.email;
    if (body.sortOrder !== undefined) updates.sort_order = body.sortOrder;
    if (body.isActive !== undefined) updates.is_active = body.isActive ? 1 : 0;
    if (Object.keys(updates).length === 1) {
      return reply.code(400).send({ error: 'No fields to update' });
    }
    const [row] = await db
      .update(schema.publicContactRecipients)
      .set(updates as Record<string, unknown>)
      .where(eq(schema.publicContactRecipients.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Contact not found' });
    return mapContactRecipientRow(row);
  });

  fastify.delete<{ Params: { id: string } }>('/content/contact-recipients/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { db, schema } = getDrizzleDb();
    const deleted = await db
      .delete(schema.publicContactRecipients)
      .where(eq(schema.publicContactRecipients.id, id))
      .returning({ id: schema.publicContactRecipients.id });
    if (deleted.length === 0) return reply.code(404).send({ error: 'Contact not found' });
    return { success: true };
  });
}
