/* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle row shapes and DB literal columns; prefer incremental typing over time */
import crypto from 'crypto';
import { and, eq, gte, lte, ne, inArray, asc, desc, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { EventRegistrationStatus, EventFieldType, EventFieldScope, EventVisibility } from '../db/drizzle-schema.js';
import {
  assertNoDuplicatePresets,
  normalizeRegistrationFieldRow,
  validateRegistrationFieldValues,
} from './eventRegistrationFieldDefinitions.js';
import { countTournamentTeams, normalizeTournamentFormat } from './eventTournamentTeamsService.js';
import { sanitizeTournamentDrawJsonForDuplicate } from './eventTournamentDrawService.js';
import { syncTournamentTeamForRegistrationSafe } from './eventTournamentRegistrationSyncService.js';
import { EventServiceError } from './eventServiceError.js';
import { formatMemberDisplayName } from '../utils/memberName.js';
import { generateEventRegistrationAccessToken } from '../utils/eventRegistrationAccessToken.js';
import { getSeasonStartYearForUtcDate, parseFiscalYearStartMmdd, seasonStartYearsTouchingRangeUtc } from '../utils/fiscalSeason.js';
import { getCurrentTimeAsync } from '../utils/time.js';
import { isArchivedAt, notArchivedCondition } from '../utils/softDelete.js';

export { EventServiceError };

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(value);
}

function normalizePointOfContact(value: string): string {
  return value.trim();
}

/** Milliseconds for comparison. Do not use String(date) vs ISO strings — locale strings sort incorrectly. */
function eventTimeMs(value: string | Date | null | undefined): number | null {
  if (value == null || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

const CALENDAR_EVENT_TYPE_IDS = new Set(['bonspiel', 'learn-to-curl', 'juniors', 'other']);

const LEGACY_CALENDAR_TYPE_ID: Record<string, string> = {
  clinic: 'learn-to-curl',
  social: 'other',
  maintenance: 'other',
  learn_to_curl: 'learn-to-curl',
};

export function normalizeCalendarTypeId(raw: string | null | undefined): string {
  if (raw == null || raw === '') return 'other';
  if (CALENDAR_EVENT_TYPE_IDS.has(raw)) return raw;
  const mapped = LEGACY_CALENDAR_TYPE_ID[raw];
  if (mapped) return mapped;
  return 'other';
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Per-person registration fee (minor units) before group size multiplier. */
export function resolveEventRegistrationFeeMinor(
  event: { fee_minor: number; member_fee_minor?: number | null },
  input: {
    memberId?: number | null;
    adminOverride?: boolean;
    specialLinkOverrideMinor?: number | null;
  }
): number {
  if (input.adminOverride) return 0;
  if (input.specialLinkOverrideMinor !== null && input.specialLinkOverrideMinor !== undefined) {
    return input.specialLinkOverrideMinor;
  }
  if (input.memberId != null && event.member_fee_minor != null) {
    return event.member_fee_minor;
  }
  return event.fee_minor ?? 0;
}

export interface CreateEventInput {
  title: string;
  slug?: string;
  articleId?: number | null;
  imageFileId?: number | null;
  visibility?: EventVisibility;
  capacity?: number | null;
  feeMinor?: number;
  /** When set, authenticated registrants pay this per-person amount instead of feeMinor. */
  memberFeeMinor?: number | null;
  currency?: string;
  registrationStart?: string | null;
  registrationCutoff?: string | null;
  cancellationCutoff?: string | null;
  allowGroupRegistration?: boolean;
  maxGroupSize?: number | null;
  enableWaitlist?: boolean;
  termsArticleId?: number | null;
  /** Calendar color category (club calendar `typeId`). */
  calendarTypeId?: string;
  tournamentTeamsPublished?: boolean;
  tournamentDrawPublished?: boolean;
  /** Bonspiel: fours vs doubles roster shape. */
  tournamentFormat?: 'fours' | 'doubles' | null;
  /** Email address for event inquiries and operational contact. */
  pointOfContact: string;
  createdByMemberId?: number | null;
  timespans: Array<{ startDt: string; endDt: string; sortOrder?: number }>;
  locations?: Array<{ locationType: string; sheetId?: number | null }>;
  categoryIds?: number[];
  ownerMemberIds?: number[];
  registrationFields?: Array<{
    label: string;
    fieldType: EventFieldType;
    scope?: EventFieldScope;
    required?: boolean;
    options?: string | null;
    sortOrder?: number;
  }>;
}

export interface UpdateEventInput {
  title?: string;
  slug?: string;
  articleId?: number | null;
  imageFileId?: number | null;
  visibility?: EventVisibility;
  published?: boolean;
  capacity?: number | null;
  feeMinor?: number;
  memberFeeMinor?: number | null;
  currency?: string;
  registrationStart?: string | null;
  registrationCutoff?: string | null;
  cancellationCutoff?: string | null;
  allowGroupRegistration?: boolean;
  maxGroupSize?: number | null;
  enableWaitlist?: boolean;
  termsArticleId?: number | null;
  calendarTypeId?: string;
  tournamentTeamsPublished?: boolean;
  tournamentDrawPublished?: boolean;
  tournamentFormat?: 'fours' | 'doubles' | null;
  pointOfContact?: string;
  timespans?: Array<{ startDt: string; endDt: string; sortOrder?: number }>;
  locations?: Array<{ locationType: string; sheetId?: number | null }>;
  categoryIds?: number[];
  ownerMemberIds?: number[];
  registrationFields?: Array<{
    id?: number;
    label: string;
    fieldType: EventFieldType;
    scope?: EventFieldScope;
    required?: boolean;
    options?: string | null;
    sortOrder?: number;
  }>;
}

export interface RegisterForEventInput {
  eventId: number;
  memberId?: number | null;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  groupMembers?: Array<{ name: string; email?: string }>;
  fieldValues?: Array<{
    fieldId: number;
    registrationMemberId?: number | null;
    registrationMemberIndex?: number | null;
    value: string;
  }>;
  specialLinkToken?: string | null;
  adminOverride?: boolean;
  /** Manager manual waitlist add: always waitlist regardless of capacity. */
  forceWaitlist?: boolean;
}

async function ensureUniqueSlug(baseSlug: string, excludeId?: number): Promise<string> {
  const { db, schema } = getDrizzleDb();
  let slug = baseSlug;
  let suffix = 0;
  while (true) {
    const conditions = [eq(schema.events.slug, slug)];
    if (excludeId) {
      conditions.push(ne(schema.events.id, excludeId));
    }
    const [existing] = await db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(and(...conditions))
      .limit(1);
    if (!existing) return slug;
    suffix++;
    slug = `${baseSlug}-${suffix}`;
  }
}

async function ensureUniqueArticleSlug(baseSlug: string): Promise<string> {
  const { db, schema } = getDrizzleDb();
  let slug = baseSlug;
  let suffix = 0;
  while (true) {
    const [existing] = await db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.slug, slug))
      .limit(1);
    if (!existing) return slug;
    suffix++;
    slug = `${baseSlug}-${suffix}`;
  }
}

/** Copy event details article content without version history (new article row). */
async function cloneEventArticleWithoutVersionHistory(
  sourceArticleId: number,
  eventSlug: string,
  title: string,
  createdByMemberId: number,
): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const [source] = await db
    .select()
    .from(schema.articles)
    .where(eq(schema.articles.id, sourceArticleId))
    .limit(1);
  if (!source) {
    throw new EventServiceError('Event details article not found', 404);
  }

  const baseSlug = slugify(eventSlug) || slugify(title) || 'event-details';
  const slug = await ensureUniqueArticleSlug(baseSlug);

  const [created] = await db
    .insert(schema.articles)
    .values({
      title,
      slug,
      content_type: source.content_type ?? 'markdown',
      content: source.content,
      snippet: source.snippet ?? null,
      featured: 0,
      featured_sort_order: 0,
      published_at: null,
      created_by_member_id: createdByMemberId,
    })
    .returning({ id: schema.articles.id });

  return created.id;
}

