import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getPublicArticleBySlug,
  getPublishedPublicEventSlugForArticlePathAlias,
} from '../domains/public/queries/publicReadFacade.js';
import { getPublicMailingListBySlug } from '../domains/content/mailingLists.js';
import { config } from '../config.js';
import { getCachedPublicBootstrap } from './publicBootstrapCache.js';
import { getEventBySlug } from './eventService.js';
import { resolveSpaDocumentHttpStatus } from './spaDocumentStatus.js';

export const DEFAULT_SITE_NAME = 'Triangle Curling';

export const DEFAULT_META_DESCRIPTION =
  'Triangle Curling Club in the Raleigh, Durham, and Chapel Hill area offers learn-to-curl, league play, bonspiels, and group events.';

export type SpaDocumentMeta = {
  status: 200 | 404;
  title: string;
  description: string;
  ogType: 'website' | 'article';
  canonicalPath: string;
  siteName: string;
};

type StaticMeta = {
  pageTitle: string;
  description: string;
  ogType?: 'website' | 'article';
};

const STATIC_META_BY_PATH: Record<string, StaticMeta> = {
  '/': {
    pageTitle: 'Curling in the Triangle',
    description:
      'Discover curling in the Raleigh, Durham, and Chapel Hill area: beginner resources, group event info, upcoming bonspiels, and member information.',
  },
  '/calendar/public': {
    pageTitle: 'Calendar',
    description: 'View the club calendar with ice times, draws, leagues, and upcoming events.',
  },
  '/contact': {
    pageTitle: 'Facility & Contact Info',
    description:
      'Get in touch with Triangle Curling Club by email, review facility details, and connect through our social media channels.',
  },
  '/contact/confirm': {
    pageTitle: 'Contact Confirmation',
    description: 'Contact confirmation for Triangle Curling Club.',
  },
  '/donate': {
    pageTitle: 'Donate',
    description: 'Support Triangle Curling Club with a secure online donation.',
  },
  '/donate/success': {
    pageTitle: 'Thank You',
    description: 'Thank you for supporting Triangle Curling Club.',
  },
  '/donate/cancel': {
    pageTitle: 'Donation Canceled',
    description: 'Donation checkout was canceled.',
  },
  '/dues': {
    pageTitle: 'Membership and dues',
    description:
      'Review Triangle Curling Club membership fees, discounts, and an interactive dues estimator.',
  },
  '/events': {
    pageTitle: 'Events',
    description: 'Upcoming and past public events, bonspiels, and programs at the club.',
  },
  '/leagues/public': {
    pageTitle: 'Leagues',
    description: 'Learn about Triangle Curling Club league play and how to join.',
  },
  '/public/leagues': {
    pageTitle: 'Leagues',
    description: 'Learn about Triangle Curling Club league play and how to join.',
  },
  '/feedback': {
    pageTitle: 'Feedback',
    description: 'Share feedback about the club website or member tools.',
  },
  '/articles': {
    pageTitle: 'Curling resources',
    description:
      'Read Triangle Curling Club resources about learning to curl, club events, bonspiels, and updates for the Raleigh, Durham, and Chapel Hill area.',
  },
  '/search': {
    pageTitle: 'Search',
    description: 'Search Triangle Curling Club articles, events, and site pages.',
  },
  '/explainers/sparing': {
    pageTitle: 'Sparing',
    description:
      'How sparing works: request a spare for one league game, choose public or private, and fill the spot.',
  },
  '/explainers/waitlists': {
    pageTitle: 'League waitlists',
    description:
      'How league waitlists work: how to join, offers, declines, ADD vs REPLACE, and common questions.',
  },
  '/explainers/sabbaticals': {
    pageTitle: 'League sabbaticals',
    description:
      'How league sabbaticals work: how to take one, cost, duration, return rights, and common questions.',
  },
};

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const withoutQuery = pathname.split('?')[0] ?? pathname;
  const withoutTrailingSlash = withoutQuery.replace(/\/+$/, '');
  return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : '/';
}

export function formatDocumentTitle(pageTitle: string, siteName: string): string {
  const page = pageTitle.trim();
  const site = siteName.trim() || DEFAULT_SITE_NAME;
  if (!page) return site;
  if (page === site) return page;
  // Already a composed title (e.g. home marketing title).
  if (page.includes(' | ')) return page;
  return `${page} | ${site}`;
}

export function formatHomeDocumentTitle(siteName: string): string {
  const site = siteName.trim() || DEFAULT_SITE_NAME;
  return `${site} | Curling in the Triangle`;
}

function truncateDescription(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  const sliced = normalized.slice(0, maxLength - 1).trimEnd();
  return `${sliced}…`;
}

async function resolveSiteName(): Promise<string> {
  try {
    const bootstrap = await getCachedPublicBootstrap(false);
    const clubName = bootstrap.siteConfig?.clubName?.trim();
    return clubName || DEFAULT_SITE_NAME;
  } catch {
    return DEFAULT_SITE_NAME;
  }
}

