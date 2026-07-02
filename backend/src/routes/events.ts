import { FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { isEventsAdmin } from '../utils/auth.js';
import { memberIsSocialMember, memberIsSpareOnly } from '../utils/memberMembershipHelpers.js';
import { createPaymentService, PaymentServiceError, buildCheckoutSuccessUrl, getDefaultPaymentProvider } from '../services/paymentService.js';
import { issueEventRegistrationRefund } from '../services/eventRegistrationRefundService.js';
import { resolveFrontendBaseUrl, normalizeFrontendBaseUrl } from '../utils/frontendUrl.js';
import { formatMemberDisplayName, splitMemberDisplayName } from '../utils/memberName.js';
import { eventRegistrationManageUrl } from '../utils/eventRegistrationManageUrl.js';
import { paymentDetailsUrl } from '../utils/paymentDetailsUrl.js';
import { formatEventTimespansForDisplay } from '../utils/formatEventTimespans.js';
import {
  sendEventRegistrationConfirmationEmail,
  sendEventRegistrationCancelledEmail,
  sendEventOwnerNewRegistrationEmail,
  type EventRegistrationEmailLinks,
} from '../services/email.js';
import {
  buildRegistrationFormSnapshotFromInput,
  buildRegistrationFormSnapshotFromRegistration,
  diffRegistrationFormSnapshots,
  notifyPointOfContactOfNewRegistration,
  notifyPointOfContactOfRegistrationCancellation,
  notifyPointOfContactOfRegistrationUpdate,
  shouldNotifyPointOfContactAtRegistration,
} from '../services/eventRegistrationPointOfContactNotification.js';
import {
  createEvent,
  updateEvent,
  deleteEvent,
  getEventById,
  getEventBySlug,
  listEvents,
  listPublicSeasonStartYearsWithEvents,
  registerForEvent,
  cancelRegistration,
  getRegistrationsForEvent,
  getConfirmedRegistrationCount,
  duplicateEvent,
  createSpecialLink,
  invalidateSpecialLink,
  getSpecialLinksForEvent,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  isEventOwner,
  getRegistrationById,
  getSpecialLinkByToken,
  getRegistrationForEvent,
  updateRegistrationForEvent,
  ensureRegistrationAccessToken,
  getRegistrationByAccessToken,
  isBeforeCancellationCutoff,
  EventServiceError,
  normalizeCalendarTypeId,
  resolveEventRegistrationFeeMinor,
  confirmRegistrationPayment,
} from '../services/eventService.js';
import {
  EventWaitlistServiceError,
  acceptWaitlistOfferByToken,
  addManualWaitlistEntry,
  declineWaitlistOfferByToken,
  forceDeclineWaitlistOffer,
  getOpenSpots,
  getPublicWaitlistOffer,
  getWaitlistLength,
  getWaitlistedCount,
  listEventWaitlist,
  promoteWaitlistRegistration,
  removeFromEventWaitlist,
  reorderEventWaitlist,
  resolveWaitlistOfferPaymentByToken,
} from '../services/eventWaitlistService.js';
import {
  createTournamentTeam,
  deleteTournamentTeam,
  listTournamentTeamsForEvent,
  normalizeTournamentFormat,
  updateTournamentTeam,
  type RosterSlotPayload,
  type TournamentTeamRow,
} from '../services/eventTournamentTeamsService.js';
import { tournamentDrawStateSchema, tournamentGameResultSchema } from '../services/eventTournamentDrawSchema.js';
import {
  getTournamentDrawForEvent,
  saveTournamentDrawForEvent,
  coerceTournamentDrawIncomingSlots,
  validateTournamentDrawSemantics,
  patchTournamentDrawGameResult,
} from '../services/eventTournamentDrawService.js';
import {
  broadcastTournamentDrawUpdated,
  subscribeTournamentDrawLive,
} from '../services/tournamentDrawPublicLive.js';
import { PassThrough } from 'node:stream';

const patchTournamentGameResultBodySchema = z.object({
  result: tournamentGameResultSchema.nullable(),
});
import { optionalAuthMiddleware } from '../middleware/auth.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { sendApiError, sendValidationError } from '../api/errors.js';
import { eq } from 'drizzle-orm';
import type { Member } from '../types.js';
import { getRegistrationPaymentSummary } from '../domains/payments/queries/paymentSummaries.js';

interface AuthenticatedRequest extends FastifyRequest {
  member?: Member;
}

/** Event row or aggregate used by list/detail helpers (mixed snake_case + joined arrays). */
interface EventFormattingSource {
  id: number;
  title: string;
  slug: string;
  article_id: number | null;
  image_file_id: number | null;
  visibility: string;
  calendar_type_id: string | null;
  published: number;
  capacity: number | null;
  fee_minor: number;
  member_fee_minor: number | null;
  currency: string;
  registration_start: string | null;
  registration_cutoff: string | null;
  cancellation_cutoff: string | null;
  allow_group_registration: number;
  max_group_size: number | null;
  enable_waitlist: number;
  terms_article_id: number | null;
  payment_item_name?: string | null;
  point_of_contact: string;
  tournament_teams_published?: number;
  tournament_draw_published?: number;
  tournament_format?: string | null;
  created_by_member_id: number | null;
  created_at: string;
  updated_at: string;
  timespans?: unknown[];
  locations?: unknown[];
  categoryIds?: number[];
  ownerMemberIds?: number[];
  registrationFields?: unknown[];
}

const locationSchema = z.union([
  z.object({ locationType: z.literal('sheet'), sheetId: z.number() }),
  z.object({ locationType: z.enum(['warm-room', 'exterior', 'offsite', 'virtual']) }),
]);

const timespanSchema = z.object({
  startDt: z.string().min(1),
  endDt: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

const registrationFieldTypeSchema = z.enum([
  'text',
  'number',
  'checkbox',
  'dropdown',
  'radio',
  'subheading',
  'preset_phone',
  'preset_address',
  'preset_team_name',
  'preset_team_four',
  'preset_team_doubles',
  'preset_dob',
]);

const registrationFieldSchema = z.object({
  id: z.number().int().optional(),
  label: z.string().min(1).max(200),
  fieldType: registrationFieldTypeSchema,
  scope: z.enum(['group', 'individual']).optional(),
  required: z.boolean().optional(),
  options: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const eventPointOfContactSchema = z.string().trim().min(1).email().max(320);

const createEventSchema = z.object({
  title: z.string().min(1).max(300),
  slug: z.string().max(200).optional(),
  articleId: z.number().int().nullable().optional(),
  imageFileId: z.number().int().nullable().optional(),
  visibility: z.enum(['public', 'active_members', 'ice_members']).optional(),
  capacity: z.number().int().positive().nullable().optional(),
  feeMinor: z.number().int().min(0).optional(),
  memberFeeMinor: z.number().int().min(0).nullable().optional(),
  currency: z.string().max(3).optional(),
  registrationStart: z.string().nullable().optional(),
  registrationCutoff: z.string().nullable().optional(),
  cancellationCutoff: z.string().nullable().optional(),
  allowGroupRegistration: z.boolean().optional(),
  maxGroupSize: z.number().int().positive().nullable().optional(),
  enableWaitlist: z.boolean().optional(),
  termsArticleId: z.number().int().nullable().optional(),
  calendarTypeId: z.enum(['bonspiel', 'learn-to-curl', 'juniors', 'other']).optional(),
  tournamentTeamsPublished: z.boolean().optional(),
  tournamentDrawPublished: z.boolean().optional(),
  tournamentFormat: z.enum(['fours', 'doubles']).nullable().optional(),
  pointOfContact: eventPointOfContactSchema,
  timespans: z.array(timespanSchema).min(1),
  locations: z.array(locationSchema).optional(),
  categoryIds: z.array(z.number().int()).optional(),
  ownerMemberIds: z.array(z.number().int()).optional(),
  registrationFields: z.array(registrationFieldSchema).optional(),
});

const updateEventSchema = createEventSchema.partial().extend({
  published: z.boolean().optional(),
  timespans: z.array(timespanSchema).optional(),
  pointOfContact: eventPointOfContactSchema.optional(),
});

const registrationContactSchema = z.object({
  contactFirstName: z.string().trim().min(1).max(100),
  contactLastName: z.string().trim().min(1).max(100),
  contactEmail: z.string().email().max(320),
});

const registerSchema = registrationContactSchema.extend({
  groupMembers: z.array(z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(320).optional(),
  })).optional(),
  fieldValues: z.array(z.object({
    fieldId: z.number().int(),
    registrationMemberId: z.number().int().nullable().optional(),
    registrationMemberIndex: z.number().int().min(0).nullable().optional(),
    value: z.string().max(50000),
  })).optional(),
  specialLinkToken: z.string().max(200).nullable().optional(),
});

const adminRegistrationFieldValueSchema = z.object({
  fieldId: z.number().int().positive(),
  registrationMemberIndex: z.number().int().min(0).nullable().optional(),
  value: z.string().max(2000),
});

const adminUpsertRegistrationSchema = registrationContactSchema.extend({
  groupMembers: z.array(z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(320).optional().nullable(),
  })).optional(),
  fieldValues: z.array(adminRegistrationFieldValueSchema).optional(),
});

const adminCancelRegistrationSchema = z.object({
  refund: z.boolean().optional(),
});

const waitlistReorderSchema = z.object({
  registrationIds: z.array(z.number().int().positive()).min(1),
});

const waitlistPromoteSchema = z.object({
  respondByDays: z.number().int().min(1).max(30).optional(),
});

const waitlistAddSchema = adminUpsertRegistrationSchema.extend({
  memberId: z.number().int().positive().optional().nullable(),
});

function handleEventWaitlistError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof EventWaitlistServiceError) {
    if (error.details) {
      return !!sendValidationError(reply, error.message, error.details);
    }
    if (error.code) {
      return !!sendApiError(reply, error.statusCode, error.message, { code: error.code });
    }
    return !!sendApiError(reply, error.statusCode, error.message);
  }
  return false;
}