export async function createEvent(input: CreateEventInput): Promise<{ id: number; slug: string }> {
  const { db, schema } = getDrizzleDb();

  if (!input.timespans || input.timespans.length === 0) {
    throw new EventServiceError('At least one timespan is required');
  }

  const pointOfContact = normalizePointOfContact(input.pointOfContact);
  if (!pointOfContact) {
    throw new EventServiceError('Point of contact is required', 400);
  }

  const baseSlug = input.slug ? slugify(input.slug) : slugify(input.title);
  const slug = await ensureUniqueSlug(baseSlug);

  const [event] = await db
    .insert(schema.events)
    .values({
      title: input.title,
      slug,
      article_id: input.articleId ?? null,
      image_file_id: input.imageFileId ?? null,
      visibility: input.visibility ?? 'public',
      published: 0,
      capacity: input.capacity ?? null,
      fee_minor: input.feeMinor ?? 0,
      member_fee_minor: input.memberFeeMinor ?? null,
      currency: input.currency ?? 'usd',
      registration_start: toDateOrNull(input.registrationStart),
      registration_cutoff: toDateOrNull(input.registrationCutoff),
      cancellation_cutoff: toDateOrNull(input.cancellationCutoff),
      allow_group_registration: input.allowGroupRegistration ? 1 : 0,
      max_group_size: input.maxGroupSize ?? null,
      enable_waitlist: input.enableWaitlist !== false ? 1 : 0,
      calendar_type_id: normalizeCalendarTypeId(input.calendarTypeId),
      tournament_teams_published: input.tournamentTeamsPublished ? 1 : 0,
      tournament_draw_published: input.tournamentDrawPublished ? 1 : 0,
      tournament_format:
        input.tournamentFormat === undefined
          ? null
          : normalizeTournamentFormat(input.tournamentFormat as string),
      terms_article_id: input.termsArticleId ?? null,
      point_of_contact: pointOfContact,
      created_by_member_id: input.createdByMemberId ?? null,
    } as any)
    .returning({ id: schema.events.id });

  const eventId = event.id;

  await db.insert(schema.eventTimespans).values(
    input.timespans.map((ts, i) => ({
      event_id: eventId,
      start_dt: ts.startDt,
      end_dt: ts.endDt,
      sort_order: ts.sortOrder ?? i,
    }))
  );

  if (input.locations && input.locations.length > 0) {
    await db.insert(schema.eventLocations).values(
      input.locations.map((loc) => ({
        event_id: eventId,
        location_type: loc.locationType as any,
        sheet_id: loc.sheetId ?? null,
      }))
    );
  }

  if (input.categoryIds && input.categoryIds.length > 0) {
    await db.insert(schema.eventCategoryAssignments).values(
      input.categoryIds.map((catId) => ({
        event_id: eventId,
        category_id: catId,
      }))
    );
  }

  if (input.ownerMemberIds && input.ownerMemberIds.length > 0) {
    await db.insert(schema.eventOwners).values(
      input.ownerMemberIds.map((memberId) => ({
        event_id: eventId,
        member_id: memberId,
      }))
    );
  }

  if (input.registrationFields && input.registrationFields.length > 0) {
    assertNoDuplicatePresets(input.registrationFields);
    await db.insert(schema.eventRegistrationFields).values(
      input.registrationFields.map((f, i) => {
        const n = normalizeRegistrationFieldRow({
          label: f.label,
          fieldType: f.fieldType,
          scope: f.scope,
          required: f.required,
          options: f.options,
          sortOrder: f.sortOrder ?? i,
        });
        return {
          event_id: eventId,
          label: n.label,
          field_type: n.fieldType as any,
          scope: n.scope as any,
          required: n.required ? 1 : 0,
          options: n.options,
          sort_order: n.sortOrder ?? i,
        };
      })
    );
  }

  return { id: eventId, slug };
}

