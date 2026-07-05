import { and, asc, desc, eq, inArray, isNotNull, notExists, sql } from 'drizzle-orm';
import { articleToSearchableText } from '../content/articleContentSearch.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { notArchivedCondition } from '../utils/softDelete.js';
import { buildStaticPageDocuments } from './staticPages.js';
import type { SearchDocument, SearchFingerprint } from './types.js';

export const SEARCH_INDEX_VERSION = 1;

function normalizeTimestamp(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return Number.isNaN(new Date(parsed).getTime()) ? null : parsed;
}

function parseTimestampMs(value: string | Date | null | undefined): number {
  if (value == null) return 0;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildPreviewSnippet(plainText: string, customSnippet: string | null | undefined): string {
  const trimmedCustom = customSnippet?.trim();
  if (trimmedCustom) return trimmedCustom;
  const normalized = plainText.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 200) return normalized;
  return `${normalized.slice(0, 197).trimEnd()}…`;
}

function formatTimespanText(startDt: string, endDt: string): string {
  return `${startDt} ${endDt}`;
}

async function loadPublishedArticleDocuments(): Promise<SearchDocument[]> {
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
      contentType: schema.articles.content_type,
      content: schema.articles.content,
      snippet: schema.articles.snippet,
      publishedAt: schema.articles.published_at,
      updatedAt: schema.articles.updated_at,
    })
    .from(schema.articles)
    .where(
      and(
        isNotNull(schema.articles.published_at),
        sql`${schema.articles.published_at} <= ${now}`,
        notOwnedByEvent,
      ),
    )
    .orderBy(desc(schema.articles.published_at), desc(schema.articles.id));

  return rows.map((row) => {
    const contentType = (row.contentType ?? 'markdown') as 'markdown' | 'html';
    const plainText = articleToSearchableText(row.content ?? '', contentType);
    const snippet = buildPreviewSnippet(plainText, row.snippet);
    const recencyMs = Math.max(
      parseTimestampMs(row.publishedAt),
      parseTimestampMs(row.updatedAt),
    );

    return {
      id: `article:${row.id}`,
      type: 'article',
      title: row.title,
      url: `/articles/${row.slug}`,
      content: plainText,
      keywords: '',
      snippet,
      plainText,
      recencyMs,
    };
  });
}

async function loadPublishedEventDocuments(): Promise<SearchDocument[]> {
  const { db, schema } = getDrizzleDb();

  const eventRows = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      slug: schema.events.slug,
      calendarTypeId: schema.events.calendar_type_id,
      updatedAt: schema.events.updated_at,
      articleContent: schema.articles.content,
      articleContentType: schema.articles.content_type,
      articleSnippet: schema.articles.snippet,
    })
    .from(schema.events)
    .leftJoin(schema.articles, eq(schema.events.article_id, schema.articles.id))
    .where(
      and(
        eq(schema.events.published, 1),
        eq(schema.events.visibility, 'public'),
        notArchivedCondition(schema.events.archived_at),
      ),
    )
    .orderBy(desc(schema.events.updated_at), desc(schema.events.id));

  if (eventRows.length === 0) {
    return [];
  }

  const eventIds = eventRows.map((row) => row.id);
  const timespanRows = await db
    .select({
      eventId: schema.eventTimespans.event_id,
      startDt: schema.eventTimespans.start_dt,
      endDt: schema.eventTimespans.end_dt,
    })
    .from(schema.eventTimespans)
    .where(inArray(schema.eventTimespans.event_id, eventIds))
    .orderBy(asc(schema.eventTimespans.sort_order), asc(schema.eventTimespans.start_dt));

  const timespansByEvent = new Map<number, string[]>();
  for (const row of timespanRows) {
    const list = timespansByEvent.get(row.eventId) ?? [];
    list.push(formatTimespanText(row.startDt, row.endDt));
    timespansByEvent.set(row.eventId, list);
  }

  return eventRows.map((row) => {
    const contentType = (row.articleContentType ?? 'markdown') as 'markdown' | 'html';
    const articlePlainText =
      row.articleContent != null
        ? articleToSearchableText(row.articleContent, contentType)
        : '';
    const scheduleText = (timespansByEvent.get(row.id) ?? []).join(' ');
    const calendarType = row.calendarTypeId?.trim() ?? '';
    const plainText = [articlePlainText, scheduleText, calendarType].filter(Boolean).join(' ').trim();
    const snippet = buildPreviewSnippet(plainText, row.articleSnippet);
    const recencyMs = Math.max(
      parseTimestampMs(row.updatedAt),
      ...((timespansByEvent.get(row.id) ?? []).map((span) => parseTimestampMs(span.split(' ')[0]))),
    );

    return {
      id: `event:${row.id}`,
      type: 'event',
      title: row.title,
      url: `/events/${row.slug}`,
      content: plainText,
      keywords: calendarType,
      snippet,
      plainText,
      recencyMs,
    };
  });
}

export async function buildAllSearchDocuments(): Promise<SearchDocument[]> {
  const [articles, events, pages] = await Promise.all([
    loadPublishedArticleDocuments(),
    loadPublishedEventDocuments(),
    Promise.resolve(buildStaticPageDocuments()),
  ]);
  return [...articles, ...events, ...pages];
}

export async function computeSearchFingerprint(): Promise<SearchFingerprint> {
  const { db, schema } = getDrizzleDb();
  const now = new Date().toISOString();
  const notOwnedByEvent = notExists(
    db
      .select({ one: sql`1` })
      .from(schema.events)
      .where(eq(schema.events.article_id, schema.articles.id)),
  );

  const [articleStats] = await db
    .select({
      count: sql<number>`count(*)`,
      maxUpdatedAt: sql<string | null>`max(${schema.articles.updated_at})`,
    })
    .from(schema.articles)
    .where(
      and(
        isNotNull(schema.articles.published_at),
        sql`${schema.articles.published_at} <= ${now}`,
        notOwnedByEvent,
      ),
    );

  const [eventStats] = await db
    .select({
      count: sql<number>`count(*)`,
      maxUpdatedAt: sql<string | null>`max(${schema.events.updated_at})`,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.published, 1),
        eq(schema.events.visibility, 'public'),
        notArchivedCondition(schema.events.archived_at),
      ),
    );

  return {
    version: SEARCH_INDEX_VERSION,
    articleCount: Number(articleStats?.count ?? 0),
    eventCount: Number(eventStats?.count ?? 0),
    pageCount: buildStaticPageDocuments().length,
    maxArticleUpdatedAt: normalizeTimestamp(articleStats?.maxUpdatedAt ?? null),
    maxEventUpdatedAt: normalizeTimestamp(eventStats?.maxUpdatedAt ?? null),
  };
}

export function fingerprintsMatch(a: SearchFingerprint, b: SearchFingerprint): boolean {
  return (
    a.version === b.version &&
    a.articleCount === b.articleCount &&
    a.eventCount === b.eventCount &&
    a.pageCount === b.pageCount &&
    a.maxArticleUpdatedAt === b.maxArticleUpdatedAt &&
    a.maxEventUpdatedAt === b.maxEventUpdatedAt
  );
}
