import { eq } from 'drizzle-orm';
import {
  getPublicArticleBySlug,
  getPublishedPublicEventSlugForArticlePathAlias,
} from '../domains/public/queries/publicReadFacade.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { getEventBySlug, isBonspielCalendarType } from './eventService.js';
import { listTournamentTeamsForEvent } from './eventTournamentTeamsService.js';
import { getPaymentDetailByOrderToken } from './memberPaymentHistoryService.js';
import { mailingListSlugExists } from '../domains/content/mailingLists.js';

type HttpStatus = 200 | 404;

type SpaRouteRule = {
  pattern: RegExp;
  resolve?: (match: RegExpMatchArray) => Promise<HttpStatus>;
};

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const withoutTrailingSlash = pathname.replace(/\/+$/, '');
  return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : '/';
}

async function isPublicPublishedEventSlug(slug: string): Promise<boolean> {
  const event = await getEventBySlug(slug);
  return Boolean(event && event.published === 1 && event.visibility === 'public');
}

async function isPublicArticlePath(slug: string): Promise<boolean> {
  const article = await getPublicArticleBySlug(slug);
  if (article) return true;
  const eventSlug = await getPublishedPublicEventSlugForArticlePathAlias(slug);
  return eventSlug != null;
}

async function isPublicEventTeamPath(slug: string, teamIdRaw: string): Promise<boolean> {
  const teamId = Number.parseInt(teamIdRaw, 10);
  if (!Number.isFinite(teamId)) return false;

  const event = await getEventBySlug(slug);
  if (!event || event.published !== 1 || event.visibility !== 'public') return false;
  if (event.tournament_teams_published !== 1) return false;
  if (!isBonspielCalendarType(event.calendar_type_id)) return false;

  try {
    const teams = await listTournamentTeamsForEvent(event.id);
    return teams.some((team) => team.id === teamId);
  } catch {
    return false;
  }
}

async function isPublicPermalinkInfoPath(slug: string): Promise<boolean> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return false;
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ id: schema.permalinks.id })
    .from(schema.permalinks)
    .where(eq(schema.permalinks.slug, normalized))
    .limit(1);
  return row != null;
}