export async function updateEvent(eventId: number, input: UpdateEventInput): Promise<void> {
  const { db, schema } = getDrizzleDb();

  const updateValues: Record<string, any> = {};
  if (input.title !== undefined) updateValues.title = input.title;
  if (input.slug !== undefined) {
    updateValues.slug = await ensureUniqueSlug(slugify(input.slug), eventId);
  }
  if (input.articleId !== undefined) updateValues.article_id = input.articleId;
  if (input.imageFileId !== undefined) updateValues.image_file_id = input.imageFileId;
  if (input.visibility !== undefined) updateValues.visibility = input.visibility;
  if (input.published !== undefined) updateValues.published = input.published ? 1 : 0;
  if (input.capacity !== undefined) updateValues.capacity = input.capacity;
  if (input.feeMinor !== undefined) updateValues.fee_minor = input.feeMinor;
  if (input.memberFeeMinor !== undefined) updateValues.member_fee_minor = input.memberFeeMinor;
  if (input.currency !== undefined) updateValues.currency = input.currency;
  if (input.registrationStart !== undefined) updateValues.registration_start = toDateOrNull(input.registrationStart);
  if (input.registrationCutoff !== undefined) updateValues.registration_cutoff = toDateOrNull(input.registrationCutoff);
  if (input.cancellationCutoff !== undefined) updateValues.cancellation_cutoff = toDateOrNull(input.cancellationCutoff);
  if (input.allowGroupRegistration !== undefined) updateValues.allow_group_registration = input.allowGroupRegistration ? 1 : 0;
  if (input.maxGroupSize !== undefined) updateValues.max_group_size = input.maxGroupSize;
  if (input.enableWaitlist !== undefined) updateValues.enable_waitlist = input.enableWaitlist ? 1 : 0;
  if (input.termsArticleId !== undefined) updateValues.terms_article_id = input.termsArticleId;
  if (input.calendarTypeId !== undefined) updateValues.calendar_type_id = normalizeCalendarTypeId(input.calendarTypeId);
  if (input.tournamentTeamsPublished !== undefined) {
    updateValues.tournament_teams_published = input.tournamentTeamsPublished ? 1 : 0;
  }
  if (input.tournamentDrawPublished !== undefined) {
    updateValues.tournament_draw_published = input.tournamentDrawPublished ? 1 : 0;
  }
  if (input.tournamentFormat !== undefined) {
    const [row] = await db
      .select({ tournament_format: schema.events.tournament_format })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    const prev = normalizeTournamentFormat(row?.tournament_format as string | null);
    const next =
      input.tournamentFormat === null ? null : normalizeTournamentFormat(input.tournamentFormat as string);
    if (prev !== next) {
      const n = await countTournamentTeams(eventId);
      if (n > 0) {
        throw new EventServiceError('Remove all tournament teams before changing the tournament format', 409);
      }
    }
    updateValues.tournament_format = next;
  }
  if (input.pointOfContact !== undefined) {
    const pointOfContact = normalizePointOfContact(input.pointOfContact);
    if (!pointOfContact) {
      throw new EventServiceError('Point of contact is required', 400);
    }
    updateValues.point_of_contact = pointOfContact;
  }

  if (Object.keys(updateValues).length > 0) {
    await db.update(schema.events).set(updateValues).where(eq(schema.events.id, eventId));
  }

  if (input.timespans !== undefined) {
    await db.delete(schema.eventTimespans).where(eq(schema.eventTimespans.event_id, eventId));
    if (input.timespans.length > 0) {
      await db.insert(schema.eventTimespans).values(
        input.timespans.map((ts, i) => ({
          event_id: eventId,
          start_dt: ts.startDt,
          end_dt: ts.endDt,
          sort_order: ts.sortOrder ?? i,
        }))
      );
    }
  }

  if (input.locations !== undefined) {
    await db.delete(schema.eventLocations).where(eq(schema.eventLocations.event_id, eventId));
    if (input.locations.length > 0) {
      await db.insert(schema.eventLocations).values(
        input.locations.map((loc) => ({
          event_id: eventId,
          location_type: loc.locationType as any,
          sheet_id: loc.sheetId ?? null,
        }))
      );
    }
  }

  if (input.categoryIds !== undefined) {
    await db.delete(schema.eventCategoryAssignments).where(eq(schema.eventCategoryAssignments.event_id, eventId));
    if (input.categoryIds.length > 0) {
      await db.insert(schema.eventCategoryAssignments).values(
        input.categoryIds.map((catId) => ({
          event_id: eventId,
          category_id: catId,
        }))
      );
    }
  }

  if (input.ownerMemberIds !== undefined) {
    await db.delete(schema.eventOwners).where(eq(schema.eventOwners.event_id, eventId));
    if (input.ownerMemberIds.length > 0) {
      await db.insert(schema.eventOwners).values(
        input.ownerMemberIds.map((memberId) => ({
          event_id: eventId,
          member_id: memberId,
        }))
      );
    }
  }

  if (input.registrationFields !== undefined) {
    const existingFields = await db
      .select({ id: schema.eventRegistrationFields.id })
      .from(schema.eventRegistrationFields)
      .where(eq(schema.eventRegistrationFields.event_id, eventId));
    const existingIdSet = new Set(existingFields.map((field) => field.id));
    const keptIds = new Set(
      input.registrationFields
        .map((field) => field.id)
        .filter((id): id is number => typeof id === 'number' && existingIdSet.has(id))
    );

    const idsToDelete = [...existingIdSet].filter((id) => !keptIds.has(id));
    if (idsToDelete.length > 0) {
      await db
        .delete(schema.eventRegistrationFields)
        .where(and(eq(schema.eventRegistrationFields.event_id, eventId), inArray(schema.eventRegistrationFields.id, idsToDelete)));
    }

    assertNoDuplicatePresets(input.registrationFields);
    for (let i = 0; i < input.registrationFields.length; i += 1) {
      const field = input.registrationFields[i];
      const n = normalizeRegistrationFieldRow({
        label: field.label,
        fieldType: field.fieldType,
        scope: field.scope,
        required: field.required,
        options: field.options,
        sortOrder: field.sortOrder ?? i,
      });
      const nextValues = {
        label: n.label,
        field_type: n.fieldType as any,
        scope: n.scope as any,
        required: n.required ? 1 : 0,
        options: n.options,
        sort_order: n.sortOrder ?? i,
      };
      if (field.id && existingIdSet.has(field.id)) {
        await db
          .update(schema.eventRegistrationFields)
          .set(nextValues)
          .where(and(eq(schema.eventRegistrationFields.event_id, eventId), eq(schema.eventRegistrationFields.id, field.id)));
        continue;
      }
      await db.insert(schema.eventRegistrationFields).values({
        event_id: eventId,
        ...nextValues,
      });
    }
  }
}

export async function archiveEvent(eventId: number): Promise<void> {
  const event = await getEventById(eventId);
  if (!event) throw new EventServiceError('Event not found', 404);
  if (isArchivedAt(event.archived_at)) {
    throw new EventServiceError('Event is already archived', 409);
  }

  const { db, schema } = getDrizzleDb();
  const archivedAt = await getCurrentTimeAsync();
  await db
    .update(schema.events)
    .set({
      archived_at: archivedAt,
      published: 0,
      updated_at: sql`CURRENT_TIMESTAMP`,
    } as Record<string, unknown>)
    .where(eq(schema.events.id, eventId));
}

export async function restoreEvent(eventId: number): Promise<void> {
  const event = await getEventById(eventId);
  if (!event) throw new EventServiceError('Event not found', 404);
  if (!isArchivedAt(event.archived_at)) {
    throw new EventServiceError('Event is not archived', 409);
  }

  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.events)
    .set({
      archived_at: null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    } as Record<string, unknown>)
    .where(eq(schema.events.id, eventId));
}

export async function deleteEvent(eventId: number): Promise<void> {
  const event = await getEventById(eventId);
  if (!event) throw new EventServiceError('Event not found', 404);
  if (!isArchivedAt(event.archived_at)) {
    throw new EventServiceError('Event must be archived before it can be permanently deleted', 409);
  }

  const { db, schema } = getDrizzleDb();
  await db.delete(schema.events).where(eq(schema.events.id, eventId));
}

export async function getEventById(eventId: number) {
  const { db, schema } = getDrizzleDb();
  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId)).limit(1);
  if (!event) return null;
  return enrichEvent(event);
}

export async function getEventBySlug(slug: string, options?: { includeArchived?: boolean }) {
  const { db, schema } = getDrizzleDb();
  const conditions = [eq(schema.events.slug, slug)];
  if (!options?.includeArchived) {
    conditions.push(notArchivedCondition(schema.events.archived_at));
  }
  const [event] = await db.select().from(schema.events).where(and(...conditions)).limit(1);
  if (!event) return null;
  return enrichEvent(event);
}

async function enrichEvent(event: any) {
  const { db, schema } = getDrizzleDb();
  const eventId = event.id;

  const [timespans, locations, categoryAssignments, owners, fields] = await Promise.all([
    db.select().from(schema.eventTimespans).where(eq(schema.eventTimespans.event_id, eventId)).orderBy(asc(schema.eventTimespans.sort_order)),
    db.select().from(schema.eventLocations).where(eq(schema.eventLocations.event_id, eventId)),
    db.select().from(schema.eventCategoryAssignments).where(eq(schema.eventCategoryAssignments.event_id, eventId)),
    db.select().from(schema.eventOwners).where(eq(schema.eventOwners.event_id, eventId)),
    db.select().from(schema.eventRegistrationFields).where(eq(schema.eventRegistrationFields.event_id, eventId)).orderBy(asc(schema.eventRegistrationFields.sort_order)),
  ]);

  return {
    ...event,
    timespans,
    locations,
    categoryIds: categoryAssignments.map((ca: any) => ca.category_id),
    ownerMemberIds: owners.map((o: any) => o.member_id),
    registrationFields: fields,
  };
}

