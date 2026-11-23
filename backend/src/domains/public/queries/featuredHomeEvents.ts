import { and, asc, eq, inArray } from 'drizzle-orm';
import { getEffectiveArticleSnippet } from '../../../content/articleSnippet.js';
import { getDrizzleDb } from '../../../db/drizzle-db.js';
import { isBonspielCalendarType } from '../../../services/eventCalendarTypes.js';
import { getPublicEventRegistrationStats } from '../../../services/eventWaitlistService.js';
import { drawJsonHasRecordedScores } from '../../../utils/tournamentDrawRecordedScores.js';
import { notArchivedCondition } from '../../../utils/softDelete.js';

export type FeaturedHomeEvent = {
  id: number;
  title: string;
  slug: string;
  snippet: string;
  hasMore: boolean;
  timespans: Array<{ id: number; start_dt: string; end_dt: string; sort_order: number }>;
  locations: Array<{ location_type: string }>;
  feeMinor: number;
  memberFeeMinor: number | null;
  currency: string;
  registrationStart: string | null;
  registrationCutoff: string | null;
  /** True when a new registration cannot be confirmed because capacity is taken. */
  registrationFull: boolean;
  showTeams: boolean;
  showDraw: boolean;
  drawHasRecordedScores: boolean;
};

const FEATURED_EVENT_LIMIT = 6;

function timestampToIso(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function loadFeaturedHomeEvents(): Promise<{
  events: FeaturedHomeEvent[];
  articleIds: Set<number>;
}> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      slug: schema.events.slug,
      articleId: schema.events.article_id,
      capacity: schema.events.capacity,
      feeMinor: schema.events.fee_minor,
      memberFeeMinor: schema.events.member_fee_minor,
      currency: schema.events.currency,
      registrationStart: schema.events.registration_start,
      registrationCutoff: schema.events.registration_cutoff,
      calendarTypeIds: schema.events.calendar_type_ids,
      tournamentTeamsPublished: schema.events.tournament_teams_published,
      tournamentDrawPublished: schema.events.tournament_draw_published,
      tournamentDrawJson: schema.events.tournament_draw_json,
      articleTitle: schema.articles.title,
      articleContent: schema.articles.content,
      articleContentType: schema.articles.content_type,
      articleSnippet: schema.articles.snippet,
    })
    .from(schema.events)
    .leftJoin(schema.articles, eq(schema.events.article_id, schema.articles.id))
    .where(
      and(
        eq(schema.events.featured, 1),
        eq(schema.events.published, 1),
        eq(schema.events.visibility, 'public'),
        notArchivedCondition(schema.events.archived_at),
      ),
    )
    .orderBy(asc(schema.events.featured_sort_order), asc(schema.events.id))
    .limit(FEATURED_EVENT_LIMIT);

  if (rows.length === 0) {
    return { events: [], articleIds: new Set() };
  }

  const eventIds = rows.map((row) => row.id);
  const [timespanRows, locationRows, statsByEventId] = await Promise.all([
    db
      .select({
        id: schema.eventTimespans.id,
        eventId: schema.eventTimespans.event_id,
        startDt: schema.eventTimespans.start_dt,
        endDt: schema.eventTimespans.end_dt,
        sortOrder: schema.eventTimespans.sort_order,
      })
      .from(schema.eventTimespans)
      .where(inArray(schema.eventTimespans.event_id, eventIds))
      .orderBy(asc(schema.eventTimespans.sort_order), asc(schema.eventTimespans.id)),
    db
      .select({
        eventId: schema.eventLocations.event_id,
        locationType: schema.eventLocations.location_type,
      })
      .from(schema.eventLocations)
      .where(inArray(schema.eventLocations.event_id, eventIds))
      .orderBy(asc(schema.eventLocations.id)),
    getPublicEventRegistrationStats(rows.map((row) => ({ id: row.id, capacity: row.capacity }))),
  ]);

  const timespansByEvent = new Map<number, FeaturedHomeEvent['timespans']>();
  for (const row of timespanRows) {
    const list = timespansByEvent.get(row.eventId) ?? [];
    list.push({
      id: row.id,
      start_dt: row.startDt,
      end_dt: row.endDt,
      sort_order: row.sortOrder,
    });
    timespansByEvent.set(row.eventId, list);
  }

  const locationsByEvent = new Map<number, FeaturedHomeEvent['locations']>();
  for (const row of locationRows) {
    const list = locationsByEvent.get(row.eventId) ?? [];
    list.push({ location_type: row.locationType });
    locationsByEvent.set(row.eventId, list);
  }

  const articleIds = new Set<number>();
  const events = rows.map((row) => {
    if (row.articleId != null) articleIds.add(row.articleId);
    const isBonspiel = isBonspielCalendarType(row.calendarTypeIds);
    const showTeams = isBonspiel && row.tournamentTeamsPublished === 1;
    const showDraw = isBonspiel && row.tournamentDrawPublished === 1;
    const articleTitle = row.articleTitle?.trim();
    const snippetSource = row.articleId != null
      ? getEffectiveArticleSnippet(
          row.articleContent ?? '',
          row.articleSnippet,
          (row.articleContentType ?? 'markdown') as 'markdown' | 'html',
        )
      : { snippet: '', hasMore: false };
    const openSpots = statsByEventId.get(row.id)?.openSpots ?? null;
    return {
      id: row.id,
      title: articleTitle || row.title,
      slug: row.slug,
      snippet: snippetSource.snippet,
      hasMore: snippetSource.hasMore,
      timespans: timespansByEvent.get(row.id) ?? [],
      locations: locationsByEvent.get(row.id) ?? [],
      feeMinor: row.feeMinor,
      memberFeeMinor: row.memberFeeMinor ?? null,
      currency: row.currency || 'usd',
      registrationStart: timestampToIso(row.registrationStart),
      registrationCutoff: timestampToIso(row.registrationCutoff),
      registrationFull: openSpots != null && openSpots <= 0,
      showTeams,
      showDraw,
      drawHasRecordedScores: showDraw && drawJsonHasRecordedScores(row.tournamentDrawJson),
    };
  });

  return { events, articleIds };
}
