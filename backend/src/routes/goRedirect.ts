import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { config } from '../config.js';
import type { Member } from '../types.js';

const VISITOR_COOKIE = 'tc_pl_vid';

function readCookieHeader(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

function referrerDomain(referer: string | undefined): string | null {
  if (!referer?.trim()) return null;
  try {
    const host = new URL(referer).hostname;
    return host || null;
  } catch {
    return null;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function permalinkInfoHtml(row: {
  slug: string;
  label: string | null;
  destination_url: string;
  destination_may_change: number;
}): string {
  const title = row.label?.trim() ? escapeHtml(row.label.trim()) : `Short link (${escapeHtml(row.slug)})`;
  const dest = escapeHtml(row.destination_url.trim());
  const destRaw = row.destination_url.trim();
  const redirectNote = row.destination_may_change === 1 ? 'temporary (302)' : 'permanent (301)';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5;">
  <h1 style="font-size: 1.25rem;">${title}</h1>
  <p style="color: #444;">This page shows where the short link goes before you follow it.</p>
  <p><strong>Destination URL</strong></p>
  <p style="word-break: break-all; background: #f5f5f5; padding: 0.75rem; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 0.9rem;">${dest}</p>
  <p><a href="${escapeHtml(destRaw)}" style="display: inline-block; margin-top: 0.5rem;">Continue to destination</a></p>
  <p style="font-size: 0.8rem; color: #666;">Using the short URL issues a ${redirectNote} redirect to this destination.</p>
</body>
</html>`;
}

function recordHit(
  permalinkId: number,
  visitorId: string,
  member: Member | undefined,
  refDomain: string | null
): void {
  const memberId = member?.id ?? null;
  void (async () => {
    try {
      const { db, schema } = getDrizzleDb();
      await db.insert(schema.permalinkHits).values({
        permalink_id: permalinkId,
        visitor_id: visitorId,
        member_id: memberId,
        referrer_domain: refDomain,
      });
    } catch {
      // best-effort analytics
    }
  })();
}

export async function goRedirectRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { slug: string } }>('/:slug/info', async (request, reply) => {
    const slug = request.params.slug?.trim().toLowerCase();
    if (!slug) {
      return reply.code(404).type('text/html').send('<!DOCTYPE html><html><body>Not found</body></html>');
    }

    const { db, schema } = getDrizzleDb();
    const [row] = await db
      .select()
      .from(schema.permalinks)
      .where(eq(schema.permalinks.slug, slug))
      .limit(1);

    if (!row) {
      return reply.code(404).type('text/html').send('<!DOCTYPE html><html><body>Not found</body></html>');
    }

    const feBase = config.frontendUrl.replace(/\/+$/, '');
    let feHost: string | null = null;
    try {
      feHost = new URL(feBase).hostname;
    } catch {
      feHost = null;
    }
    if (feHost && request.hostname !== feHost) {
      return reply.redirect(`${feBase}/go/${encodeURIComponent(slug)}/info`, 302);
    }

    return reply.type('text/html; charset=utf-8').send(permalinkInfoHtml(row));
  });

  fastify.get<{ Params: { slug: string } }>('/:slug', async (request, reply) => {
    const slug = request.params.slug?.trim().toLowerCase();
    if (!slug) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const { db, schema } = getDrizzleDb();
    const [row] = await db
      .select()
      .from(schema.permalinks)
      .where(eq(schema.permalinks.slug, slug))
      .limit(1);

    if (!row) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const dest = row.destination_url.trim();
    const statusCode = row.destination_may_change === 1 ? 302 : 301;

    const existingVid = readCookieHeader(request.headers.cookie, VISITOR_COOKIE);
    const visitorId = existingVid && existingVid.length > 0 ? existingVid : crypto.randomUUID();
    const refDom = referrerDomain(request.headers.referer);

    recordHit(row.id, visitorId, request.member, refDom);

    if (!existingVid) {
      const cookieParts = [
        `${VISITOR_COOKIE}=${encodeURIComponent(visitorId)}`,
        'Path=/',
        'Max-Age=31536000',
        'SameSite=Lax',
        'HttpOnly',
      ];
      if (config.nodeEnv === 'production') {
        cookieParts.push('Secure');
      }
      reply.header('Set-Cookie', cookieParts.join('; '));
    }

    return reply.code(statusCode).redirect(dest);
  });
}