export async function listEvents(options: {
  publishedOnly?: boolean;
  visibility?: EventVisibility[];
  categorySlug?: string;
  fromDate?: string;
  toDate?: string;
  includeArchived?: boolean;
}) {
  const { db, schema } = getDrizzleDb();
  const conditions: any[] = [];

  if (!options.includeArchived) {
    conditions.push(notArchivedCondition(schema.events.archived_at));
  }

  if (options.publishedOnly) {
    conditions.push(eq(schema.events.published, 1));
  }
  if (options.visibility && options.visibility.length > 0) {
    conditions.push(inArray(schema.events.visibility, options.visibility));
  }

  let eventRows = await db
    .select()
    .from(schema.events)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.events.created_at));

  if (options.categorySlug) {
    const [cat] = await db
      .select({ id: schema.eventCategories.id })
      .from(schema.eventCategories)
      .where(eq(schema.eventCategories.slug, options.categorySlug))
      .limit(1);
    if (cat) {
      const assignments = await db
        .select({ event_id: schema.eventCategoryAssignments.event_id })
        .from(schema.eventCategoryAssignments)
        .where(eq(schema.eventCategoryAssignments.category_id, cat.id));
      const eventIds = new Set(assignments.map((a: any) => a.event_id));
      eventRows = eventRows.filter((e: any) => eventIds.has(e.id));
    } else {
      eventRows = [];
    }
  }

  if (options.fromDate || options.toDate) {
    const allTimespans = eventRows.length > 0
      ? await db
          .select()
          .from(schema.eventTimespans)
          .where(inArray(schema.eventTimespans.event_id, eventRows.map((e: any) => e.id)))
      : [];
    const timespansByEvent = new Map<number, any[]>();
    for (const ts of allTimespans) {
      const list = timespansByEvent.get(ts.event_id) || [];
      list.push(ts);
      timespansByEvent.set(ts.event_id, list);
    }

    eventRows = eventRows.filter((e: any) => {
      const spans = timespansByEvent.get(e.id) || [];
      if (spans.length === 0) return false;
      const earliestStart = spans.reduce((min: string, s: any) => s.start_dt < min ? s.start_dt : min, spans[0].start_dt);
      const latestEnd = spans.reduce((max: string, s: any) => s.end_dt > max ? s.end_dt : max, spans[0].end_dt);
      if (options.fromDate && latestEnd < options.fromDate) return false;
      if (options.toDate && earliestStart > options.toDate) return false;
      return true;
    });
  }

  const enrichedEvents = await Promise.all(eventRows.map(enrichEvent));
  return enrichedEvents;
}

/**
 * Distinct fiscal season start years (e.g. 2025 for "2025-26") where:
 * - At least one published public event has **fully ended** (latest timespan end &lt; now), and
 * - Some timespan of that event overlaps that season, and
 * - The season has already started (year ≤ current fiscal season start year), so e.g. 2026-27 is not listed while we are still in 2025-26.
 *
 * One indexed join, then group by event in memory (same cost order as counting timespans).
 */
export async function listPublicSeasonStartYearsWithEvents(): Promise<number[]> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const nowMs = now.getTime();

  const [govRow] = await db
    .select({ mmdd: schema.governanceSettings.fiscal_year_start_mmdd })
    .from(schema.governanceSettings)
    .where(eq(schema.governanceSettings.id, 1))
    .limit(1);

  const fiscal = parseFiscalYearStartMmdd(govRow?.mmdd);
  const currentSeasonStartYear = getSeasonStartYearForUtcDate(now, fiscal);

  const rows = await db
    .select({
      event_id: schema.eventTimespans.event_id,
      start_dt: schema.eventTimespans.start_dt,
      end_dt: schema.eventTimespans.end_dt,
    })
    .from(schema.eventTimespans)
    .innerJoin(schema.events, eq(schema.eventTimespans.event_id, schema.events.id))
    .where(
      and(
        eq(schema.events.published, 1),
        eq(schema.events.visibility, 'public'),
        notArchivedCondition(schema.events.archived_at),
      ),
    );

  const byEvent = new Map<number, Array<{ start_dt: string; end_dt: string }>>();
  for (const r of rows) {
    const list = byEvent.get(r.event_id) ?? [];
    list.push({ start_dt: r.start_dt, end_dt: r.end_dt });
    byEvent.set(r.event_id, list);
  }

  const years = new Set<number>();
  for (const spans of byEvent.values()) {
    if (spans.length === 0) continue;
    const latestEnd = spans.reduce((max, s) => (s.end_dt > max ? s.end_dt : max), spans[0].end_dt);
    if (new Date(latestEnd).getTime() >= nowMs) {
      continue;
    }

    for (const s of spans) {
      for (const y of seasonStartYearsTouchingRangeUtc(s.start_dt, s.end_dt, fiscal)) {
        if (y <= currentSeasonStartYear) {
          years.add(y);
        }
      }
    }
  }

  return Array.from(years).sort((a, b) => b - a);
}

export async function getConfirmedRegistrationCount(eventId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ group_size: schema.eventRegistrations.group_size })
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.event_id, eventId),
        eq(schema.eventRegistrations.status, 'confirmed' as any),
      ),
    );
  return rows.reduce((sum: number, r: any) => sum + (r.group_size || 1), 0);
}