function buildMeta(args: {
  status: 200 | 404;
  pageTitle: string;
  description: string;
  canonicalPath: string;
  siteName: string;
  ogType?: 'website' | 'article';
  home?: boolean;
}): SpaDocumentMeta {
  const title = args.home
    ? formatHomeDocumentTitle(args.siteName)
    : formatDocumentTitle(args.pageTitle, args.siteName);
  return {
    status: args.status,
    title,
    description: args.description.trim() || DEFAULT_META_DESCRIPTION,
    ogType: args.ogType ?? 'website',
    canonicalPath: args.canonicalPath,
    siteName: args.siteName,
  };
}

async function resolveArticleMeta(
  slug: string,
  canonicalPath: string,
  siteName: string,
  status: 200 | 404,
): Promise<SpaDocumentMeta> {
  if (status === 404) {
    return buildMeta({
      status,
      pageTitle: 'Page not found',
      description: DEFAULT_META_DESCRIPTION,
      canonicalPath,
      siteName,
    });
  }

  const article = await getPublicArticleBySlug(slug);
  if (article) {
    return buildMeta({
      status,
      pageTitle: article.title,
      description: article.snippet?.trim()
        ? truncateDescription(article.snippet)
        : 'Read curling resources, guides, event updates, and club news from Triangle Curling Club.',
      canonicalPath,
      siteName,
      ogType: 'article',
    });
  }

  const eventSlug = await getPublishedPublicEventSlugForArticlePathAlias(slug);
  if (eventSlug) {
    const event = await getEventBySlug(eventSlug);
    return buildMeta({
      status,
      pageTitle: event?.title || 'Event',
      description: `View details and registration for ${event?.title || 'this event'} at Triangle Curling Club.`,
      canonicalPath: `/events/${eventSlug}`,
      siteName,
    });
  }

  return buildMeta({
    status: 404,
    pageTitle: 'Page not found',
    description: DEFAULT_META_DESCRIPTION,
    canonicalPath,
    siteName,
  });
}

async function resolveEventMeta(
  slug: string,
  canonicalPath: string,
  siteName: string,
  status: 200 | 404,
  pageTitlePrefix?: string,
): Promise<SpaDocumentMeta> {
  if (status === 404) {
    return buildMeta({
      status,
      pageTitle: 'Page not found',
      description: DEFAULT_META_DESCRIPTION,
      canonicalPath,
      siteName,
    });
  }

  const event = await getEventBySlug(slug);
  const eventTitle = event?.title?.trim() || 'Event';
  const pageTitle = pageTitlePrefix ? `${pageTitlePrefix}: ${eventTitle}` : eventTitle;
  return buildMeta({
    status,
    pageTitle,
    description: `View details and registration for ${eventTitle} at Triangle Curling Club.`,
    canonicalPath,
    siteName,
  });
}

async function resolveMailingListMeta(
  slug: string,
  siteName: string,
  status: 200 | 404,
): Promise<SpaDocumentMeta> {
  const canonicalPath = `/mailing-list/${slug}`;
  if (status === 404) {
    return buildMeta({
      status,
      pageTitle: 'Page not found',
      description: DEFAULT_META_DESCRIPTION,
      canonicalPath,
      siteName,
    });
  }

  const list = await getPublicMailingListBySlug(slug.trim().toLowerCase());
  return buildMeta({
    status,
    pageTitle: list?.name?.trim() || 'Mailing list',
    description:
      list?.description?.trim() ||
      'Subscribe to Triangle Curling Club email updates.',
    canonicalPath,
    siteName,
  });
}

