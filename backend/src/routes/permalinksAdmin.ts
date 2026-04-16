import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isUniqueConstraintViolation } from '../api/errors.js';
import { isContentAdmin } from '../utils/auth.js';
import type { Member } from '../types.js';

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

const slugSchema = z.string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and hyphens only');

function isAllowedDestination(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (t.startsWith('/')) return true;
  try {
    const u = new URL(t);
    const bad = ['javascript:', 'data:', 'vbscript:'].includes(u.protocol.toLowerCase());
    return !bad;
  } catch {
    return false;
  }
}

const suggestLabelBodySchema = z.object({
  url: z.string().min(1).max(8000),
});

const FETCH_TITLE_MAX_BYTES = 384_000;
const FETCH_TITLE_TIMEOUT_MS = 12_000;

function resolvePermalinkPreviewUrl(raw: string): URL | null {
  const t = raw.trim();
  if (!t || !isAllowedDestination(t)) return null;
  if (t.startsWith('/')) {
    try {
      const base = `${config.frontendUrl.replace(/\/+$/, '')}/`;
      return new URL(t, base);
    } catch {
      return null;
    }
  }
  try {
    const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return null;
    return u;
  } catch {
    return null;
  }
}

function decodeBasicHtmlEntities(s: string): string {
  let out = s.replace(/&nbsp;/gi, ' ');
  out = out.replace(/&#x([0-9a-f]+);/gi, (full, h) => {
    const n = Number.parseInt(h, 16);
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : full;
  });
  out = out.replace(/&#(\d+);/g, (full, d) => {
    const n = Number.parseInt(d, 10);
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : full;
  });
  return out
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractDocumentTitle(html: string): string | null {
  const headSlice = html.slice(0, Math.min(html.length, FETCH_TITLE_MAX_BYTES));
  const og =
    headSlice.match(/<meta\s+[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i) ||
    headSlice.match(/<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:title["'][^>]*>/i);
  if (og?.[1]) {
    const t = decodeBasicHtmlEntities(og[1]).replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  const tm = headSlice.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (tm?.[1]) {
    const inner = tm[1].replace(/<[^>]+>/g, ' ');
    const t = decodeBasicHtmlEntities(inner).replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  return null;
}

const createBodySchema = z.object({
  slug: slugSchema,
  destinationUrl: z.string().min(1).max(8000),
  label: z.string().max(500).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  destinationMayChange: z.boolean().optional(),
});

const patchBodySchema = z.object({
  slug: slugSchema.optional(),
  destinationUrl: z.string().min(1).max(8000).optional(),
  label: z.string().max(500).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  destinationMayChange: z.boolean().optional(),
});

function legacyClickBaseline(row: { legacy_click_count?: number | null }): number {
  return Math.max(0, Math.floor(Number(row.legacy_click_count ?? 0)));
}

function mergeImportedHitTotals(
  row: { legacy_click_count?: number | null },
  measured: { totalHits: number; uniqueVisitors: number; authenticatedHits: number }
): { totalHits: number; uniqueVisitors: number; authenticatedHits: number } {
  const b = legacyClickBaseline(row);
  return {
    totalHits: measured.totalHits + b,
    uniqueVisitors: measured.uniqueVisitors + b,
    authenticatedHits: measured.authenticatedHits,
  };
}

function mapPermalinkRow(row: {
  id: number;
  slug: string;
  label: string | null;
  notes: string | null;
  destination_url: string;
  destination_may_change: number;
  legacy_click_count?: number | null;
  created_at: string | Date;
  updated_at: string | Date;
}) {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    notes: row.notes,
    destinationUrl: row.destination_url,
    destinationMayChange: row.destination_may_change === 1,
    legacyClickCount: legacyClickBaseline(row),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function permalinkAdminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/content/permalinks', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select()
      .from(schema.permalinks)
      .orderBy(desc(schema.permalinks.created_at), desc(schema.permalinks.id));
    if (rows.length === 0) {
      return [];
    }
    const ids = rows.map((r) => r.id);
    const statRows = await db
      .select({
        permalinkId: schema.permalinkHits.permalink_id,
        totalHits: sql<number>`cast(count(*) as integer)`,
        uniqueVisitors: sql<number>`cast(count(distinct ${schema.permalinkHits.visitor_id}) as integer)`,
        authenticatedHits: sql<number>`cast(coalesce(sum(case when ${schema.permalinkHits.member_id} is not null then 1 else 0 end), 0) as integer)`,
      })
      .from(schema.permalinkHits)
      .where(inArray(schema.permalinkHits.permalink_id, ids))
      .groupBy(schema.permalinkHits.permalink_id);

    const statsById = new Map(
      statRows.map((s) => [
        s.permalinkId,
        {
          totalHits: Number(s.totalHits ?? 0),
          uniqueVisitors: Number(s.uniqueVisitors ?? 0),
          authenticatedHits: Number(s.authenticatedHits ?? 0),
        },
      ])
    );

    return rows.map((row) => {
      const s = statsById.get(row.id) ?? { totalHits: 0, uniqueVisitors: 0, authenticatedHits: 0 };
      return {
        ...mapPermalinkRow(row),
        ...mergeImportedHitTotals(row, s),
      };
    });
  });

  fastify.post<{ Body: unknown }>('/content/permalinks/suggest-label', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const parsed = suggestLabelBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const target = resolvePermalinkPreviewUrl(parsed.data.url);
    if (!target) {
      return reply.code(400).send({ error: 'Invalid URL' });
    }
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), FETCH_TITLE_TIMEOUT_MS);
    try {
      const res = await fetch(target.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'TriangleCurlingPermalinkBot/1.0',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        },
      });
      if (!res.ok) {
        return { title: null as string | null };
      }
      const buf = await res.arrayBuffer();
      const slice = buf.byteLength > FETCH_TITLE_MAX_BYTES ? buf.slice(0, FETCH_TITLE_MAX_BYTES) : buf;
      const html = new TextDecoder('utf-8', { fatal: false }).decode(slice);
      let title = extractDocumentTitle(html);
      if (title && title.length > 500) title = title.slice(0, 500);
      return { title: title ?? null };
    } catch {
      return { title: null as string | null };
    } finally {
      clearTimeout(to);
    }
  });

  fastify.post<{ Body: unknown }>('/content/permalinks', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const dest = body.destinationUrl.trim();
    if (!isAllowedDestination(dest)) {
      return reply.code(400).send({
        error: 'Invalid destination URL',
        details: { formErrors: [], fieldErrors: { destinationUrl: ['Enter a valid URL or a path starting with /'] } },
      });
    }
    const slug = body.slug.trim().toLowerCase();
    const { db, schema } = getDrizzleDb();
    const [slugTaken] = await db
      .select({ id: schema.permalinks.id })
      .from(schema.permalinks)
      .where(eq(schema.permalinks.slug, slug))
      .limit(1);
    if (slugTaken) {
      return reply.code(409).send({ error: 'A permalink with this slug already exists' });
    }
    const mayChange = body.destinationMayChange ? 1 : 0;
    try {
      const [row] = await db
        .insert(schema.permalinks)
        .values({
          slug,
          label: body.label?.trim() || null,
          notes: body.notes?.trim() || null,
          destination_url: dest,
          destination_may_change: mayChange,
        })
        .returning();
      if (!row) return reply.code(500).send({ error: 'Failed to create permalink' });
      return {
        ...mapPermalinkRow(row),
        ...mergeImportedHitTotals(row, { totalHits: 0, uniqueVisitors: 0, authenticatedHits: 0 }),
      };
    } catch (e: unknown) {
      if (isUniqueConstraintViolation(e)) {
        return reply.code(409).send({ error: 'A permalink with this slug already exists' });
      }
      throw e;
    }
  });

  fastify.patch<{ Params: { id: string }; Body: unknown }>('/content/permalinks/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const parsed = patchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const body = parsed.data;
    if (Object.keys(body).length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }
    if (body.destinationUrl !== undefined) {
      const dest = body.destinationUrl.trim();
      if (!isAllowedDestination(dest)) {
        return reply.code(400).send({
          error: 'Invalid destination URL',
          details: { formErrors: [], fieldErrors: { destinationUrl: ['Enter a valid URL or a path starting with /'] } },
        });
      }
    }

    const { db, schema } = getDrizzleDb();

    if (body.slug !== undefined) {
      const slug = body.slug.trim().toLowerCase();
      const [conflict] = await db
        .select({ id: schema.permalinks.id })
        .from(schema.permalinks)
        .where(and(eq(schema.permalinks.slug, slug), ne(schema.permalinks.id, id)))
        .limit(1);
      if (conflict) {
        return reply.code(409).send({ error: 'A permalink with this slug already exists' });
      }
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.slug !== undefined) updates.slug = body.slug.trim().toLowerCase();
    if (body.destinationUrl !== undefined) updates.destination_url = body.destinationUrl.trim();
    if (body.label !== undefined) updates.label = body.label?.trim() || null;
    if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
    if (body.destinationMayChange !== undefined) updates.destination_may_change = body.destinationMayChange ? 1 : 0;

    try {
      const [row] = await db
        .update(schema.permalinks)
        .set(updates as Record<string, unknown>)
        .where(eq(schema.permalinks.id, id))
        .returning();
      if (!row) return reply.code(404).send({ error: 'Permalink not found' });

      const [stats] = await db
        .select({
          totalHits: sql<number>`cast(count(*) as integer)`,
          uniqueVisitors: sql<number>`cast(count(distinct ${schema.permalinkHits.visitor_id}) as integer)`,
          authenticatedHits: sql<number>`cast(coalesce(sum(case when ${schema.permalinkHits.member_id} is not null then 1 else 0 end), 0) as integer)`,
        })
        .from(schema.permalinkHits)
        .where(eq(schema.permalinkHits.permalink_id, id));

      return {
        ...mapPermalinkRow(row),
        ...mergeImportedHitTotals(row, {
          totalHits: Number(stats?.totalHits ?? 0),
          uniqueVisitors: Number(stats?.uniqueVisitors ?? 0),
          authenticatedHits: Number(stats?.authenticatedHits ?? 0),
        }),
      };
    } catch (e: unknown) {
      if (isUniqueConstraintViolation(e)) {
        return reply.code(409).send({ error: 'A permalink with this slug already exists' });
      }
      throw e;
    }
  });

  fastify.delete<{ Params: { id: string } }>('/content/permalinks/:id', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { db, schema } = getDrizzleDb();
    const deleted = await db
      .delete(schema.permalinks)
      .where(eq(schema.permalinks.id, id))
      .returning({ id: schema.permalinks.id });
    if (deleted.length === 0) return reply.code(404).send({ error: 'Permalink not found' });
    return { success: true };
  });

  fastify.get<{ Params: { id: string } }>('/content/permalinks/:id/stats', async (request, reply) => {
    if (!requireContentAdmin(request, reply)) return;
    const id = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid id' });
    const { db, schema } = getDrizzleDb();
    const [plink] = await db.select().from(schema.permalinks).where(eq(schema.permalinks.id, id)).limit(1);
    if (!plink) return reply.code(404).send({ error: 'Permalink not found' });

    const [agg] = await db
      .select({
        totalHits: sql<number>`cast(count(*) as integer)`,
        uniqueVisitors: sql<number>`cast(count(distinct ${schema.permalinkHits.visitor_id}) as integer)`,
        authenticatedHits: sql<number>`cast(coalesce(sum(case when ${schema.permalinkHits.member_id} is not null then 1 else 0 end), 0) as integer)`,
      })
      .from(schema.permalinkHits)
      .where(eq(schema.permalinkHits.permalink_id, id));

    const refRows = await db
      .select({
        referrer_domain: schema.permalinkHits.referrer_domain,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(schema.permalinkHits)
      .where(eq(schema.permalinkHits.permalink_id, id))
      .groupBy(schema.permalinkHits.referrer_domain)
      .orderBy(desc(sql`count(*)`));

    const referrers = refRows.map((r) => ({
      domain: r.referrer_domain && r.referrer_domain.trim() !== '' ? r.referrer_domain : '(none)',
      count: Number(r.count ?? 0),
    }));

    const measured = {
      totalHits: Number(agg?.totalHits ?? 0),
      uniqueVisitors: Number(agg?.uniqueVisitors ?? 0),
      authenticatedHits: Number(agg?.authenticatedHits ?? 0),
    };
    return {
      permalink: mapPermalinkRow(plink),
      ...mergeImportedHitTotals(plink, measured),
      referrers,
    };
  });
}