export async function registerForEvent(input: RegisterForEventInput) {
  const { db, schema } = getDrizzleDb();

  const event = await getEventById(input.eventId);
  if (!event) throw new EventServiceError('Event not found', 404);
  if (isArchivedAt(event.archived_at)) {
    throw new EventServiceError('Event not found', 404);
  }
  if (!input.adminOverride && !event.published) throw new EventServiceError('Event is not published', 400);

  const nowMs = Date.now();
  let specialLink: any = null;

  if (input.specialLinkToken) {
    const [link] = await db
      .select()
      .from(schema.eventSpecialLinks)
      .where(
        and(
          eq(schema.eventSpecialLinks.event_id, input.eventId),
          eq(schema.eventSpecialLinks.token, input.specialLinkToken),
          eq(schema.eventSpecialLinks.used, 0),
          eq(schema.eventSpecialLinks.invalidated, 0)
        )
      )
      .limit(1);
    if (!link) throw new EventServiceError('Invalid or expired special link', 400);
    specialLink = link;
  }

  const ignoreDates = input.adminOverride || specialLink?.ignore_registration_dates === 1;
  if (!ignoreDates) {
    const startMs = eventTimeMs(event.registration_start);
    if (startMs != null && nowMs < startMs) {
      throw new EventServiceError('Registration has not opened yet', 400);
    }
    const cutoff = event.registration_cutoff || (event.timespans?.[0]?.start_dt);
    const cutoffMs = eventTimeMs(cutoff);
    if (cutoffMs != null && nowMs > cutoffMs) {
      throw new EventServiceError('Registration is closed', 400);
    }
  }

  const groupSize = input.groupMembers ? input.groupMembers.length + 1 : 1;
  if (groupSize > 1 && !event.allow_group_registration) {
    throw new EventServiceError('Group registration is not allowed for this event', 400);
  }
  const effectiveMaxGroupSize = specialLink?.max_group_size != null
    ? (event.max_group_size != null ? Math.min(event.max_group_size, specialLink.max_group_size) : specialLink.max_group_size)
    : event.max_group_size;
  if (effectiveMaxGroupSize && groupSize > effectiveMaxGroupSize) {
    throw new EventServiceError(`Maximum group size is ${effectiveMaxGroupSize}`, 400);
  }

  const { getRegistrationDemandCount } = await import('./eventWaitlistService.js');
  const { hasDirectRegistrationCapacity } = await import('./eventCapacityLogic.js');
  const registrationDemandCount = await getRegistrationDemandCount(input.eventId);
  const bypassCapacity = specialLink?.bypass_capacity === 1;
  const capacityAvailable = input.forceWaitlist
    ? false
    : bypassCapacity || hasDirectRegistrationCapacity(event.capacity, registrationDemandCount, groupSize);

  const effectiveFee = resolveEventRegistrationFeeMinor(event, {
    memberId: input.memberId,
    adminOverride: input.adminOverride,
    specialLinkOverrideMinor: specialLink?.override_fee_minor ?? null,
  });
  const totalFee = effectiveFee * groupSize;
  const needsPayment = totalFee > 0;

  let status: EventRegistrationStatus;
  if (input.forceWaitlist) {
    if (!event.enable_waitlist) {
      throw new EventServiceError('Waitlist is not enabled for this event', 400);
    }
    status = 'waitlisted';
  } else if (!capacityAvailable && event.enable_waitlist) {
    status = 'waitlisted';
  } else if (!capacityAvailable) {
    throw new EventServiceError('Event is full', 400);
  } else if (needsPayment) {
    status = 'pending_payment';
  } else {
    status = 'confirmed';
  }

  let waitlistPosition: number | null = null;
  if (status === 'waitlisted') {
    const lastWaitlisted = await db
      .select({ waitlist_position: schema.eventRegistrations.waitlist_position })
      .from(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.event_id, input.eventId),
          eq(schema.eventRegistrations.status, 'waitlisted')
        )
      )
      .orderBy(desc(schema.eventRegistrations.waitlist_position))
      .limit(1);
    waitlistPosition = (lastWaitlisted[0]?.waitlist_position ?? 0) + 1;
  }

  const accessToken = generateEventRegistrationAccessToken();

  const [registration] = await db
    .insert(schema.eventRegistrations)
    .values({
      event_id: input.eventId,
      member_id: input.memberId ?? null,
      contact_name: formatMemberDisplayName(input.contactFirstName, input.contactLastName),
      contact_email: input.contactEmail,
      status: status as any,
      group_size: groupSize,
      special_link_id: specialLink?.id ?? null,
      waitlist_position: waitlistPosition,
      access_token: accessToken,
    } as any)
    .returning({ id: schema.eventRegistrations.id, access_token: schema.eventRegistrations.access_token });

  const registrationId = registration.id;

  const insertedGroupMembers = input.groupMembers && input.groupMembers.length > 0
    ? await db.insert(schema.eventRegistrationMembers).values(
        input.groupMembers.map((m, i) => ({
          registration_id: registrationId,
          name: m.name,
          email: m.email ?? null,
          sort_order: i,
        }))
      ).returning({ id: schema.eventRegistrationMembers.id, sort_order: schema.eventRegistrationMembers.sort_order })
    : [];

  validateRegistrationFieldValues({
    fields: (event.registrationFields || []).map((f: any) => ({
      id: f.id,
      field_type: f.field_type,
      scope: f.scope,
      required: f.required,
      label: f.label,
    })),
    fieldValues: input.fieldValues ?? [],
    groupMemberCount: input.groupMembers?.length ?? 0,
  });

  const fieldValuesToInsert = input.fieldValues ?? [];
  if (fieldValuesToInsert.length > 0) {
    const memberIdByIndex = new Map<number, number>();
    for (const gm of insertedGroupMembers) {
      memberIdByIndex.set((gm.sort_order ?? 0) + 1, gm.id);
    }
    await db.insert(schema.eventRegistrationFieldValues).values(
      fieldValuesToInsert.map((fv) => ({
        registration_id: registrationId,
        field_id: fv.fieldId,
        registration_member_id:
          fv.registrationMemberId ??
          (fv.registrationMemberIndex != null
            ? (fv.registrationMemberIndex > 0 ? memberIdByIndex.get(fv.registrationMemberIndex) ?? null : null)
            : null),
        value: fv.value,
      }))
    );
  }

  if (specialLink) {
    await db
      .update(schema.eventSpecialLinks)
      .set({ used: 1, used_by_registration_id: registrationId })
      .where(eq(schema.eventSpecialLinks.id, specialLink.id));

    if (bypassCapacity && event.capacity !== null) {
      await db
        .update(schema.events)
        .set({ capacity: event.capacity + groupSize })
        .where(eq(schema.events.id, input.eventId));
    }
  }

  await syncTournamentTeamForRegistrationSafe(registrationId);

  return {
    registrationId,
    accessToken: registration.access_token ?? accessToken,
    status,
    totalFee,
    needsPayment,
    waitlistPosition,
  };
}

export type ConfirmRegistrationPaymentResult = {
  outcome: 'confirmed' | 'waitlisted_with_refund' | 'cancelled_with_refund' | 'already_processed' | 'skipped';
  registrationStatus: EventRegistrationStatus | null;
  refundIssued: boolean;
  waitlistPosition: number | null;
  waitlistLength: number | null;
};