const createSpecialLinkSchema = z.object({
  label: z.string().max(200).optional(),
  overrideFeeminor: z.number().int().min(0).nullable().optional(),
  maxGroupSize: z.number().int().min(1).nullable().optional(),
  bypassCapacity: z.boolean().optional(),
  ignoreRegistrationDates: z.boolean().optional(),
});

const categorySchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
});

const tournamentRosterSlotSchema = z.object({
  slotCode: z.string().min(1).max(32),
  playerName: z.string().max(200).nullable().optional(),
  email: z.union([z.literal(''), z.string().email().max(320)]).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  homeClub: z.string().max(200).nullable().optional(),
});

const createTournamentTeamBodySchema = z.object({
  teamName: z.string().max(200).nullable().optional(),
  homeClub: z.string().max(200).nullable().optional(),
  viceSlotCode: z.string().min(1).max(32).optional(),
  skipSlotCode: z.string().min(1).max(32).optional(),
  roster: z.array(tournamentRosterSlotSchema).optional(),
});

const updateTournamentTeamBodySchema = createTournamentTeamBodySchema.partial();

function canonicalFrontendBaseUrl(): string {
  return normalizeFrontendBaseUrl(config.frontendUrl);
}

function buildSpecialLinkRegistrationUrl(
  eventSlug: string | null | undefined,
  eventId: number,
  token: string,
  baseUrl: string = canonicalFrontendBaseUrl(),
): string {
  const slugSegment = eventSlug?.trim() || String(eventId);
  return `${baseUrl}/events/${encodeURIComponent(slugSegment)}/register?slk=${encodeURIComponent(token)}`;
}

function formatSpecialLinkRow(
  link: {
    id: number;
    token: string;
    label: string | null;
    override_fee_minor: number | null;
    max_group_size: number | null;
    bypass_capacity: number;
    ignore_registration_dates: number;
    used: number;
    invalidated: number;
    created_at: string | Date;
  },
  eventSlug: string | null | undefined,
  eventId: number,
) {
  return {
    ...link,
    created_at: link.created_at instanceof Date ? link.created_at.toISOString() : link.created_at,
    registrationUrl: buildSpecialLinkRegistrationUrl(eventSlug, eventId, link.token),
  };
}

function canManageEvent(member: Member, eventId?: number): Promise<boolean> | boolean {
  if (isEventsAdmin(member)) return true;
  if (eventId && member.id) return isEventOwner(eventId, member.id);
  return false;
}

const REGISTRATION_RECEIPT_ORDER_STATUSES = new Set([
  'succeeded',
  'partially_refunded',
  'refunded',
  'pending_refund',
]);

async function resolveRegistrationReceiptUrl(paymentOrderId: number | null | undefined): Promise<string | null> {
  if (!paymentOrderId) return null;

  const { db, schema } = getDrizzleDb();
  const [order] = await db
    .select({
      order_token: schema.paymentOrders.order_token,
      status: schema.paymentOrders.status,
    })
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.id, paymentOrderId))
    .limit(1);

  if (order && REGISTRATION_RECEIPT_ORDER_STATUSES.has(order.status)) {
    return paymentDetailsUrl(order.order_token);
  }
  return null;
}

async function notifyRegistrationCancelledByEmail(
  registration: { contact_email: string; contact_name: string; payment_order_id?: number | null },
  eventTitle: string,
  refundIssued: boolean,
  pointOfContact: string,
  isWaitlistEntry = false,
): Promise<void> {
  const refundReceiptUrl = isWaitlistEntry
    ? null
    : await resolveRegistrationReceiptUrl(registration.payment_order_id ?? null);
  await sendEventRegistrationCancelledEmail(
    registration.contact_email,
    registration.contact_name,
    eventTitle,
    refundIssued,
    undefined,
    { refundReceiptUrl, pointOfContact, isWaitlistEntry },
  );
}

async function buildRegistrationEmailLinks(
  registrationId: number,
  accessToken?: string | null,
): Promise<EventRegistrationEmailLinks> {
  const token = accessToken ?? await ensureRegistrationAccessToken(registrationId);
  const manageRegistrationUrl = eventRegistrationManageUrl(token);

  const reg = await getRegistrationById(registrationId);
  const receiptUrl = reg?.payment_order_id
    ? await resolveRegistrationReceiptUrl(reg.payment_order_id)
    : null;

  return { manageRegistrationUrl, receiptUrl };
}

async function sendRegistrationConfirmationEmailForResult(
  registrationId: number,
  accessToken: string | null | undefined,
  contactEmail: string,
  contactFirstName: string,
  contactLastName: string,
  event: EventFormattingSource,
  status: 'confirmed' | 'pending_payment' | 'waitlisted',
  groupSize: number,
): Promise<void> {
  const links = await buildRegistrationEmailLinks(registrationId, accessToken);
  const eventWhen = formatEventTimespansForDisplay(event.timespans as Array<{ start_dt: string; end_dt: string; sort_order?: number }>);
  await sendEventRegistrationConfirmationEmail(
    contactEmail,
    formatMemberDisplayName(contactFirstName, contactLastName),
    event.title,
    eventWhen,
    status,
    groupSize,
    undefined,
    { ...links, pointOfContact: event.point_of_contact },
  );
}