const SPA_ROUTE_RULES: SpaRouteRule[] = [
  { pattern: /^\/$/ },
  { pattern: /^\/login$/ },
  { pattern: /^\/install$/ },
  { pattern: /^\/help$/ },
  { pattern: /^\/help\/.+$/ },
  { pattern: /^\/feedback$/ },
  { pattern: /^\/contact$/ },
  { pattern: /^\/contact\/confirm$/ },
  { pattern: /^\/donate$/ },
  { pattern: /^\/donate\/success$/ },
  { pattern: /^\/donate\/cancel$/ },
  { pattern: /^\/events$/ },
  { pattern: /^\/leagues\/public$/ },
  { pattern: /^\/public\/leagues$/ },
  { pattern: /^\/calendar\/public$/ },
  { pattern: /^\/articles$/ },
  {
    pattern: /^\/articles\/([^/]+)$/,
    resolve: async ([, slug]) => ((await isPublicArticlePath(slug)) ? 200 : 404),
  },
  {
    pattern: /^\/article\/([^/]+)$/,
    resolve: async ([, slug]) => ((await isPublicArticlePath(slug)) ? 200 : 404),
  },
  {
    pattern: /^\/mailing-list\/([^/]+)$/,
    resolve: async ([, slug]) => ((await mailingListSlugExists(slug.trim().toLowerCase())) ? 200 : 404),
  },
  {
    pattern: /^\/payments\/([^/]+)$/,
    resolve: async ([, orderToken]) => ((await getPaymentDetailByOrderToken(orderToken)) ? 200 : 404),
  },
  {
    pattern: /^\/events\/([^/]+)\/teams\/([^/]+)$/,
    resolve: async ([, slug, teamId]) => ((await isPublicEventTeamPath(slug, teamId)) ? 200 : 404),
  },
  {
    pattern: /^\/events\/([^/]+)\/register\/success$/,
    resolve: async ([, slug]) => ((await isPublicPublishedEventSlug(slug)) ? 200 : 404),
  },
  {
    pattern: /^\/events\/([^/]+)\/register$/,
    resolve: async ([, slug]) => ((await isPublicPublishedEventSlug(slug)) ? 200 : 404),
  },
  {
    pattern: /^\/events\/([^/]+)$/,
    resolve: async ([, slug]) => ((await isPublicPublishedEventSlug(slug)) ? 200 : 404),
  },
  {
    pattern: /^\/go\/([^/]+)\/info$/,
    resolve: async ([, slug]) => ((await isPublicPermalinkInfoPath(slug)) ? 200 : 404),
  },
  { pattern: /^\/registration\/start$/ },
  { pattern: /^\/registration\/success$/ },
  { pattern: /^\/registration\/cancel$/ },
  { pattern: /^\/registration\/[^/]+$/ },
  { pattern: /^\/admin\/content\/articles\/[^/]+\/versions\/[^/]+\/preview$/ },
  { pattern: /^\/admin\/content\/articles\/draft-preview$/ },
  { pattern: /^\/admin\/events\/registration-preview$/ },
  { pattern: /^\/dashboard$/ },
  { pattern: /^\/registration\/view$/ },
  { pattern: /^\/registration\/view\/[^/]+$/ },
  { pattern: /^\/registration\/\d+$/ },
  { pattern: /^\/registration\/waitlist-offers\/[^/]+\/accept$/ },
  { pattern: /^\/registration\/waitlist-offers\/[^/]+\/decline$/ },
  { pattern: /^\/availability$/ },
  { pattern: /^\/request-spare$/ },
  { pattern: /^\/request-spare\/new$/ },
  { pattern: /^\/spare-request\/respond$/ },
  { pattern: /^\/spare-request\/decline$/ },
  { pattern: /^\/my-requests$/ },
  { pattern: /^\/members$/ },
  { pattern: /^\/governance$/ },
  { pattern: /^\/calendar$/ },
  { pattern: /^\/calendar\/events\/new$/ },
  { pattern: /^\/calendar\/events\/edit(?:\/.*)?$/ },
  { pattern: /^\/book-ice$/ },
  { pattern: /^\/profile$/ },
  { pattern: /^\/profile\/preferences$/ },
  { pattern: /^\/profile\/payment-history\/[^/]+$/ },
  { pattern: /^\/profile\/[^/]+$/ },
  { pattern: /^\/admin\/members$/ },
  { pattern: /^\/admin\/waivers$/ },
  { pattern: /^\/leagues\/copy-to-session$/ },
  { pattern: /^\/leagues$/ },
  { pattern: /^\/leagues\/[^/]+$/ },
  { pattern: /^\/leagues\/[^/]+\/[^/]+$/ },
  { pattern: /^\/admin\/leagues$/ },
  { pattern: /^\/admin\/leagues\/[^/]+\/setup(?:\/[^/]+)?$/ },
  { pattern: /^\/admin\/sheets$/ },
  { pattern: /^\/admin\/config$/ },
  { pattern: /^\/admin\/observability$/ },
  { pattern: /^\/admin\/sponsorship$/ },
  { pattern: /^\/admin\/governance$/ },
  { pattern: /^\/admin\/roles$/ },
  { pattern: /^\/admin\/events$/ },
  { pattern: /^\/admin\/events\/[^/]+$/ },
  { pattern: /^\/admin\/events\/[^/]+\/[^/]+$/ },
  { pattern: /^\/admin\/events\/[^/]+\/registrations\/[^/]+$/ },
  { pattern: /^\/admin\/registration$/ },
  { pattern: /^\/admin\/registration\/communications$/ },
  { pattern: /^\/admin\/registration\/[^/]+$/ },
  { pattern: /^\/waitlists$/ },
  { pattern: /^\/waitlists\/[^/]+$/ },
  { pattern: /^\/admin\/registrations$/ },
  { pattern: /^\/admin\/registrations\/[^/]+$/ },
  { pattern: /^\/admin\/payments$/ },
  { pattern: /^\/admin\/webhooks$/ },
  { pattern: /^\/admin\/database-config$/ },
  { pattern: /^\/admin\/feedback$/ },
  { pattern: /^\/admin\/content$/ },
  { pattern: /^\/admin\/content\/site$/ },
  { pattern: /^\/admin\/content\/articles\/[^/]+$/ },
  { pattern: /^\/admin\/content\/[^/]+$/ },
];

export async function resolveSpaDocumentHttpStatus(pathname: string): Promise<HttpStatus> {
  const path = normalizePathname(pathname);

  for (const rule of SPA_ROUTE_RULES) {
    const match = path.match(rule.pattern);
    if (!match) continue;
    if (rule.resolve) {
      return rule.resolve(match);
    }
    return 200;
  }

  return 404;
}