export async function confirmRegistrationPayment(
  registrationId: number,
  paymentOrderId: number,
): Promise<ConfirmRegistrationPaymentResult> {
  const { db, schema } = getDrizzleDb();

  const [reg] = await db
    .select()
    .from(schema.eventRegistrations)
    .where(eq(schema.eventRegistrations.id, registrationId))
    .limit(1);
  if (!reg) {
    return {
      outcome: 'skipped',
      registrationStatus: null,
      refundIssued: false,
      waitlistPosition: null,
      waitlistLength: null,
    };
  }

  const event = await getEventById(reg.event_id);
  if (!event) {
    return {
      outcome: 'skipped',
      registrationStatus: reg.status as EventRegistrationStatus,
      refundIssued: false,
      waitlistPosition: reg.waitlist_position,
      waitlistLength: null,
    };
  }

  if (reg.status !== 'pending_payment') {
    const { getWaitlistLength } = await import('./eventWaitlistService.js');
    return {
      outcome: 'already_processed',
      registrationStatus: reg.status as EventRegistrationStatus,
      refundIssued: false,
      waitlistPosition: reg.waitlist_position,
      waitlistLength: reg.status === 'waitlisted' ? await getWaitlistLength(reg.event_id) : null,
    };
  }

  const groupSize = reg.group_size ?? 1;
  const { getRegistrationDemandCount, getWaitlistLength } = await import('./eventWaitlistService.js');
  const { hasDirectRegistrationCapacity } = await import('./eventCapacityLogic.js');
  const registrationDemandCount = await getRegistrationDemandCount(reg.event_id);

  let nextStatus: EventRegistrationStatus = 'confirmed';
  let waitlistPosition: number | null = null;
  let outcome: ConfirmRegistrationPaymentResult['outcome'] = 'confirmed';

  if (!hasDirectRegistrationCapacity(event.capacity, registrationDemandCount, groupSize)) {
    if (event.enable_waitlist) {
      nextStatus = 'waitlisted';
      outcome = 'waitlisted_with_refund';
      const lastWaitlisted = await db
        .select({ waitlist_position: schema.eventRegistrations.waitlist_position })
        .from(schema.eventRegistrations)
        .where(
          and(
            eq(schema.eventRegistrations.event_id, reg.event_id),
            eq(schema.eventRegistrations.status, 'waitlisted' as any),
          ),
        )
        .orderBy(desc(schema.eventRegistrations.waitlist_position))
        .limit(1);
      waitlistPosition = (lastWaitlisted[0]?.waitlist_position ?? 0) + 1;
    } else {
      nextStatus = 'cancelled';
      outcome = 'cancelled_with_refund';
    }
  }

  const updated = await db
    .update(schema.eventRegistrations)
    .set({
      status: nextStatus as any,
      payment_order_id: paymentOrderId,
      waitlist_position: waitlistPosition,
      cancelled_at: nextStatus === 'cancelled' ? (new Date() as any) : null,
    })
    .where(
      and(
        eq(schema.eventRegistrations.id, registrationId),
        eq(schema.eventRegistrations.status, 'pending_payment' as any),
      ),
    )
    .returning({ id: schema.eventRegistrations.id });

  if (updated.length === 0) {
    const [current] = await db
      .select({
        status: schema.eventRegistrations.status,
        waitlist_position: schema.eventRegistrations.waitlist_position,
      })
      .from(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.id, registrationId))
      .limit(1);
    return {
      outcome: 'already_processed',
      registrationStatus: (current?.status as EventRegistrationStatus) ?? null,
      refundIssued: false,
      waitlistPosition: current?.waitlist_position ?? null,
      waitlistLength: current?.status === 'waitlisted' ? await getWaitlistLength(reg.event_id) : null,
    };
  }

  await syncTournamentTeamForRegistrationSafe(registrationId);

  let refundIssued = false;
  if (outcome === 'waitlisted_with_refund' || outcome === 'cancelled_with_refund') {
    const { claimEventRegistrationRaceRefund, issueEventRegistrationRefund } = await import('./eventRegistrationRefundService.js');
    const { getDatabaseConfig } = await import('../db/config.js');
    const isPostgres = getDatabaseConfig()?.type === 'postgres';
    const metadataColumn = schema.paymentOrders.metadata;
    const claimed = await claimEventRegistrationRaceRefund(paymentOrderId);
    if (claimed) {
      const refundResult = await issueEventRegistrationRefund({
        paymentOrderId,
        reason: 'Event filled before payment completed',
        bypassEligibility: true,
      });
      refundIssued = refundResult.refundIssued;
    } else {
      const [order] = await db
        .select({ status: schema.paymentOrders.status })
        .from(schema.paymentOrders)
        .where(eq(schema.paymentOrders.id, paymentOrderId))
        .limit(1);
      refundIssued = order?.status === 'refunded' || order?.status === 'pending_refund';
    }

    const outcomeKey = outcome;
    await db
      .update(schema.paymentOrders)
      .set({
        metadata: isPostgres
          ? sql`(COALESCE(${metadataColumn}::jsonb, '{}'::jsonb) || jsonb_build_object('eventRegistrationPaymentOutcome', cast(${outcomeKey} as text)))::text`
          : sql`json_set(COALESCE(${metadataColumn}, '{}'), '$.eventRegistrationPaymentOutcome', ${outcomeKey})`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.paymentOrders.id, paymentOrderId));
  }

  const waitlistLength =
    nextStatus === 'waitlisted' ? await getWaitlistLength(reg.event_id) : null;

  if (
    outcome === 'confirmed' ||
    outcome === 'waitlisted_with_refund' ||
    outcome === 'cancelled_with_refund'
  ) {
    const { sendEventRegistrationCompletionEmailsForOrder } = await import('./paymentService.js');
    await sendEventRegistrationCompletionEmailsForOrder(paymentOrderId);
  }

  return {
    outcome,
    registrationStatus: nextStatus,
    refundIssued,
    waitlistPosition,
    waitlistLength,
  };
}

export async function cancelRegistration(registrationId: number): Promise<{ refundEligible: boolean; event: any }> {
  const { db, schema } = getDrizzleDb();

  const [reg] = await db
    .select()
    .from(schema.eventRegistrations)
    .where(eq(schema.eventRegistrations.id, registrationId))
    .limit(1);
  if (!reg) throw new EventServiceError('Registration not found', 404);
  if (reg.status === 'cancelled') throw new EventServiceError('Registration is already canceled', 400);

  const event = await getEventById(reg.event_id);
  if (!event) throw new EventServiceError('Event not found', 404);

  const cancelMs = eventTimeMs(event.cancellation_cutoff);
  const refundEligible = reg.status === 'confirmed' &&
    reg.payment_order_id !== null &&
    (cancelMs == null || Date.now() <= cancelMs);

  await db
    .update(schema.eventRegistrations)
    .set({ status: 'cancelled' as any, cancelled_at: new Date() as any })
    .where(eq(schema.eventRegistrations.id, registrationId));

  const { resolvePendingOfferForRegistration } = await import('./eventWaitlistService.js');
  if (reg.status === 'waitlisted') {
    await resolvePendingOfferForRegistration(registrationId, 'manager').catch(() => {});
  }

  await syncTournamentTeamForRegistrationSafe(registrationId);

  return { refundEligible, event };
}

export async function getRegistrationsForEvent(eventId: number) {
  const { db, schema } = getDrizzleDb();

  const registrations = await db
    .select()
    .from(schema.eventRegistrations)
    .where(eq(schema.eventRegistrations.event_id, eventId))
    .orderBy(asc(schema.eventRegistrations.created_at));

  const regIds = registrations.map((r: any) => r.id);
  if (regIds.length === 0) return [];

  const [members, fieldValues] = await Promise.all([
    db
      .select()
      .from(schema.eventRegistrationMembers)
      .where(inArray(schema.eventRegistrationMembers.registration_id, regIds)),
    db
      .select()
      .from(schema.eventRegistrationFieldValues)
      .where(inArray(schema.eventRegistrationFieldValues.registration_id, regIds)),
  ]);

  return registrations.map((reg: any) => ({
    ...reg,
    groupMembers: members.filter((m: any) => m.registration_id === reg.id),
    fieldValues: fieldValues.filter((fv: any) => fv.registration_id === reg.id),
  }));
}

export async function getRegistrationForEvent(eventId: number, registrationId: number) {
  const registrations = await getRegistrationsForEvent(eventId);
  return registrations.find((reg: any) => reg.id === registrationId) ?? null;
}

export interface UpsertEventRegistrationInput {
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  groupMembers?: Array<{ name: string; email?: string | null }>;
  fieldValues?: Array<{ fieldId: number; registrationMemberIndex?: number | null; value: string }>;
}