function formatManageRegistrationFieldValues(registration: {
  groupMembers?: Array<{ id?: number; sort_order?: number }>;
  fieldValues?: Array<{ field_id: number; registration_member_id: number | null; value: string | null }>;
}): Array<{ fieldId: number; registrationMemberIndex: number | null; value: string }> {
  const sortedMembers = [...(registration.groupMembers ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const memberIndexById = new Map<number, number>();
  sortedMembers.forEach((member, idx) => {
    if (member.id != null) memberIndexById.set(member.id, idx + 1);
  });

  return (registration.fieldValues ?? []).map((fieldValue) => ({
    fieldId: fieldValue.field_id,
    registrationMemberIndex:
      fieldValue.registration_member_id == null
        ? null
        : (memberIndexById.get(fieldValue.registration_member_id) ?? null),
    value: fieldValue.value ?? '',
  }));
}

async function formatManageRegistrationResponse(accessToken: string) {
  const registration = await getRegistrationByAccessToken(accessToken);
  if (!registration) return null;

  const event = await getEventById(registration.event_id);
  if (!event) return null;

  const nowMs = Date.now();
  const isWaitlisted = registration.status === 'waitlisted';
  const canCancel =
    registration.status !== 'cancelled' &&
    (isWaitlisted || isBeforeCancellationCutoff(event, nowMs));
  const cancellationCutoffPassed =
    registration.status !== 'cancelled' &&
    !isWaitlisted &&
    !isBeforeCancellationCutoff(event, nowMs);

  const { firstName, lastName } = splitMemberDisplayName(registration.contact_name ?? '');
  const sortedMembers = [...(registration.groupMembers ?? [])].sort(
    (a: { sort_order?: number }, b: { sort_order?: number }) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );

  const waitlistLength =
    registration.status === 'waitlisted' ? await getWaitlistLength(registration.event_id) : null;

  const isWaitlistEntry =
    registration.status === 'waitlisted' ||
    (registration.status === 'cancelled' && registration.waitlist_position != null);

  let receiptUrl: string | null = null;
  if (!isWaitlistEntry && registration.payment_order_id) {
    receiptUrl = await resolveRegistrationReceiptUrl(registration.payment_order_id);
  }

  return {
    event: {
      id: event.id,
      title: event.title,
      slug: event.slug,
      allowGroupRegistration: event.allow_group_registration,
      maxGroupSize: event.max_group_size,
      registrationFields: event.registrationFields ?? [],
      cancellationCutoff: event.cancellation_cutoff,
      pointOfContact: event.point_of_contact,
    },
    registration: {
      id: registration.id,
      status: registration.status,
      contactFirstName: firstName,
      contactLastName: lastName,
      contactEmail: registration.contact_email,
      groupMembers: sortedMembers.map((m: { name: string; email?: string | null }) => ({
        name: m.name,
        email: m.email ?? '',
      })),
      fieldValues: formatManageRegistrationFieldValues(registration),
      waitlistPosition: registration.waitlist_position,
      waitlistLength,
    },
    receiptUrl,
    isWaitlistEntry,
    canCancel,
    cancellationCutoffPassed,
    serverNow: new Date(nowMs).toISOString(),
  };
}

/**
 * Same access as GET `/public/events/:slug/tournament-draw` (public bonspiel with published draw,
 * or valid `slk` special link).
 */
async function getPublicPublishedTournamentDrawEventId(
  slug: string,
  slk: string | undefined,
): Promise<number | null> {
  const event = await getEventBySlug(slug);
  if (!event) return null;

  let hasValidSpecialLink = false;
  if (slk) {
    const link = await getSpecialLinkByToken(slk);
    if (link && link.event_id === event.id && !link.used && !link.invalidated) {
      hasValidSpecialLink = true;
    }
  }

  if (!hasValidSpecialLink && (!event.published || event.visibility !== 'public')) {
    return null;
  }

  if (normalizeCalendarTypeId(event.calendar_type_id) !== 'bonspiel') {
    return null;
  }

  if (event.tournament_draw_published !== 1) {
    return null;
  }

  return event.id;
}

// Public routes (no auth required)
export async function publicEventRoutes(fastify: FastifyInstance): Promise<void> {
  // List published public events
  fastify.get('/public/events', { schema: { tags: ['events'] } }, async (request) => {
    const query = request.query as { category?: string; from?: string; to?: string };
    const events = await listEvents({
      publishedOnly: true,
      visibility: ['public'],
      categorySlug: query.category,
      fromDate: query.from,
      toDate: query.to,
    });
    return events.map(summarizeEvent);
  });

  /** Season start years (e.g. 2025 for 2025-26) that have ≥1 published public event in that season. */
  fastify.get('/public/events/seasons', { schema: { tags: ['events'] } }, async () => {
    const seasonStartYears = await listPublicSeasonStartYearsWithEvents();
    return { seasonStartYears };
  });

  // Get public event by slug
  fastify.get<{ Params: { slug: string }; Querystring: { slk?: string } }>(
    '/public/events/:slug',
    { preHandler: optionalAuthMiddleware, schema: { tags: ['events'] } },
    async (request, reply) => {
      const event = await getEventBySlug(request.params.slug);
      if (!event) {
        return sendApiError(reply, 404, 'Event not found');
      }

      const slk = (request.query as { slk?: string }).slk;
      let hasValidSpecialLink = false;
      let specialLinkOverrideMinor: number | null | undefined;
      if (slk) {
        const link = await getSpecialLinkByToken(slk);
        if (link && link.event_id === event.id && !link.used && !link.invalidated) {
          hasValidSpecialLink = true;
          specialLinkOverrideMinor = link.override_fee_minor;
        }
      }

      if (!hasValidSpecialLink && (!event.published || event.visibility !== 'public')) {
        return sendApiError(reply, 404, 'Event not found');
      }

      const confirmedCount = await getConfirmedRegistrationCount(event.id);
      const [waitlistedCount, openSpots] = await Promise.all([
        getWaitlistedCount(event.id),
        getOpenSpots(event.id, event.capacity),
      ]);
      const member = (request as { member?: Member }).member;
      const yourFeeMinor =
        member != null
          ? resolveEventRegistrationFeeMinor(event, {
              memberId: member.id,
              adminOverride: false,
              specialLinkOverrideMinor:
                hasValidSpecialLink && specialLinkOverrideMinor !== null && specialLinkOverrideMinor !== undefined
                  ? specialLinkOverrideMinor
                  : null,
            })
          : null;

      return {
        ...formatEventResponse(event),
        confirmedCount,
        waitlistedCount,
        openSpots,
        yourFeeMinor,
        serverNow: new Date().toISOString(),
      };
    }
  );

  fastify.get<{ Params: { slug: string }; Querystring: { slk?: string } }>(
    '/public/events/:slug/tournament-teams',
    { preHandler: optionalAuthMiddleware, schema: { tags: ['events'] } },
    async (request, reply) => {
      const event = await getEventBySlug(request.params.slug);
      if (!event) {
        return sendApiError(reply, 404, 'Event not found');
      }

      const slk = (request.query as { slk?: string }).slk;
      let hasValidSpecialLink = false;
      if (slk) {
        const link = await getSpecialLinkByToken(slk);
        if (link && link.event_id === event.id && !link.used && !link.invalidated) {
          hasValidSpecialLink = true;
        }
      }

      if (!hasValidSpecialLink && (!event.published || event.visibility !== 'public')) {
        return sendApiError(reply, 404, 'Event not found');
      }

      if (normalizeCalendarTypeId(event.calendar_type_id) !== 'bonspiel') {
        return sendApiError(reply, 404, 'Event not found');
      }

      if (event.tournament_teams_published !== 1) {
        return sendApiError(reply, 404, 'Event not found');
      }

      try {
        const teams = await listTournamentTeamsForEvent(event.id);
        return {
          tournamentFormat: normalizeTournamentFormat(event.tournament_format as string | null),
          teams: teams.map(formatPublicTournamentTeamResponse),
        };
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  fastify.get<{ Params: { slug: string }; Querystring: { slk?: string } }>(
    '/public/events/:slug/tournament-draw',
    { preHandler: optionalAuthMiddleware, schema: { tags: ['events'] } },
    async (request, reply) => {
      const slk = (request.query as { slk?: string }).slk;
      const eventId = await getPublicPublishedTournamentDrawEventId(request.params.slug, slk);
      if (eventId == null) {
        return sendApiError(reply, 404, 'Event not found');
      }

      try {
        const draw = await getTournamentDrawForEvent(eventId);
        return { draw };
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  fastify.get<{ Params: { slug: string }; Querystring: { slk?: string } }>(
    '/public/events/:slug/tournament-draw/stream',
    {
      preHandler: optionalAuthMiddleware,
      schema: {
        tags: ['events'],
        hide: true,
        description:
          'Server-Sent Events stream: emits tournament_draw_updated when the draw changes; clients should refetch GET /public/events/:slug/tournament-draw.',
      },
    },
    async (request, reply) => {
      const slk = (request.query as { slk?: string }).slk;
      const eventId = await getPublicPublishedTournamentDrawEventId(request.params.slug, slk);
      if (eventId == null) {
        return sendApiError(reply, 404, 'Event not found');
      }

      const stream = new PassThrough();
      reply
        .header('Content-Type', 'text/event-stream; charset=utf-8')
        .header('Cache-Control', 'no-cache, no-transform')
        .header('Connection', 'keep-alive')
        .header('X-Accel-Buffering', 'no');

      const send = (chunk: string) => {
        if (!stream.writableEnded) {
          stream.write(chunk);
        }
      };

      const unsubscribe = subscribeTournamentDrawLive(eventId, send);

      const payload = JSON.stringify({ type: 'connected', eventId });
      send(`data: ${payload}\n\n`);

      const pingTimer = setInterval(() => {
        send(': ping\n\n');
      }, 30000);

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearInterval(pingTimer);
        unsubscribe();
        if (!stream.writableEnded) {
          stream.end();
        }
      };

      request.raw.on('close', cleanup);
      stream.on('close', cleanup);

      return reply.send(stream);
    }
  );

  // Get public event categories
  fastify.get('/public/events/categories', { schema: { tags: ['events'] } }, async () => {
    return listCategories();
  });

  // Public registration for a public event
  fastify.post<{ Params: { slug: string }; Body: unknown }>(
    '/public/events/:slug/register',
    { preHandler: optionalAuthMiddleware, schema: { tags: ['events'] } },
    async (request, reply) => {
      const event = await getEventBySlug(request.params.slug);
      if (!event) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      const body = request.body as { specialLinkToken?: string };
      let hasValidSpecialLink = false;
      if (body?.specialLinkToken) {
        const link = await getSpecialLinkByToken(body.specialLinkToken);
        if (link && link.event_id === event.id && !link.used && !link.invalidated) {
          hasValidSpecialLink = true;
        }
      }

      if (!hasValidSpecialLink && (!event.published || event.visibility !== 'public')) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid registration data', parsed.error.flatten());
      }

      const regMember = (request as { member?: Member }).member;

      try {
        const result = await registerForEvent({
          eventId: event.id,
          memberId: regMember?.id ?? null,
          ...parsed.data,
        });

        schedulePointOfContactNewRegistrationNotification(
          request.log,
          event,
          result.registrationId,
          result.status,
          result.needsPayment,
        );

        if (result.needsPayment && result.status !== 'waitlisted') {
          return createCheckoutForRegistration(
            event,
            result,
            parsed.data.contactEmail,
            regMember?.id ?? null,
            resolveFrontendBaseUrl(request)
          );
        }

        sendRegistrationConfirmationEmailForResult(
          result.registrationId,
          result.accessToken,
          parsed.data.contactEmail,
          parsed.data.contactFirstName,
          parsed.data.contactLastName,
          event,
          result.status,
          parsed.data.groupMembers ? parsed.data.groupMembers.length + 1 : 1,
        ).catch((err) => request.log.error({ err }, 'Failed to send registration email'));

        notifyEventOwners(
          event,
          formatMemberDisplayName(parsed.data.contactFirstName, parsed.data.contactLastName),
          parsed.data.contactEmail,
          parsed.data.groupMembers ? parsed.data.groupMembers.length + 1 : 1,
          result.status,
        )
          .catch((err) => request.log.error({ err }, 'Failed to notify event owners'));

        return {
          registrationId: result.registrationId,
          status: result.status,
          waitlistPosition: result.waitlistPosition,
        };
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  // Validate a special link token
  fastify.get<{ Params: { slug: string; token: string } }>(
    '/public/events/:slug/special-link/:token',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const event = await getEventBySlug(request.params.slug);
      if (!event) return sendApiError(reply, 404, 'Event not found');

      const link = await getSpecialLinkByToken(request.params.token);
      if (!link || link.event_id !== event.id) {
        return sendApiError(reply, 404, 'Invalid or expired link');
      }

      if (link.used) {
        return { valid: false, reason: 'used' };
      }
      if (link.invalidated) {
        return { valid: false, reason: 'invalidated' };
      }

      return {
        valid: true,
        overrideFeeminor: link.override_fee_minor,
        maxGroupSize: link.max_group_size ?? null,
        bypassCapacity: link.bypass_capacity === 1,
        ignoreRegistrationDates: link.ignore_registration_dates === 1,
      };
    }
  );

  // Self-service registration management (access token auth)
  fastify.get<{ Params: { accessToken: string } }>(
    '/public/events/registrations/manage/:accessToken',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const payload = await formatManageRegistrationResponse(request.params.accessToken);
      if (!payload) return sendApiError(reply, 404, 'Registration not found');
      return payload;
    }
  );

  fastify.patch<{ Params: { accessToken: string }; Body: unknown }>(
    '/public/events/registrations/manage/:accessToken',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const registration = await getRegistrationByAccessToken(request.params.accessToken);
      if (!registration) return sendApiError(reply, 404, 'Registration not found');

      const event = await getEventById(registration.event_id);
      if (!event) return sendApiError(reply, 404, 'Event not found');

      const parsed = adminUpsertRegistrationSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid registration data', parsed.error.flatten());
      }

      const beforeSnapshot = buildRegistrationFormSnapshotFromRegistration(event, registration);

      try {
        await updateRegistrationForEvent(registration.event_id, registration.id, {
          contactFirstName: parsed.data.contactFirstName,
          contactLastName: parsed.data.contactLastName,
          contactEmail: parsed.data.contactEmail,
          groupMembers: parsed.data.groupMembers?.map((m) => ({
            name: m.name,
            email: m.email ?? undefined,
          })),
          fieldValues: parsed.data.fieldValues?.map((fv) => ({
            fieldId: fv.fieldId,
            registrationMemberIndex: fv.registrationMemberIndex ?? null,
            value: fv.value,
          })),
        });
        const afterSnapshot = buildRegistrationFormSnapshotFromInput(event, {
          contactFirstName: parsed.data.contactFirstName,
          contactLastName: parsed.data.contactLastName,
          contactEmail: parsed.data.contactEmail,
          groupMembers: parsed.data.groupMembers?.map((m) => ({
            name: m.name,
            email: m.email ?? undefined,
          })),
          fieldValues: parsed.data.fieldValues?.map((fv) => ({
            fieldId: fv.fieldId,
            registrationMemberIndex: fv.registrationMemberIndex ?? null,
            value: fv.value,
          })),
        });
        const changes = diffRegistrationFormSnapshots(beforeSnapshot, afterSnapshot);
        notifyPointOfContactOfRegistrationUpdate({ event, registration, changes }).catch((err) =>
          request.log.error({ err }, 'Failed to notify event point of contact'),
        );
        const payload = await formatManageRegistrationResponse(request.params.accessToken);
        if (!payload) return sendApiError(reply, 404, 'Registration not found');
        return payload;
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  fastify.post<{ Params: { accessToken: string } }>(
    '/public/events/registrations/manage/:accessToken/cancel',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const registration = await getRegistrationByAccessToken(request.params.accessToken);
      if (!registration) return sendApiError(reply, 404, 'Registration not found');
      if (registration.status === 'cancelled') {
        return sendApiError(reply, 400, 'Registration is already canceled');
      }

      const event = await getEventById(registration.event_id);
      if (!event) return sendApiError(reply, 404, 'Event not found');

      if (registration.status !== 'waitlisted' && !isBeforeCancellationCutoff(event)) {
        return sendApiError(
          reply,
          403,
          `Cancellation is no longer available. Contact ${event.point_of_contact} for help.`,
        );
      }

      try {
        notifyPointOfContactOfRegistrationCancellation({ event, registration }).catch((err) =>
          request.log.error({ err }, 'Failed to notify event point of contact'),
        );

        const wasWaitlisted = registration.status === 'waitlisted';
        const { refundEligible, event: canceledEvent } = await cancelRegistration(registration.id);

        let refundIssued = false;
        let refundError: string | null = null;
        if (!wasWaitlisted && refundEligible && registration.payment_order_id) {
          const refundResult = await issueEventRegistrationRefund({
            paymentOrderId: registration.payment_order_id,
            reason: 'Event registration canceled by registrant',
            requestedByMemberId: registration.member_id ?? null,
          });
          refundIssued = refundResult.refundIssued;
          refundError = refundResult.refundError;
          if (refundError) {
            request.log.error({ refundError }, 'Failed to create refund for event registration cancellation');
          }
        }

        notifyRegistrationCancelledByEmail(
          registration,
          canceledEvent.title,
          refundIssued,
          canceledEvent.point_of_contact,
          wasWaitlisted,
        ).catch((err) => request.log.error({ err }, 'Failed to send cancellation email'));

        return { success: true, refundIssued, refundError };
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  // Registration checkout success/resolve
  fastify.post<{ Params: { registrationId: string }; Body: unknown }>(
    '/public/events/registrations/:registrationId/resolve',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const registrationId = parseInt(request.params.registrationId, 10);
      if (isNaN(registrationId)) return reply.code(400).send({ error: 'Invalid registration id' });

      const body = request.body as { sessionId?: string | null };
      const sessionId = body?.sessionId?.trim() || null;

      const reg = await getRegistrationById(registrationId);
      if (!reg || !reg.payment_order_id) return reply.code(404).send({ error: 'Registration not found' });

      const { db, schema } = getDrizzleDb();
      const [order] = await db
        .select()
        .from(schema.paymentOrders)
        .where(eq(schema.paymentOrders.id, reg.payment_order_id))
        .limit(1);
      if (!order) return reply.code(404).send({ error: 'Payment order not found' });

      const paymentService = createPaymentService();
      try {
        if (sessionId) {
          await paymentService.reconcilePaymentOrderByToken(order.order_token, sessionId, 'checkout-return');
        } else {
          await paymentService.reconcilePaymentOrder(reg.payment_order_id, 'checkout-return');
        }

        const [updatedOrder] = await db
          .select({ status: schema.paymentOrders.status })
          .from(schema.paymentOrders)
          .where(eq(schema.paymentOrders.id, reg.payment_order_id))
          .limit(1);

        const updatedReg = await getRegistrationById(registrationId);

        let confirmResult: Awaited<ReturnType<typeof confirmRegistrationPayment>> | null = null;
        if (updatedOrder?.status === 'succeeded' && updatedReg?.status === 'pending_payment') {
          confirmResult = await confirmRegistrationPayment(registrationId, reg.payment_order_id);
        } else if (
          updatedReg?.payment_order_id &&
          (updatedReg.status === 'confirmed' ||
            updatedReg.status === 'waitlisted' ||
            updatedReg.status === 'cancelled')
        ) {
          const { sendEventRegistrationCompletionEmailsForOrder } = await import('../services/paymentService.js');
          sendEventRegistrationCompletionEmailsForOrder(updatedReg.payment_order_id).catch((err) =>
            request.log.error({ err }, 'Failed to send registration completion emails'),
          );
        }

        const finalReg = confirmResult ? await getRegistrationById(registrationId) : updatedReg;
        const waitlistLength =
          finalReg?.status === 'waitlisted' && finalReg.event_id
            ? await getWaitlistLength(finalReg.event_id)
            : null;

        return {
          status: updatedOrder?.status ?? 'unknown',
          registrationStatus: finalReg?.status ?? null,
          registrationId,
          refundIssued: confirmResult?.refundIssued ?? false,
          waitlistPosition: finalReg?.waitlist_position ?? confirmResult?.waitlistPosition ?? null,
          waitlistLength: confirmResult?.waitlistLength ?? waitlistLength,
        };
      } catch (err) {
        if (err instanceof PaymentServiceError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  fastify.get<{ Params: { responseToken: string } }>(
    '/public/events/waitlist-offers/:responseToken',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      try {
        return await getPublicWaitlistOffer(request.params.responseToken);
      } catch (err) {
        if (handleEventWaitlistError(reply, err)) return;
        throw err;
      }
    },
  );

  fastify.post<{ Params: { responseToken: string }; Body: unknown }>(
    '/public/events/waitlist-offers/:responseToken/resolve',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const body = request.body as { sessionId?: string | null };
      const sessionId = body?.sessionId?.trim() || null;

      try {
        return await resolveWaitlistOfferPaymentByToken(request.params.responseToken, sessionId);
      } catch (err) {
        if (err instanceof PaymentServiceError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        if (handleEventWaitlistError(reply, err)) return;
        throw err;
      }
    },
  );

  fastify.post<{ Params: { responseToken: string } }>(
    '/public/events/waitlist-offers/:responseToken/accept',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      try {
        return await acceptWaitlistOfferByToken(
          request.params.responseToken,
          resolveFrontendBaseUrl(request),
        );
      } catch (err) {
        if (handleEventWaitlistError(reply, err)) return;
        throw err;
      }
    },
  );

  fastify.post<{ Params: { responseToken: string } }>(
    '/public/events/waitlist-offers/:responseToken/decline',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      try {
        await declineWaitlistOfferByToken(request.params.responseToken);
        return { success: true };
      } catch (err) {
        if (handleEventWaitlistError(reply, err)) return;
        throw err;
      }
    },
  );
}

// Protected routes (auth required)
export async function protectedEventRoutes(fastify: FastifyInstance): Promise<void> {
  // List events visible to authenticated member
  fastify.get('/events', { schema: { tags: ['events'] } }, async (request) => {
    const member = (request as AuthenticatedRequest).member as Member;
    const query = request.query as { category?: string; from?: string; to?: string };

    const visibilityFilter: Array<'public' | 'active_members' | 'ice_members'> = ['public', 'active_members'];
    if (!memberIsSpareOnly(member) && !memberIsSocialMember(member)) {
      visibilityFilter.push('ice_members');
    }

    const events = await listEvents({
      publishedOnly: !isEventsAdmin(member),
      visibility: isEventsAdmin(member) ? undefined : visibilityFilter,
      categorySlug: query.category,
      fromDate: query.from,
      toDate: query.to,
    });
    return events.map(summarizeEvent);
  });

  // Get event by id (admin)
  fastify.get<{ Params: { id: string } }>(
    '/events/:id',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: 'Invalid event id' });

      const event = await getEventById(eventId);
      if (!event) return reply.code(404).send({ error: 'Event not found' });

      const member = (request as AuthenticatedRequest).member as Member;
      if (!event.published && !(await canManageEvent(member, eventId))) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      const confirmedCount = await getConfirmedRegistrationCount(eventId);
      return { ...formatEventResponse(event), confirmedCount };
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/events/:id/tournament-teams',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      try {
        const teams = await listTournamentTeamsForEvent(eventId);
        return { teams: teams.map(formatTournamentTeamResponse) };
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/events/:id/tournament-teams',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsed = createTournamentTeamBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid team data', parsed.error.flatten());
      }

      try {
        const team = await createTournamentTeam(eventId, {
          teamName: parsed.data.teamName,
          homeClub: parsed.data.homeClub,
          viceSlotCode: parsed.data.viceSlotCode,
          skipSlotCode: parsed.data.skipSlotCode,
          roster: parsed.data.roster as RosterSlotPayload[] | undefined,
        });
        return reply.code(201).send(formatTournamentTeamResponse(team));
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  fastify.patch<{ Params: { id: string; teamId: string }; Body: unknown }>(
    '/events/:id/tournament-teams/:teamId',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      const teamId = parseInt(request.params.teamId, 10);
      if (isNaN(eventId) || isNaN(teamId)) return sendApiError(reply, 400, 'Invalid id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsed = updateTournamentTeamBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid team data', parsed.error.flatten());
      }

      try {
        const team = await updateTournamentTeam(eventId, teamId, {
          ...parsed.data,
          roster: parsed.data.roster as RosterSlotPayload[] | undefined,
        });
        return formatTournamentTeamResponse(team);
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  fastify.delete<{ Params: { id: string; teamId: string } }>(
    '/events/:id/tournament-teams/:teamId',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      const teamId = parseInt(request.params.teamId, 10);
      if (isNaN(eventId) || isNaN(teamId)) return sendApiError(reply, 400, 'Invalid id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      try {
        await deleteTournamentTeam(eventId, teamId);
        return { success: true };
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/events/:id/tournament-draw',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      try {
        const draw = await getTournamentDrawForEvent(eventId);
        return { draw };
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  fastify.put<{ Params: { id: string }; Body: unknown }>(
    '/events/:id/tournament-draw',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsed = tournamentDrawStateSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid tournament draw', parsed.error.flatten());
      }

      try {
        const coerced = coerceTournamentDrawIncomingSlots(parsed.data);
        validateTournamentDrawSemantics(coerced);
        await saveTournamentDrawForEvent(eventId, coerced);
        broadcastTournamentDrawUpdated(eventId);
        return { draw: coerced };
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  fastify.patch<{ Params: { id: string; gameId: string }; Body: unknown }>(
    '/events/:id/tournament-draw/games/:gameId/result',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsedBody = patchTournamentGameResultBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return sendValidationError(reply, 'Invalid body', parsedBody.error.flatten());
      }

      const gameId = request.params.gameId?.trim() ?? '';
      if (!gameId) return sendApiError(reply, 400, 'Invalid game id');

      try {
        const draw = await patchTournamentDrawGameResult(eventId, gameId, parsedBody.data.result);
        broadcastTournamentDrawUpdated(eventId);
        return { draw };
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    },
  );

  // Get event by slug (authenticated)
  fastify.get<{ Params: { slug: string } }>(
    '/events/by-slug/:slug',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const event = await getEventBySlug(request.params.slug);
      if (!event) return reply.code(404).send({ error: 'Event not found' });

      const member = (request as AuthenticatedRequest).member as Member;
      if (!event.published && !(await canManageEvent(member, event.id))) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      const confirmedCount = await getConfirmedRegistrationCount(event.id);
      return { ...formatEventResponse(event), confirmedCount };
    }
  );

  // Create event (events manager or server admin)
  fastify.post<{ Body: unknown }>(
    '/events',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member as Member;
      if (!isEventsAdmin(member)) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsed = createEventSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid event data', parsed.error.flatten());
      }

      try {
        const result = await createEvent({
          ...parsed.data,
          locations: parsed.data.locations?.map((l) => ({
            locationType: 'locationType' in l ? l.locationType : 'sheet',
            sheetId: 'sheetId' in l ? l.sheetId : null,
          })),
          createdByMemberId: member.id,
        });
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  // Update event
  fastify.patch<{ Params: { id: string }; Body: unknown }>(
    '/events/:id',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsed = updateEventSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid event data', parsed.error.flatten());
      }

      try {
        await updateEvent(eventId, {
          ...parsed.data,
          locations: parsed.data.locations?.map((l) => ({
            locationType: 'locationType' in l ? l.locationType : 'sheet',
            sheetId: 'sheetId' in l ? l.sheetId : null,
          })),
        });
        const updated = await getEventById(eventId);
        return formatEventResponse(updated!);
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  // Delete event
  fastify.delete<{ Params: { id: string } }>(
    '/events/:id',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      await deleteEvent(eventId);
      return { success: true };
    }
  );

  // Duplicate event
  fastify.post<{ Params: { id: string } }>(
    '/events/:id/duplicate',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!isEventsAdmin(member)) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      try {
        const result = await duplicateEvent(eventId, member.id);
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  // Register for event (authenticated)
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/events/:id/register',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      const event = await getEventById(eventId);
      if (!event || !event.published) {
        return sendApiError(reply, 404, 'Event not found');
      }

      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid registration data', parsed.error.flatten());
      }

      try {
        const result = await registerForEvent({
          eventId,
          memberId: member.id,
          ...parsed.data,
        });

        schedulePointOfContactNewRegistrationNotification(
          request.log,
          event,
          result.registrationId,
          result.status,
          result.needsPayment,
        );

        if (result.needsPayment && result.status !== 'waitlisted') {
          return createCheckoutForRegistration(
            event,
            result,
            parsed.data.contactEmail,
            member.id,
            resolveFrontendBaseUrl(request)
          );
        }

        sendRegistrationConfirmationEmailForResult(
          result.registrationId,
          result.accessToken,
          parsed.data.contactEmail,
          parsed.data.contactFirstName,
          parsed.data.contactLastName,
          event,
          result.status,
          parsed.data.groupMembers ? parsed.data.groupMembers.length + 1 : 1,
        ).catch((err) => request.log.error({ err }, 'Failed to send registration email'));

        notifyEventOwners(
          event,
          formatMemberDisplayName(parsed.data.contactFirstName, parsed.data.contactLastName),
          parsed.data.contactEmail,
          parsed.data.groupMembers ? parsed.data.groupMembers.length + 1 : 1,
          result.status,
        )
          .catch((err) => request.log.error({ err }, 'Failed to notify event owners'));

        return {
          registrationId: result.registrationId,
          status: result.status,
          waitlistPosition: result.waitlistPosition,
        };
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  // Cancel own registration
  fastify.post<{ Params: { registrationId: string } }>(
    '/events/registrations/:registrationId/cancel',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const registrationId = parseInt(request.params.registrationId, 10);
      if (isNaN(registrationId)) return sendApiError(reply, 400, 'Invalid registration id');

      const member = (request as AuthenticatedRequest).member as Member;
      const reg = await getRegistrationById(registrationId);
      if (!reg) return sendApiError(reply, 404, 'Registration not found');

      const isOwnerOrAdmin = reg.member_id === member.id || isEventsAdmin(member) || (await isEventOwner(reg.event_id, member.id));
      if (!isOwnerOrAdmin) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      try {
        const wasWaitlisted = reg.status === 'waitlisted';
        const { refundEligible, event } = await cancelRegistration(registrationId);

        let refundIssued = false;
        let refundError: string | null = null;
        if (!wasWaitlisted && refundEligible && reg.payment_order_id) {
          const refundResult = await issueEventRegistrationRefund({
            paymentOrderId: reg.payment_order_id,
            reason: 'Event registration canceled',
            requestedByMemberId: member.id,
          });
          refundIssued = refundResult.refundIssued;
          refundError = refundResult.refundError;
          if (refundError) {
            request.log.error({ refundError }, 'Failed to create refund for event registration cancellation');
          }
        }

        notifyRegistrationCancelledByEmail(reg, event.title, refundIssued, event.point_of_contact, wasWaitlisted)
          .catch((err) => request.log.error({ err }, 'Failed to send cancellation email'));

        return { success: true, refundIssued, refundError };
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  // Get registrations for an event (admin/owner)
  fastify.get<{ Params: { id: string } }>(
    '/events/:id/registrations',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      return getRegistrationsForEvent(eventId);
    }
  );

  // Get a single registration for an event (admin/owner)
  fastify.get<{ Params: { id: string; registrationId: string } }>(
    '/events/:id/registrations/:registrationId',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      const registrationId = parseInt(request.params.registrationId, 10);
      if (isNaN(eventId) || isNaN(registrationId)) return sendApiError(reply, 400, 'Invalid id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const registration = await getRegistrationForEvent(eventId, registrationId);
      if (!registration) {
        return sendApiError(reply, 404, 'Registration not found');
      }
      const payment = await getRegistrationPaymentSummary(registration.payment_order_id ?? null);
      return { ...registration, payment };
    }
  );

  // Admin create registration (bypasses payment)
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/events/:id/registrations',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsed = adminUpsertRegistrationSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid registration data', parsed.error.flatten());
      }

      const event = await getEventById(eventId);
      if (!event) return sendApiError(reply, 404, 'Event not found');

      try {
        const result = await registerForEvent({
          eventId,
          memberId: null,
          contactFirstName: parsed.data.contactFirstName,
          contactLastName: parsed.data.contactLastName,
          contactEmail: parsed.data.contactEmail,
          groupMembers: parsed.data.groupMembers?.map((m) => ({ name: m.name, email: m.email ?? undefined })),
          fieldValues: parsed.data.fieldValues?.map((fv) => ({
            fieldId: fv.fieldId,
            registrationMemberIndex: fv.registrationMemberIndex ?? null,
            value: fv.value,
          })),
          adminOverride: true,
        });

        schedulePointOfContactNewRegistrationNotification(
          request.log,
          event,
          result.registrationId,
          result.status,
          result.needsPayment,
        );

        sendRegistrationConfirmationEmailForResult(
          result.registrationId,
          result.accessToken,
          parsed.data.contactEmail,
          parsed.data.contactFirstName,
          parsed.data.contactLastName,
          event,
          result.status,
          parsed.data.groupMembers ? parsed.data.groupMembers.length + 1 : 1,
        ).catch((err) => request.log.error({ err }, 'Failed to send registration email'));

        notifyEventOwners(
          event,
          formatMemberDisplayName(parsed.data.contactFirstName, parsed.data.contactLastName),
          parsed.data.contactEmail,
          parsed.data.groupMembers ? parsed.data.groupMembers.length + 1 : 1,
          result.status,
        )
          .catch((err) => request.log.error({ err }, 'Failed to notify event owners'));

        return reply.code(201).send({
          registrationId: result.registrationId,
          status: result.status,
          waitlistPosition: result.waitlistPosition,
        });
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  // Admin update registration
  fastify.patch<{ Params: { id: string; registrationId: string }; Body: unknown }>(
    '/events/:id/registrations/:registrationId',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      const registrationId = parseInt(request.params.registrationId, 10);
      if (isNaN(eventId) || isNaN(registrationId)) return sendApiError(reply, 400, 'Invalid id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsed = adminUpsertRegistrationSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid registration data', parsed.error.flatten());
      }

      try {
        const updated = await updateRegistrationForEvent(eventId, registrationId, {
          contactFirstName: parsed.data.contactFirstName,
          contactLastName: parsed.data.contactLastName,
          contactEmail: parsed.data.contactEmail,
          groupMembers: parsed.data.groupMembers,
          fieldValues: parsed.data.fieldValues,
        });
        return updated;
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  // Admin cancel registration (optional refund)
  fastify.post<{ Params: { id: string; registrationId: string }; Body: unknown }>(
    '/events/:id/registrations/:registrationId/cancel',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      const registrationId = parseInt(request.params.registrationId, 10);
      if (isNaN(eventId) || isNaN(registrationId)) return sendApiError(reply, 400, 'Invalid id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsed = adminCancelRegistrationSchema.safeParse(request.body ?? {});
      if (!parsed.success) return sendValidationError(reply, 'Invalid request body', parsed.error.flatten());
      const shouldRefund = parsed.data.refund === true;

      const reg = await getRegistrationById(registrationId);
      if (!reg || reg.event_id !== eventId) return sendApiError(reply, 404, 'Registration not found');

      try {
        const wasWaitlisted = reg.status === 'waitlisted';
        const { event } = await cancelRegistration(registrationId);

        let refundIssued = false;
        let refundStatus: string | null = null;
        let refundError: string | null = null;
        if (shouldRefund && !wasWaitlisted && reg.payment_order_id) {
          const refundResult = await issueEventRegistrationRefund({
            paymentOrderId: reg.payment_order_id,
            reason: 'Event registration canceled by admin',
            requestedByMemberId: member.id,
            surfaceIneligibleError: true,
          });
          refundIssued = refundResult.refundIssued;
          refundStatus = refundResult.refundStatus;
          refundError = refundResult.refundError;
          if (refundError) {
            request.log.error({ refundError }, 'Failed to create refund for event registration cancellation');
          }
        }

        notifyRegistrationCancelledByEmail(reg, event.title, refundIssued, event.point_of_contact, wasWaitlisted)
          .catch((err) => request.log.error({ err }, 'Failed to send cancellation email'));

        return { success: true, refundIssued, refundStatus, refundError };
      } catch (err) {
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    }
  );

  // Special links CRUD
  fastify.get<{ Params: { id: string } }>(
    '/events/:id/special-links',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const event = await getEventById(eventId);
      if (!event) return sendApiError(reply, 404, 'Event not found');

      const links = await getSpecialLinksForEvent(eventId);
      return links.map((link) => formatSpecialLinkRow(link, event.slug, eventId));
    }
  );

  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/events/:id/special-links',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsed = createSpecialLinkSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, 'Invalid data', parsed.error.flatten());
      }

      const result = await createSpecialLink(eventId, parsed.data);
      const event = await getEventById(eventId);
      return reply.code(201).send(formatSpecialLinkRow({ ...result, created_at: result.created_at }, event?.slug, eventId));
    }
  );

  fastify.delete<{ Params: { id: string; linkId: string } }>(
    '/events/:id/special-links/:linkId',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      const linkId = parseInt(request.params.linkId, 10);
      if (isNaN(eventId) || isNaN(linkId)) return sendApiError(reply, 400, 'Invalid id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      await invalidateSpecialLink(linkId);
      return { success: true };
    }
  );

  // Category management
  fastify.get('/events/categories', { schema: { tags: ['events'] } }, async () => listCategories());

  fastify.post<{ Body: unknown }>(
    '/events/categories',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const member = (request as AuthenticatedRequest).member as Member;
      if (!isEventsAdmin(member)) return sendApiError(reply, 403, 'Forbidden');

      const parsed = categorySchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid data', parsed.error.flatten());

      const result = await createCategory(parsed.data);
      return reply.code(201).send(result);
    }
  );

  fastify.patch<{ Params: { categoryId: string }; Body: unknown }>(
    '/events/categories/:categoryId',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const categoryId = parseInt(request.params.categoryId, 10);
      if (isNaN(categoryId)) return sendApiError(reply, 400, 'Invalid category id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!isEventsAdmin(member)) return sendApiError(reply, 403, 'Forbidden');

      const parsed = categorySchema.partial().safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid data', parsed.error.flatten());

      await updateCategory(categoryId, parsed.data);
      return { success: true };
    }
  );

  fastify.delete<{ Params: { categoryId: string } }>(
    '/events/categories/:categoryId',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const categoryId = parseInt(request.params.categoryId, 10);
      if (isNaN(categoryId)) return sendApiError(reply, 400, 'Invalid category id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!isEventsAdmin(member)) return sendApiError(reply, 403, 'Forbidden');

      await deleteCategory(categoryId);
      return { success: true };
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/events/:id/waitlist',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      try {
        return await listEventWaitlist(eventId);
      } catch (err) {
        if (handleEventWaitlistError(reply, err)) return;
        throw err;
      }
    },
  );

  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/events/:id/waitlist/reorder',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsed = waitlistReorderSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid request body', parsed.error.flatten());

      try {
        await reorderEventWaitlist(eventId, parsed.data.registrationIds);
        return { success: true };
      } catch (err) {
        if (handleEventWaitlistError(reply, err)) return;
        throw err;
      }
    },
  );

  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/events/:id/waitlist',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      if (isNaN(eventId)) return sendApiError(reply, 400, 'Invalid event id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsed = waitlistAddSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, 'Invalid registration data', parsed.error.flatten());

      try {
        const result = await addManualWaitlistEntry({
          eventId,
          memberId: parsed.data.memberId ?? null,
          contactFirstName: parsed.data.contactFirstName,
          contactLastName: parsed.data.contactLastName,
          contactEmail: parsed.data.contactEmail,
          groupMembers: parsed.data.groupMembers?.map((m) => ({
            name: m.name,
            email: m.email ?? undefined,
          })),
          fieldValues: parsed.data.fieldValues?.map((fv) => ({
            fieldId: fv.fieldId,
            registrationMemberIndex: fv.registrationMemberIndex ?? null,
            value: fv.value,
          })),
        });
        return reply.code(201).send(result);
      } catch (err) {
        if (handleEventWaitlistError(reply, err)) return;
        if (err instanceof EventServiceError) {
          return sendApiError(reply, err.statusCode, err.message);
        }
        throw err;
      }
    },
  );

  fastify.delete<{ Params: { id: string; registrationId: string } }>(
    '/events/:id/waitlist/:registrationId',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      const registrationId = parseInt(request.params.registrationId, 10);
      if (isNaN(eventId) || isNaN(registrationId)) return sendApiError(reply, 400, 'Invalid id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      try {
        await removeFromEventWaitlist(eventId, registrationId);
        return { success: true };
      } catch (err) {
        if (handleEventWaitlistError(reply, err)) return;
        throw err;
      }
    },
  );

  fastify.post<{ Params: { id: string; registrationId: string }; Body: unknown }>(
    '/events/:id/waitlist/:registrationId/promote',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      const registrationId = parseInt(request.params.registrationId, 10);
      if (isNaN(eventId) || isNaN(registrationId)) return sendApiError(reply, 400, 'Invalid id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      const parsed = waitlistPromoteSchema.safeParse(request.body ?? {});
      if (!parsed.success) return sendValidationError(reply, 'Invalid request body', parsed.error.flatten());

      try {
        const offer = await promoteWaitlistRegistration({
          eventId,
          registrationId,
          respondByDays: parsed.data.respondByDays,
          createdByMemberId: member.id,
        });
        return reply.code(201).send(offer);
      } catch (err) {
        if (handleEventWaitlistError(reply, err)) return;
        throw err;
      }
    },
  );

  fastify.post<{ Params: { id: string; offerId: string } }>(
    '/events/:id/waitlist/offers/:offerId/force-decline',
    { schema: { tags: ['events'] } },
    async (request, reply) => {
      const eventId = parseInt(request.params.id, 10);
      const offerId = parseInt(request.params.offerId, 10);
      if (isNaN(eventId) || isNaN(offerId)) return sendApiError(reply, 400, 'Invalid id');

      const member = (request as AuthenticatedRequest).member as Member;
      if (!(await canManageEvent(member, eventId))) {
        return sendApiError(reply, 403, 'Forbidden');
      }

      try {
        await forceDeclineWaitlistOffer(eventId, offerId);
        return { success: true };
      } catch (err) {
        if (handleEventWaitlistError(reply, err)) return;
        throw err;
      }
    },
  );
}

// Helpers

function formatTournamentTeamResponse(t: TournamentTeamRow) {
  return {
    id: t.id,
    sortOrder: t.sortOrder,
    teamName: t.teamName,
    homeClub: t.homeClub,
    viceSlotCode: t.viceSlotCode,
    skipSlotCode: t.skipSlotCode,
    roster: t.roster.map((r) => ({
      slotCode: r.slotCode,
      playerName: r.playerName,
      email: r.email,
      notes: r.notes,
      homeClub: r.homeClub,
    })),
  };
}

function formatPublicTournamentTeamResponse(t: TournamentTeamRow) {
  return {
    id: t.id,
    sortOrder: t.sortOrder,
    teamName: t.teamName,
    homeClub: t.homeClub,
    viceSlotCode: t.viceSlotCode,
    skipSlotCode: t.skipSlotCode,
    roster: t.roster.map((r) => ({
      slotCode: r.slotCode,
      playerName: r.playerName,
    })),
  };
}

function summarizeEvent(event: EventFormattingSource) {
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    visibility: event.visibility,
    calendarTypeId: normalizeCalendarTypeId(event.calendar_type_id),
    published: event.published,
    tournamentTeamsPublished: event.tournament_teams_published ?? 0,
    tournamentDrawPublished: event.tournament_draw_published ?? 0,
    tournamentFormat: normalizeTournamentFormat(event.tournament_format as string | null),
    capacity: event.capacity,
    feeMinor: event.fee_minor,
    memberFeeMinor: event.member_fee_minor ?? null,
    currency: event.currency,
    imageFileId: event.image_file_id,
    enableWaitlist: event.enable_waitlist,
    allowGroupRegistration: event.allow_group_registration,
    timespans: event.timespans || [],
    locations: event.locations || [],
    categoryIds: event.categoryIds || [],
    registrationStart: event.registration_start,
    registrationCutoff: event.registration_cutoff,
    createdAt: event.created_at,
  };
}