export async function resolveSpaDocumentMeta(pathname: string): Promise<SpaDocumentMeta> {
  const canonicalPath = normalizePathname(pathname);
  const [status, siteName] = await Promise.all([
    resolveSpaDocumentHttpStatus(canonicalPath),
    resolveSiteName(),
  ]);

  const staticMeta = STATIC_META_BY_PATH[canonicalPath];
  if (staticMeta) {
    return buildMeta({
      status,
      pageTitle: staticMeta.pageTitle,
      description: staticMeta.description,
      canonicalPath: canonicalPath === '/public/leagues' ? '/leagues/public' : canonicalPath,
      siteName,
      ogType: staticMeta.ogType,
      home: canonicalPath === '/',
    });
  }

  let match = canonicalPath.match(/^\/articles\/([^/]+)$/);
  if (match) {
    return resolveArticleMeta(match[1], canonicalPath, siteName, status);
  }
  match = canonicalPath.match(/^\/article\/([^/]+)$/);
  if (match) {
    return resolveArticleMeta(match[1], `/articles/${match[1]}`, siteName, status);
  }

  match = canonicalPath.match(/^\/mailing-list\/([^/]+)$/);
  if (match) {
    return resolveMailingListMeta(match[1], siteName, status);
  }

  match = canonicalPath.match(/^\/events\/([^/]+)\/register\/success$/);
  if (match) {
    return resolveEventMeta(match[1], canonicalPath, siteName, status, 'Registered');
  }
  match = canonicalPath.match(/^\/events\/([^/]+)\/register$/);
  if (match) {
    return resolveEventMeta(match[1], canonicalPath, siteName, status, 'Register');
  }
  match = canonicalPath.match(/^\/events\/([^/]+)\/teams\/([^/]+)$/);
  if (match) {
    return resolveEventMeta(match[1], canonicalPath, siteName, status, 'Team');
  }
  match = canonicalPath.match(/^\/events\/([^/]+)$/);
  if (match) {
    return resolveEventMeta(match[1], canonicalPath, siteName, status);
  }

  match = canonicalPath.match(/^\/go\/([^/]+)\/info$/);
  if (match) {
    return buildMeta({
      status,
      pageTitle: 'Short link',
      description: 'Where this short link goes before you follow it.',
      canonicalPath,
      siteName,
    });
  }

  match = canonicalPath.match(/^\/payments\/([^/]+)$/);
  if (match) {
    return buildMeta({
      status,
      pageTitle: 'Payment details',
      description: 'View payment details for a Triangle Curling Club transaction.',
      canonicalPath,
      siteName,
    });
  }

  if (status === 404) {
    return buildMeta({
      status,
      pageTitle: 'Page not found',
      description: DEFAULT_META_DESCRIPTION,
      canonicalPath,
      siteName,
    });
  }

  // Known SPA routes without dedicated public marketing copy (auth shells, etc.)
  return buildMeta({
    status,
    pageTitle: siteName,
    description: DEFAULT_META_DESCRIPTION,
    canonicalPath,
    siteName,
  });
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function upsertMetaTag(
  html: string,
  attrName: 'name' | 'property',
  attrValue: string,
  content: string,
): string {
  const escapedContent = escapeHtmlAttr(content);
  const tag = `<meta ${attrName}="${attrValue}" content="${escapedContent}" />`;
  const pattern = new RegExp(
    `<meta\\s+[^>]*(?:${attrName}\\s*=\\s*["']${attrValue}["'][^>]*content\\s*=\\s*["'][^"']*["']|content\\s*=\\s*["'][^"']*["'][^>]*${attrName}\\s*=\\s*["']${attrValue}["'])[^>]*>`,
    'i',
  );
  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }
  return html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
}

function upsertLinkTag(html: string, rel: string, href: string): string {
  const escapedHref = escapeHtmlAttr(href);
  const tag = `<link rel="${rel}" href="${escapedHref}" />`;
  const pattern = new RegExp(`<link\\s+[^>]*rel\\s*=\\s*["']${rel}["'][^>]*>`, 'i');
  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }
  return html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
}

function upsertTitle(html: string, title: string): string {
  const escaped = escapeHtmlText(title);
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escaped}</title>`);
  }
  return html.replace(/<\/head>/i, `    <title>${escaped}</title>\n  </head>`);
}

export function injectSpaDocumentMeta(
  html: string,
  meta: SpaDocumentMeta,
  origin: string,
): string {
  const base = origin.replace(/\/+$/, '');
  const canonicalUrl = `${base}${meta.canonicalPath === '/' ? '/' : meta.canonicalPath}`;

  let next = upsertTitle(html, meta.title);
  next = upsertMetaTag(next, 'name', 'description', meta.description);
  next = upsertMetaTag(next, 'property', 'og:title', meta.title);
  next = upsertMetaTag(next, 'property', 'og:description', meta.description);
  next = upsertMetaTag(next, 'property', 'og:type', meta.ogType);
  next = upsertMetaTag(next, 'property', 'og:site_name', meta.siteName);
  next = upsertMetaTag(next, 'property', 'og:url', canonicalUrl);
  next = upsertMetaTag(next, 'name', 'twitter:card', 'summary_large_image');
  next = upsertMetaTag(next, 'name', 'twitter:title', meta.title);
  next = upsertMetaTag(next, 'name', 'twitter:description', meta.description);
  next = upsertLinkTag(next, 'canonical', canonicalUrl);
  return next;
}

type IndexHtmlCache = {
  filePath: string;
  mtimeMs: number;
  contents: string;
};

let indexHtmlCache: IndexHtmlCache | null = null;

export function resolveSpaIndexHtmlPath(): string | null {
  const configured = (config.frontendDistPath || '').trim();
  if (!configured) return null;
  return path.join(configured, 'index.html');
}

export async function readSpaIndexHtml(): Promise<string | null> {
  const filePath = resolveSpaIndexHtmlPath();
  if (!filePath) return null;

  try {
    const stat = await fs.stat(filePath);
    if (indexHtmlCache && indexHtmlCache.filePath === filePath && indexHtmlCache.mtimeMs === stat.mtimeMs) {
      return indexHtmlCache.contents;
    }
    const contents = await fs.readFile(filePath, 'utf8');
    indexHtmlCache = { filePath, mtimeMs: stat.mtimeMs, contents };
    return contents;
  } catch {
    return null;
  }
}

/** Test helper */
export function clearSpaIndexHtmlCacheForTests(): void {
  indexHtmlCache = null;
}