export async function updateRegistrationForEvent(
  eventId: number,
  registrationId: number,
  input: UpsertEventRegistrationInput
) {
  const { db, schema } = getDrizzleDb();
  const [existing] = await db
    .select()
    .from(schema.eventRegistrations)
    .where(and(eq(schema.eventRegistrations.id, registrationId), eq(schema.eventRegistrations.event_id, eventId)))
    .limit(1);
  if (!existing) throw new EventServiceError('Registration not found', 404);
  if (existing.status === 'cancelled') throw new EventServiceError('Canceled registrations cannot be edited', 400);

  const normalizedGroupMembers = (input.groupMembers ?? [])
    .map((m) => ({ name: m.name.trim(), email: m.email?.trim() || null }))
    .filter((m) => m.name.length > 0);
  const groupSize = normalizedGroupMembers.length + 1;
  const event = await getEventById(eventId);
  if (!event) throw new EventServiceError('Event not found', 404);
  if (groupSize > 1 && !event.allow_group_registration) {
    throw new EventServiceError('Group registration is not allowed for this event', 400);
  }
  if (event.max_group_size && groupSize > event.max_group_size) {
    throw new EventServiceError(`Maximum group size is ${event.max_group_size}`, 400);
  }

  await db
    .update(schema.eventRegistrations)
    .set({
      contact_name: formatMemberDisplayName(input.contactFirstName, input.contactLastName),
      contact_email: input.contactEmail.trim(),
      group_size: groupSize,
      updated_at: new Date() as any,
    } as any)
    .where(eq(schema.eventRegistrations.id, registrationId));

  await db.delete(schema.eventRegistrationMembers).where(eq(schema.eventRegistrationMembers.registration_id, registrationId));
  const insertedGroupMembers = normalizedGroupMembers.length > 0
    ? await db.insert(schema.eventRegistrationMembers).values(
        normalizedGroupMembers.map((m, i) => ({
          registration_id: registrationId,
          name: m.name,
          email: m.email,
          sort_order: i,
        }))
      ).returning({ id: schema.eventRegistrationMembers.id, sort_order: schema.eventRegistrationMembers.sort_order })
    : [];

  await db
    .delete(schema.eventRegistrationFieldValues)
    .where(eq(schema.eventRegistrationFieldValues.registration_id, registrationId));

  validateRegistrationFieldValues({
    fields: (event.registrationFields || []).map((f: any) => ({
      id: f.id,
      field_type: f.field_type,
      scope: f.scope,
      required: f.required,
      label: f.label,
    })),
    fieldValues: input.fieldValues ?? [],
    groupMemberCount: normalizedGroupMembers.length,
  });

  const fieldValuesToUpsert = input.fieldValues ?? [];
  if (fieldValuesToUpsert.length > 0) {
    const memberIdByIndex = new Map<number, number>();
    for (const gm of insertedGroupMembers) {
      memberIdByIndex.set((gm.sort_order ?? 0) + 1, gm.id);
    }
    await db.insert(schema.eventRegistrationFieldValues).values(
      fieldValuesToUpsert.map((fv) => ({
        registration_id: registrationId,
        field_id: fv.fieldId,
        registration_member_id:
          fv.registrationMemberIndex != null
            ? (fv.registrationMemberIndex > 0 ? memberIdByIndex.get(fv.registrationMemberIndex) ?? null : null)
            : null,
        value: fv.value,
      }))
    );
  }

  await syncTournamentTeamForRegistrationSafe(registrationId);

  return getRegistrationForEvent(eventId, registrationId);
}

export async function duplicateEvent(eventId: number, createdByMemberId: number): Promise<{ id: number; slug: string }> {
  const event = await getEventById(eventId);
  if (!event) throw new EventServiceError('Event not found', 404);

  const newTitle = `${event.title} (Copy)`;
  const newSlug = await ensureUniqueSlug(slugify(newTitle));

  let articleId: number | null = null;
  if (event.article_id != null) {
    articleId = await cloneEventArticleWithoutVersionHistory(
      event.article_id,
      newSlug,
      newTitle,
      createdByMemberId,
    );
  }

  const created = await createEvent({
    title: newTitle,
    slug: newSlug,
    calendarTypeId: normalizeCalendarTypeId(event.calendar_type_id),
    articleId,
    imageFileId: event.image_file_id,
    visibility: event.visibility,
    capacity: event.capacity,
    feeMinor: event.fee_minor,
    memberFeeMinor: event.member_fee_minor ?? null,
    currency: event.currency,
    allowGroupRegistration: event.allow_group_registration === 1,
    maxGroupSize: event.max_group_size,
    enableWaitlist: event.enable_waitlist === 1,
    termsArticleId: event.terms_article_id,
    tournamentTeamsPublished: false,
    tournamentDrawPublished: false,
    tournamentFormat: normalizeTournamentFormat(event.tournament_format as string | null) ?? null,
    pointOfContact: event.point_of_contact,
    createdByMemberId,
    timespans: (event.timespans || []).map((ts: any) => ({
      startDt: ts.start_dt,
      endDt: ts.end_dt,
      sortOrder: ts.sort_order,
    })),
    locations: (event.locations || []).map((loc: any) => ({
      locationType: loc.location_type,
      sheetId: loc.sheet_id,
    })),
    categoryIds: event.categoryIds || [],
    ownerMemberIds: event.ownerMemberIds || [],
    registrationFields: (event.registrationFields || []).map((f: any) => ({
      label: f.label,
      fieldType: f.field_type,
      scope: f.scope,
      required: f.required === 1,
      options: f.options,
      sortOrder: f.sort_order,
    })),
  });

  const drawJson = (event as { tournament_draw_json?: string | null }).tournament_draw_json;
  if (drawJson != null && drawJson !== '') {
    const { db, schema } = getDrizzleDb();
    await db
      .update(schema.events)
      .set({
        tournament_draw_json: sanitizeTournamentDrawJsonForDuplicate(drawJson),
        updated_at: sql`CURRENT_TIMESTAMP`,
      } as Record<string, unknown>)
      .where(eq(schema.events.id, created.id));
  }

  return created;
}

export async function createSpecialLink(
  eventId: number,
  input: {
    label?: string;
    overrideFeeminor?: number | null;
    maxGroupSize?: number | null;
    bypassCapacity?: boolean;
    ignoreRegistrationDates?: boolean;
  }
) {
  const { db, schema } = getDrizzleDb();

  const token = crypto.randomUUID();
  const [link] = await db
    .insert(schema.eventSpecialLinks)
    .values({
      event_id: eventId,
      token,
      label: input.label ?? null,
      override_fee_minor: input.overrideFeeminor ?? null,
      max_group_size: input.maxGroupSize ?? null,
      bypass_capacity: input.bypassCapacity ? 1 : 0,
      ignore_registration_dates: input.ignoreRegistrationDates ? 1 : 0,
    } as any)
    .returning();

  return link;
}

export async function invalidateSpecialLink(linkId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.eventSpecialLinks)
    .set({ invalidated: 1 })
    .where(eq(schema.eventSpecialLinks.id, linkId));
}