function formatEventResponse(event: EventFormattingSource) {
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    articleId: event.article_id,
    imageFileId: event.image_file_id,
    visibility: event.visibility,
    calendarTypeId: normalizeCalendarTypeId(event.calendar_type_id),
    published: event.published,
    tournamentTeamsPublished: event.tournament_teams_published ?? 0,
    tournamentDrawPublished: event.tournament_draw_published ?? 0,
    tournamentFormat: normalizeTournamentFormat(event.tournament_format as string | null),
    capacity: event.capacity,
    feeMinor: event.fee_minor,
    memberFeeMinor: event.member_fee_minor ?? null,
    currency: event.currency,
    registrationStart: event.registration_start,
    registrationCutoff: event.registration_cutoff,
    cancellationCutoff: event.cancellation_cutoff,
    allowGroupRegistration: event.allow_group_registration,
    maxGroupSize: event.max_group_size,
    enableWaitlist: event.enable_waitlist,
    termsArticleId: event.terms_article_id,
    pointOfContact: event.point_of_contact,
    createdByMemberId: event.created_by_member_id,
    timespans: event.timespans || [],
    locations: event.locations || [],
    categoryIds: event.categoryIds || [],
    ownerMemberIds: event.ownerMemberIds || [],
    registrationFields: event.registrationFields || [],
    createdAt: event.created_at,
    updatedAt: event.updated_at,
  };
}