export async function getSpecialLinksForEvent(eventId: number) {
  const { db, schema } = getDrizzleDb();
  return db
    .select()
    .from(schema.eventSpecialLinks)
    .where(eq(schema.eventSpecialLinks.event_id, eventId))
    .orderBy(desc(schema.eventSpecialLinks.created_at));
}

export async function listCategories() {
  const { db, schema } = getDrizzleDb();
  return db.select().from(schema.eventCategories).orderBy(asc(schema.eventCategories.sort_order));
}

export async function createCategory(input: { name: string; slug?: string; description?: string; sortOrder?: number }) {
  const { db, schema } = getDrizzleDb();
  const slug = input.slug ? slugify(input.slug) : slugify(input.name);
  const [cat] = await db
    .insert(schema.eventCategories)
    .values({
      name: input.name,
      slug,
      description: input.description ?? null,
      sort_order: input.sortOrder ?? 0,
    } as any)
    .returning({ id: schema.eventCategories.id });
  return { id: cat.id, slug };
}

export async function updateCategory(categoryId: number, input: { name?: string; slug?: string; description?: string; sortOrder?: number }) {
  const { db, schema } = getDrizzleDb();
  const updateValues: Record<string, any> = {};
  if (input.name !== undefined) updateValues.name = input.name;
  if (input.slug !== undefined) updateValues.slug = slugify(input.slug);
  if (input.description !== undefined) updateValues.description = input.description;
  if (input.sortOrder !== undefined) updateValues.sort_order = input.sortOrder;
  if (Object.keys(updateValues).length > 0) {
    await db.update(schema.eventCategories).set(updateValues).where(eq(schema.eventCategories.id, categoryId));
  }
}

export async function deleteCategory(categoryId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db.delete(schema.eventCategories).where(eq(schema.eventCategories.id, categoryId));
}

export async function getEventTimespansForCalendar(startDt: string, endDt: string, visibilityFilter?: EventVisibility[]) {
  const { db, schema } = getDrizzleDb();

  const eventConditions: any[] = [
    eq(schema.events.published, 1),
    notArchivedCondition(schema.events.archived_at),
  ];
  if (visibilityFilter && visibilityFilter.length > 0) {
    eventConditions.push(inArray(schema.events.visibility, visibilityFilter));
  }

  const events = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      slug: schema.events.slug,
      visibility: schema.events.visibility,
      calendar_type_id: schema.events.calendar_type_id,
    })
    .from(schema.events)
    .where(and(...eventConditions));

  if (events.length === 0) return [];

  const eventIds = events.map((e: any) => e.id);

  const timespans = await db
    .select()
    .from(schema.eventTimespans)
    .where(
      and(
        inArray(schema.eventTimespans.event_id, eventIds),
        lte(schema.eventTimespans.start_dt, endDt),
        gte(schema.eventTimespans.end_dt, startDt)
      )
    );

  const locations = await db
    .select()
    .from(schema.eventLocations)
    .where(inArray(schema.eventLocations.event_id, eventIds));

  const eventMap = new Map(events.map((e: any) => [e.id, e]));
  const locationsByEvent = new Map<number, any[]>();
  for (const loc of locations) {
    const list = locationsByEvent.get(loc.event_id) || [];
    list.push({
      type: loc.location_type,
      ...(loc.location_type === 'sheet' && loc.sheet_id ? { sheetId: loc.sheet_id } : {}),
    });
    locationsByEvent.set(loc.event_id, list);
  }

  return timespans.map((ts: any) => {
    const event = eventMap.get(ts.event_id)!;
    return {
      id: `event:${ts.event_id}:${ts.id}`,
      typeId: normalizeCalendarTypeId(event.calendar_type_id),
      title: event.title,
      start: ts.start_dt,
      end: ts.end_dt,
      allDay: false,
      source: 'events',
      slug: event.slug,
      locations: locationsByEvent.get(ts.event_id) || [],
    };
  });
}

export async function isEventOwner(eventId: number, memberId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ id: schema.eventOwners.id })
    .from(schema.eventOwners)
    .where(and(eq(schema.eventOwners.event_id, eventId), eq(schema.eventOwners.member_id, memberId)))
    .limit(1);
  return !!row;
}

export function isBeforeCancellationCutoff(
  event: { cancellation_cutoff?: string | Date | null },
  nowMs: number = Date.now(),
): boolean {
  const cancelMs = eventTimeMs(event.cancellation_cutoff ?? null);
  return cancelMs == null || nowMs <= cancelMs;
}

export async function ensureRegistrationAccessToken(registrationId: number): Promise<string> {
  const { db, schema } = getDrizzleDb();
  const [reg] = await db
    .select({ access_token: schema.eventRegistrations.access_token })
    .from(schema.eventRegistrations)
    .where(eq(schema.eventRegistrations.id, registrationId))
    .limit(1);
  if (!reg) throw new EventServiceError('Registration not found', 404);
  if (reg.access_token) return reg.access_token;

  const accessToken = generateEventRegistrationAccessToken();
  await db
    .update(schema.eventRegistrations)
    .set({ access_token: accessToken, updated_at: new Date() as any })
    .where(eq(schema.eventRegistrations.id, registrationId));
  return accessToken;
}

export async function getRegistrationByAccessToken(accessToken: string) {
  const { db, schema } = getDrizzleDb();
  const normalized = accessToken.trim();
  if (!normalized) return null;

  const [reg] = await db
    .select()
    .from(schema.eventRegistrations)
    .where(eq(schema.eventRegistrations.access_token, normalized))
    .limit(1);
  if (!reg) return null;

  const full = await getRegistrationForEvent(reg.event_id, reg.id);
  return full;
}

export async function getRegistrationById(registrationId: number) {
  const { db, schema } = getDrizzleDb();
  const [reg] = await db
    .select()
    .from(schema.eventRegistrations)
    .where(eq(schema.eventRegistrations.id, registrationId))
    .limit(1);
  return reg ?? null;
}

export async function getSpecialLinkByToken(token: string) {
  const { db, schema } = getDrizzleDb();
  const [link] = await db
    .select()
    .from(schema.eventSpecialLinks)
    .where(eq(schema.eventSpecialLinks.token, token))
    .limit(1);
  return link ?? null;
}

function defaultEventRegistrationItemName(title: string): string {
  return `Event registration — ${title}`;
}

export async function listUpcomingEventsForPaymentItemNames() {
  const today = new Date().toISOString().slice(0, 10);
  const events = await listEvents({ fromDate: today });
  return events.map((event: any) => ({
    id: event.id,
    title: event.title,
    slug: event.slug,
    paymentItemName: event.payment_item_name ?? null,
    timespans: (event.timespans ?? []).map((ts: any) => ({
      startDt: ts.start_dt,
      endDt: ts.end_dt,
    })),
    defaultItemName: defaultEventRegistrationItemName(event.title),
  }));
}

export async function updateEventPaymentItemName(eventId: number, paymentItemName: string | null): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [existing] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!existing) {
    throw new EventServiceError('Event not found', 404);
  }

  const trimmed = paymentItemName?.trim() ?? '';
  const normalized = trimmed.length > 0 ? trimmed.slice(0, 512) : null;
  await db
    .update(schema.events)
    .set({ payment_item_name: normalized })
    .where(eq(schema.events.id, eventId));
}