async function createCheckoutForRegistration(
  event: EventFormattingSource,
  registrationResult: { registrationId: number; totalFee: number },
  contactEmail: string,
  createdByMemberId?: number | null,
  checkoutFrontendBaseUrl: string = canonicalFrontendBaseUrl()
) {
  const paymentService = createPaymentService();
  const paymentProvider = getDefaultPaymentProvider();
  const order = await paymentService.createPaymentOrder({
    provider: paymentProvider,
    subjectType: 'event_registration',
    subjectId: registrationResult.registrationId,
    amountMinor: registrationResult.totalFee,
    currency: event.currency || 'usd',
    createdByMemberId: createdByMemberId ?? null,
    metadata: {
      eventId: event.id,
      eventTitle: event.title,
      paymentItemName: event.payment_item_name ?? null,
      registrationId: registrationResult.registrationId,
      contactEmail,
    },
  });

  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.eventRegistrations)
    .set({ payment_order_id: order.id })
    .where(eq(schema.eventRegistrations.id, registrationResult.registrationId));

  const successUrl = buildCheckoutSuccessUrl(
    `${checkoutFrontendBaseUrl}/events/${encodeURIComponent(event.slug)}/register/success?registrationId=${registrationResult.registrationId}`,
    paymentProvider
  );
  const cancelUrl = `${checkoutFrontendBaseUrl}/events/${encodeURIComponent(event.slug)}/register?canceled=true`;

  const checkout = await paymentService.createHostedCheckoutForOrder({
    orderId: order.id,
    successUrl,
    cancelUrl,
  });

  return {
    registrationId: registrationResult.registrationId,
    status: 'pending_payment',
    checkoutUrl: checkout.checkoutUrl,
    orderToken: order.orderToken,
  };
}

async function notifyEventOwners(
  event: EventFormattingSource,
  registrantName: string,
  registrantEmail: string,
  groupSize: number,
  status: string
) {
  if (!event.ownerMemberIds || event.ownerMemberIds.length === 0) return;

  const { db, schema } = getDrizzleDb();
  for (const ownerId of event.ownerMemberIds) {
    const [owner] = await db
      .select({ name: schema.members.name, email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, ownerId))
      .limit(1);
    if (owner) {
      await sendEventOwnerNewRegistrationEmail(
        owner.email,
        owner.name,
        event.title,
        registrantName,
        registrantEmail,
        groupSize,
        status
      );
    }
  }
}

function schedulePointOfContactNewRegistrationNotification(
  log: { error: (payload: unknown, message: string) => void },
  event: EventFormattingSource,
  registrationId: number,
  status: string,
  needsPayment: boolean,
) {
  if (!shouldNotifyPointOfContactAtRegistration({ needsPayment, status })) {
    return;
  }

  notifyPointOfContactOfNewRegistration({ event, registrationId, status }).catch((err) =>
    log.error({ err }, 'Failed to notify event point of contact'),
  );
}
