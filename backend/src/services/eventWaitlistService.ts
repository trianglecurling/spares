/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import { and, asc, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { computeOpenSpotsFromDemand } from './eventCapacityLogic.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { EventWaitlistOfferDeclinedBy, EventWaitlistOfferStatus } from '../db/drizzle-schema.js';
import {
  getEventById,
  resolveEventRegistrationFeeMinor,
} from './eventService.js';
import { issueEventRegistrationRefund } from './eventRegistrationRefundService.js';

export class EventWaitlistServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'EventWaitlistServiceError';
  }
}

function dbValue(value: unknown) {
  const isPostgres = getDatabaseConfig()?.type === 'postgres';
  if (isPostgres) return value;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function parseTimestamp(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function isOfferExpired(expiresAt: string | Date | null | undefined, nowMs = Date.now()): boolean {
  const expiresMs = parseTimestamp(expiresAt);
  if (expiresMs == null) return false;
  return nowMs > expiresMs;
}

/** Confirmed registrations plus pending offer holds count toward event capacity. */
export async function getCapacityHoldCount(eventId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();

  const [confirmedRows, pendingOfferRows] = await Promise.all([
    db
      .select({ group_size: schema.eventRegistrations.group_size })
      .from(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.event_id, eventId),
          eq(schema.eventRegistrations.status, 'confirmed' as any),
        ),
      ),
    db
      .select({ group_size: schema.eventRegistrations.group_size })
      .from(schema.eventWaitlistOffers)
      .innerJoin(
        schema.eventRegistrations,
        eq(schema.eventWaitlistOffers.registration_id, schema.eventRegistrations.id),
      )
      .where(
        and(
          eq(schema.eventWaitlistOffers.event_id, eventId),
          eq(schema.eventWaitlistOffers.status, 'pending' as any),
        ),
      ),
  ]);

  const confirmed = confirmedRows.reduce((sum, row) => sum + (row.group_size ?? 1), 0);
  const pendingOffers = pendingOfferRows.reduce((sum, row) => sum + (row.group_size ?? 1), 0);
  return confirmed + pendingOffers;
}

export async function getWaitlistedCount(eventId: number): Promise<number> {
  return getWaitlistLength(eventId);
}

export async function getWaitlistLength(eventId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.event_id, eventId),
        eq(schema.eventRegistrations.status, 'waitlisted' as any),
      ),
    );
  return Number(row?.count ?? 0);
}

/** Group sizes for waitlisted entries that do not already hold capacity via a pending offer. */
export async function getWaitlistEarmarkedGroupSize(eventId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const pendingOfferForRegistration = db
    .select({ one: sql<number>`1` })
    .from(schema.eventWaitlistOffers)
    .where(
      and(
        eq(schema.eventWaitlistOffers.registration_id, schema.eventRegistrations.id),
        eq(schema.eventWaitlistOffers.status, 'pending' as any),
      ),
    );

  const rows = await db
    .select({ group_size: schema.eventRegistrations.group_size })
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.event_id, eventId),
        eq(schema.eventRegistrations.status, 'waitlisted' as any),
        notExists(pendingOfferForRegistration),
      ),
    );

  return rows.reduce((sum, row) => sum + (row.group_size ?? 1), 0);
}

/** Confirmed/pending-offer holds plus waitlist demand not yet holding a spot. */
export async function getRegistrationDemandCount(eventId: number): Promise<number> {
  const [capacityHoldCount, waitlistEarmarkedGroupSize] = await Promise.all([
    getCapacityHoldCount(eventId),
    getWaitlistEarmarkedGroupSize(eventId),
  ]);
  return capacityHoldCount + waitlistEarmarkedGroupSize;
}

export async function getOpenSpots(eventId: number, capacity: number | null): Promise<number | null> {
  const demand = await getRegistrationDemandCount(eventId);
  return computeOpenSpotsFromDemand(capacity, demand);
}

export type PublicEventRegistrationStats = {
  confirmedCount: number;
  waitlistedCount: number;
  openSpots: number | null;
};

/**
 * Batch registration stats for public event list cards (same semantics as the
 * single-event public detail fields: confirmedCount, waitlistedCount, openSpots).
 */
export async function getPublicEventRegistrationStats(
  events: Array<{ id: number; capacity: number | null }>,
): Promise<Map<number, PublicEventRegistrationStats>> {
  const result = new Map<number, PublicEventRegistrationStats>();
  for (const event of events) {
    result.set(event.id, {
      confirmedCount: 0,
      waitlistedCount: 0,
      openSpots: computeOpenSpotsFromDemand(event.capacity, 0),
    });
  }
  if (events.length === 0) return result;

  const eventIds = events.map((e) => e.id);
  const capacityById = new Map(events.map((e) => [e.id, e.capacity]));
  const { db, schema } = getDrizzleDb();

  const pendingOfferForRegistration = db
    .select({ one: sql<number>`1` })
    .from(schema.eventWaitlistOffers)
    .where(
      and(
        eq(schema.eventWaitlistOffers.registration_id, schema.eventRegistrations.id),
        eq(schema.eventWaitlistOffers.status, 'pending' as any),
      ),
    );

  const [confirmedRows, waitlistedRows, pendingOfferRows, earmarkedRows] = await Promise.all([
    db
      .select({
        event_id: schema.eventRegistrations.event_id,
        group_size: schema.eventRegistrations.group_size,
      })
      .from(schema.eventRegistrations)
      .where(
        and(
          inArray(schema.eventRegistrations.event_id, eventIds),
          eq(schema.eventRegistrations.status, 'confirmed' as any),
        ),
      ),
    db
      .select({
        event_id: schema.eventRegistrations.event_id,
      })
      .from(schema.eventRegistrations)
      .where(
        and(
          inArray(schema.eventRegistrations.event_id, eventIds),
          eq(schema.eventRegistrations.status, 'waitlisted' as any),
        ),
      ),
    db
      .select({
        event_id: schema.eventWaitlistOffers.event_id,
        group_size: schema.eventRegistrations.group_size,
      })
      .from(schema.eventWaitlistOffers)
      .innerJoin(
        schema.eventRegistrations,
        eq(schema.eventWaitlistOffers.registration_id, schema.eventRegistrations.id),
      )
      .where(
        and(
          inArray(schema.eventWaitlistOffers.event_id, eventIds),
          eq(schema.eventWaitlistOffers.status, 'pending' as any),
        ),
      ),
    db
      .select({
        event_id: schema.eventRegistrations.event_id,
        group_size: schema.eventRegistrations.group_size,
      })
      .from(schema.eventRegistrations)
      .where(
        and(
          inArray(schema.eventRegistrations.event_id, eventIds),
          eq(schema.eventRegistrations.status, 'waitlisted' as any),
          notExists(pendingOfferForRegistration),
        ),
      ),
  ]);

  const confirmedByEvent = new Map<number, number>();
  for (const row of confirmedRows) {
    const id = row.event_id;
    confirmedByEvent.set(id, (confirmedByEvent.get(id) ?? 0) + (row.group_size ?? 1));
  }

  const waitlistedByEvent = new Map<number, number>();
  for (const row of waitlistedRows) {
    const id = row.event_id;
    waitlistedByEvent.set(id, (waitlistedByEvent.get(id) ?? 0) + 1);
  }

  const demandByEvent = new Map<number, number>();
  for (const row of confirmedRows) {
    const id = row.event_id;
    demandByEvent.set(id, (demandByEvent.get(id) ?? 0) + (row.group_size ?? 1));
  }
  for (const row of pendingOfferRows) {
    const id = row.event_id;
    demandByEvent.set(id, (demandByEvent.get(id) ?? 0) + (row.group_size ?? 1));
  }
  for (const row of earmarkedRows) {
    const id = row.event_id;
    demandByEvent.set(id, (demandByEvent.get(id) ?? 0) + (row.group_size ?? 1));
  }

  for (const eventId of eventIds) {
    const confirmedCount = confirmedByEvent.get(eventId) ?? 0;
    const waitlistedCount = waitlistedByEvent.get(eventId) ?? 0;
    const demand = demandByEvent.get(eventId) ?? 0;
    result.set(eventId, {
      confirmedCount,
      waitlistedCount,
      openSpots: computeOpenSpotsFromDemand(capacityById.get(eventId) ?? null, demand),
    });
  }

  return result;
}

export async function getPendingOfferCount(eventId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.eventWaitlistOffers)
    .where(
      and(
        eq(schema.eventWaitlistOffers.event_id, eventId),
        eq(schema.eventWaitlistOffers.status, 'pending' as any),
      ),
    );
  return Number(row?.count ?? 0);
}

export async function resolvePendingOfferForRegistration(registrationId: number, declinedBy: EventWaitlistOfferDeclinedBy): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const now = dbValue(new Date());
  await db
    .update(schema.eventWaitlistOffers)
    .set({
      status: 'declined' as any,
      declined_by: declinedBy,
      resolved_at: now as any,
    })
    .where(
      and(
        eq(schema.eventWaitlistOffers.registration_id, registrationId),
        eq(schema.eventWaitlistOffers.status, 'pending' as any),
      ),
    );
}

async function supersedeExpiredPendingOffersForCapacity(eventId: number, neededSpots: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const nowMs = Date.now();
  const now = dbValue(new Date());

  const expiredOffers = await db
    .select({
      id: schema.eventWaitlistOffers.id,
      group_size: schema.eventRegistrations.group_size,
      expires_at: schema.eventWaitlistOffers.expires_at,
    })
    .from(schema.eventWaitlistOffers)
    .innerJoin(
      schema.eventRegistrations,
      eq(schema.eventWaitlistOffers.registration_id, schema.eventRegistrations.id),
    )
    .where(
      and(
        eq(schema.eventWaitlistOffers.event_id, eventId),
        eq(schema.eventWaitlistOffers.status, 'pending' as any),
      ),
    )
    .orderBy(asc(schema.eventWaitlistOffers.expires_at), asc(schema.eventWaitlistOffers.id));

  let freed = 0;
  for (const offer of expiredOffers) {
    if (!isOfferExpired(offer.expires_at, nowMs)) break;
    if (freed >= neededSpots) break;
    await db
      .update(schema.eventWaitlistOffers)
      .set({ status: 'superseded' as any, resolved_at: now as any })
      .where(eq(schema.eventWaitlistOffers.id, offer.id));
    freed += offer.group_size ?? 1;
  }
}

async function assertCapacityForNewPendingOffer(eventId: number, groupSize: number): Promise<void> {
  const event = await getEventById(eventId);
  if (!event || event.capacity === null) return;

  let holds = await getCapacityHoldCount(eventId);
  if (holds + groupSize <= event.capacity) return;

  const needed = holds + groupSize - event.capacity;
  await supersedeExpiredPendingOffersForCapacity(eventId, needed);
  holds = await getCapacityHoldCount(eventId);

  if (holds + groupSize > event.capacity) {
    throw new EventWaitlistServiceError(
      'Not enough open spots while non-expired pending offers are holding capacity',
      409,
      'capacity_held_by_pending_offers',
    );
  }
}

function formatOfferResponse(offer: any, waitlistPosition?: number | null) {
  const nowMs = Date.now();
  return {
    id: offer.id,
    eventId: offer.event_id,
    registrationId: offer.registration_id,
    status: offer.status,
    declinedBy: offer.declined_by ?? null,
    respondByDays: offer.respond_by_days,
    expiresAt: offer.expires_at,
    expired: isOfferExpired(offer.expires_at, nowMs),
    responseToken: offer.response_token,
    paymentOrderId: offer.payment_order_id ?? null,
    createdAt: offer.created_at,
    resolvedAt: offer.resolved_at ?? null,
    waitlistPosition: waitlistPosition ?? null,
  };
}

export async function listEventWaitlist(eventId: number) {
  const { db, schema } = getDrizzleDb();
  const event = await getEventById(eventId);
  if (!event) throw new EventWaitlistServiceError('Event not found', 404);

  const registrations = await db
    .select()
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.event_id, eventId),
        eq(schema.eventRegistrations.status, 'waitlisted' as any),
      ),
    )
    .orderBy(asc(schema.eventRegistrations.waitlist_position), asc(schema.eventRegistrations.created_at));

  const registrationIds = registrations.map((r) => r.id);
  const offers = registrationIds.length === 0
    ? []
    : await db
      .select()
      .from(schema.eventWaitlistOffers)
      .where(inArray(schema.eventWaitlistOffers.registration_id, registrationIds))
      .orderBy(desc(schema.eventWaitlistOffers.created_at));

  const latestOfferByRegistration = new Map<number, (typeof offers)[number]>();
  for (const offer of offers) {
    if (!latestOfferByRegistration.has(offer.registration_id)) {
      latestOfferByRegistration.set(offer.registration_id, offer);
    }
  }

  const nowMs = Date.now();
  const [waitlistLength, openSpots, pendingOffers] = await Promise.all([
    getWaitlistLength(eventId),
    getOpenSpots(eventId, event.capacity),
    getPendingOfferCount(eventId),
  ]);

  return {
    summary: {
      waitlistLength,
      openSpots,
      pendingOffers,
      capacity: event.capacity,
    },
    entries: registrations.map((reg) => {
      const offer = latestOfferByRegistration.get(reg.id);
      return {
        registrationId: reg.id,
        contactName: reg.contact_name,
        contactEmail: reg.contact_email,
        memberId: reg.member_id,
        groupSize: reg.group_size ?? 1,
        position: reg.waitlist_position,
        joinedAt: reg.registered_at ?? reg.created_at,
        offer: offer
          ? {
              id: offer.id,
              status: offer.status as EventWaitlistOfferStatus,
              expiresAt: offer.expires_at,
              expired: isOfferExpired(offer.expires_at, nowMs),
              createdAt: offer.created_at,
            }
          : null,
      };
    }),
  };
}

export async function reorderEventWaitlist(eventId: number, registrationIds: number[]): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const waitlisted = await db
    .select({ id: schema.eventRegistrations.id })
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.event_id, eventId),
        eq(schema.eventRegistrations.status, 'waitlisted' as any),
      ),
    );

  const waitlistedIds = new Set(waitlisted.map((r) => r.id));
  if (registrationIds.length !== waitlistedIds.size) {
    throw new EventWaitlistServiceError('registrationIds must include every waitlisted entry for this event', 400);
  }
  for (const id of registrationIds) {
    if (!waitlistedIds.has(id)) {
      throw new EventWaitlistServiceError('All registrationIds must be waitlisted entries for this event', 400);
    }
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < registrationIds.length; i++) {
      await tx
        .update(schema.eventRegistrations)
        .set({ waitlist_position: i + 1 })
        .where(eq(schema.eventRegistrations.id, registrationIds[i]));
    }
  });
}

export async function addManualWaitlistEntry(input: {
  eventId: number;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  memberId?: number | null;
  groupMembers?: Array<{ name: string; email?: string }>;
  fieldValues?: Array<{ fieldId: number; registrationMemberIndex?: number | null; value: string }>;
}) {
  const { registerForEvent } = await import('./eventService.js');
  const event = await getEventById(input.eventId);
  if (!event) throw new EventWaitlistServiceError('Event not found', 404);
  if (!event.enable_waitlist) {
    throw new EventWaitlistServiceError('Waitlist is not enabled for this event', 400);
  }

  const result = await registerForEvent({
    eventId: input.eventId,
    memberId: input.memberId ?? null,
    contactFirstName: input.contactFirstName,
    contactLastName: input.contactLastName,
    contactEmail: input.contactEmail,
    groupMembers: input.groupMembers,
    fieldValues: input.fieldValues,
    adminOverride: true,
    forceWaitlist: true,
  });

  return {
    registrationId: result.registrationId,
    waitlistPosition: result.waitlistPosition,
    status: result.status,
  };
}

export async function removeFromEventWaitlist(eventId: number, registrationId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [reg] = await db
    .select()
    .from(schema.eventRegistrations)
    .where(eq(schema.eventRegistrations.id, registrationId))
    .limit(1);

  if (!reg || reg.event_id !== eventId) {
    throw new EventWaitlistServiceError('Registration not found', 404);
  }
  if (reg.status !== 'waitlisted') {
    throw new EventWaitlistServiceError('Registration is not on the waitlist', 400);
  }

  await resolvePendingOfferForRegistration(registrationId, 'manager');
  await db
    .update(schema.eventRegistrations)
    .set({ status: 'cancelled' as any, cancelled_at: dbValue(new Date()) as any, waitlist_position: null })
    .where(eq(schema.eventRegistrations.id, registrationId));

}

export async function promoteWaitlistRegistration(input: {
  eventId: number;
  registrationId: number;
  respondByDays?: number;
  createdByMemberId: number;
}) {
  const respondByDays = Math.min(30, Math.max(1, input.respondByDays ?? 3));
  const { db, schema } = getDrizzleDb();

  const [reg] = await db
    .select()
    .from(schema.eventRegistrations)
    .where(eq(schema.eventRegistrations.id, input.registrationId))
    .limit(1);
  if (!reg || reg.event_id !== input.eventId) {
    throw new EventWaitlistServiceError('Registration not found', 404);
  }
  if (reg.status !== 'waitlisted') {
    throw new EventWaitlistServiceError('Registration is not on the waitlist', 400);
  }

  const [existingPending] = await db
    .select({ id: schema.eventWaitlistOffers.id })
    .from(schema.eventWaitlistOffers)
    .where(
      and(
        eq(schema.eventWaitlistOffers.registration_id, input.registrationId),
        eq(schema.eventWaitlistOffers.status, 'pending' as any),
      ),
    )
    .limit(1);
  if (existingPending) {
    throw new EventWaitlistServiceError('This registration already has a pending offer', 409);
  }

  const groupSize = reg.group_size ?? 1;
  await assertCapacityForNewPendingOffer(input.eventId, groupSize);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + respondByDays);
  const responseToken = crypto.randomUUID();

  const [offer] = await db
    .insert(schema.eventWaitlistOffers)
    .values({
      event_id: input.eventId,
      registration_id: input.registrationId,
      status: 'pending' as any,
      respond_by_days: respondByDays,
      expires_at: dbValue(expiresAt) as any,
      response_token: responseToken,
      created_by_member_id: input.createdByMemberId,
    } as any)
    .returning();

  const event = await getEventById(input.eventId);
  if (event && reg.contact_email) {
    const effectiveFee = resolveEventRegistrationFeeMinor(event, {
      memberId: reg.member_id,
      adminOverride: false,
      specialLinkOverrideMinor: null,
    });
    const { sendEventWaitlistPromotionOfferEmail } = await import('./email.js');
    const { eventWaitlistOfferUrl } = await import('../utils/eventWaitlistOfferUrl.js');
    await sendEventWaitlistPromotionOfferEmail(
      reg.contact_email,
      reg.contact_name,
      event.title,
      effectiveFee * groupSize > 0,
      respondByDays,
      expiresAt,
      eventWaitlistOfferUrl(responseToken),
    );
  }

  return formatOfferResponse(offer, reg.waitlist_position);
}

export async function forceDeclineWaitlistOffer(eventId: number, offerId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [offer] = await db
    .select()
    .from(schema.eventWaitlistOffers)
    .where(eq(schema.eventWaitlistOffers.id, offerId))
    .limit(1);

  if (!offer || offer.event_id !== eventId) {
    throw new EventWaitlistServiceError('Offer not found', 404);
  }
  if (offer.status !== 'pending') {
    throw new EventWaitlistServiceError('Only pending offers can be force-declined', 400);
  }

  await db
    .update(schema.eventWaitlistOffers)
    .set({
      status: 'declined' as any,
      declined_by: 'manager',
      resolved_at: dbValue(new Date()) as any,
    })
    .where(eq(schema.eventWaitlistOffers.id, offerId));
}

async function loadOfferByToken(responseToken: string) {
  const { db, schema } = getDrizzleDb();
  const [offer] = await db
    .select()
    .from(schema.eventWaitlistOffers)
    .where(eq(schema.eventWaitlistOffers.response_token, responseToken))
    .limit(1);
  if (!offer) return null;

  const [registration] = await db
    .select()
    .from(schema.eventRegistrations)
    .where(eq(schema.eventRegistrations.id, offer.registration_id))
    .limit(1);
  if (!registration) return null;

  const event = await getEventById(offer.event_id);
  if (!event) return null;

  return { offer, registration, event };
}

export async function getPublicWaitlistOffer(responseToken: string) {
  const loaded = await loadOfferByToken(responseToken);
  if (!loaded) throw new EventWaitlistServiceError('Offer not found', 404);

  const { offer, registration, event } = loaded;
  const nowMs = Date.now();
  const feeMinor = resolveEventRegistrationFeeMinor(event, {
    memberId: registration.member_id,
    adminOverride: false,
    specialLinkOverrideMinor: null,
  });
  const totalFeeMinor = feeMinor * (registration.group_size ?? 1);

  return {
    offer: {
      ...formatOfferResponse(offer, registration.waitlist_position),
      claimable: offer.status === 'pending',
    },
    event: {
      id: event.id,
      title: event.title,
      slug: event.slug,
      feeMinor,
      totalFeeMinor,
      currency: event.currency,
      timespans: event.timespans ?? [],
    },
    registration: {
      contactName: registration.contact_name,
      groupSize: registration.group_size ?? 1,
      waitlistPosition: registration.waitlist_position,
    },
    expired: isOfferExpired(offer.expires_at, nowMs),
  };
}

export async function declineWaitlistOfferByToken(responseToken: string): Promise<void> {
  const loaded = await loadOfferByToken(responseToken);
  if (!loaded) throw new EventWaitlistServiceError('Offer not found', 404);

  const { offer, registration } = loaded;
  if (offer.status !== 'pending') {
    throw new EventWaitlistServiceError('This offer is no longer available', 409, 'offer_no_longer_available');
  }

  const { db, schema } = getDrizzleDb();
  const now = dbValue(new Date());
  await db
    .update(schema.eventWaitlistOffers)
    .set({
      status: 'declined' as any,
      declined_by: 'registrant',
      resolved_at: now as any,
    })
    .where(eq(schema.eventWaitlistOffers.id, offer.id));

  await db
    .update(schema.eventRegistrations)
    .set({
      status: 'cancelled' as any,
      cancelled_at: now as any,
      waitlist_position: null,
    })
    .where(eq(schema.eventRegistrations.id, registration.id));

}

export async function acceptWaitlistOfferByToken(
  responseToken: string,
  checkoutFrontendBaseUrl: string,
): Promise<{ checkoutUrl?: string; confirmed: boolean; registrationId: number; offerId: number }> {
  const loaded = await loadOfferByToken(responseToken);
  if (!loaded) throw new EventWaitlistServiceError('Offer not found', 404);

  const { offer, registration, event } = loaded;
  if (offer.status !== 'pending') {
    throw new EventWaitlistServiceError('This offer is no longer available', 409, 'offer_no_longer_available');
  }

  const feeMinor = resolveEventRegistrationFeeMinor(event, {
    memberId: registration.member_id,
    adminOverride: false,
    specialLinkOverrideMinor: null,
  });
  const totalFee = feeMinor * (registration.group_size ?? 1);

  if (totalFee <= 0) {
    await confirmWaitlistOfferAcceptance(offer.id, null);
    const eventWhen = (await import('../utils/formatEventTimespans.js')).formatEventTimespansForDisplay(
      event.timespans as Array<{ start_dt: string; end_dt: string; sort_order?: number }>,
    );
    const { sendEventRegistrationConfirmationEmail } = await import('./email.js');
    const { ensureRegistrationAccessToken } = await import('./eventService.js');
    const { eventRegistrationManageUrl } = await import('../utils/eventRegistrationManageUrl.js');
    const accessToken = registration.access_token ?? await ensureRegistrationAccessToken(registration.id);
    await sendEventRegistrationConfirmationEmail(
      registration.contact_email,
      registration.contact_name,
      event.title,
      eventWhen,
      'confirmed',
      registration.group_size ?? 1,
      undefined,
      {
        manageRegistrationUrl: eventRegistrationManageUrl(accessToken),
        pointOfContact: event.point_of_contact,
      },
    );
    return { confirmed: true, registrationId: registration.id, offerId: offer.id };
  }

  const checkout = await createCheckoutForWaitlistOffer({
    event,
    offer,
    registrationId: registration.id,
    totalFee,
    contactEmail: registration.contact_email,
    checkoutFrontendBaseUrl,
  });

  return {
    checkoutUrl: checkout.checkoutUrl,
    confirmed: false,
    registrationId: registration.id,
    offerId: offer.id,
  };
}

async function createCheckoutForWaitlistOffer(input: {
  event: NonNullable<Awaited<ReturnType<typeof getEventById>>>;
  offer: { id: number; response_token: string };
  registrationId: number;
  totalFee: number;
  contactEmail: string;
  checkoutFrontendBaseUrl: string;
}) {
  const { createPaymentService, getDefaultPaymentProvider, buildCheckoutSuccessUrl } = await import('./paymentService.js');
  const { db, schema } = getDrizzleDb();

  const paymentService = createPaymentService();
  const paymentProvider = getDefaultPaymentProvider();
  const order = await paymentService.createPaymentOrder({
    provider: paymentProvider,
    subjectType: 'event_registration',
    subjectId: input.registrationId,
    amountMinor: input.totalFee,
    currency: input.event.currency || 'usd',
    createdByMemberId: null,
    metadata: {
      eventId: input.event.id,
      eventTitle: input.event.title,
      paymentItemName: input.event.payment_item_name ?? null,
      registrationId: input.registrationId,
      contactEmail: input.contactEmail,
      eventWaitlistOfferId: input.offer.id,
    },
  });

  await db
    .update(schema.eventWaitlistOffers)
    .set({ payment_order_id: order.id })
    .where(eq(schema.eventWaitlistOffers.id, input.offer.id));

  const offerUrl = `${input.checkoutFrontendBaseUrl.replace(/\/+$/, '')}/events/waitlist-offers/${encodeURIComponent(input.offer.response_token)}`;
  const successUrl = buildCheckoutSuccessUrl(`${offerUrl}?paid=true`, paymentProvider);
  const cancelUrl = `${offerUrl}?canceled=true`;

  const checkout = await paymentService.createHostedCheckoutForOrder({
    orderId: order.id,
    successUrl,
    cancelUrl,
  });

  return { checkoutUrl: checkout.checkoutUrl, orderToken: order.orderToken };
}

export async function confirmWaitlistOfferAcceptance(offerId: number, paymentOrderId: number | null): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [offer] = await db
    .select()
    .from(schema.eventWaitlistOffers)
    .where(eq(schema.eventWaitlistOffers.id, offerId))
    .limit(1);
  if (!offer) return;

  if (offer.status !== 'pending') {
    if (paymentOrderId) {
      await issueEventRegistrationRefund({
        paymentOrderId,
        reason: 'Event waitlist offer no longer available after payment',
        bypassEligibility: true,
      });
    }
    return;
  }

  const now = dbValue(new Date());
  const registrationUpdate: Record<string, unknown> = {
    status: 'confirmed' as any,
    waitlist_position: null,
  };
  if (paymentOrderId != null) {
    registrationUpdate.payment_order_id = paymentOrderId;
  }

  await db
    .update(schema.eventRegistrations)
    .set(registrationUpdate as any)
    .where(eq(schema.eventRegistrations.id, offer.registration_id));

  await db
    .update(schema.eventWaitlistOffers)
    .set({
      status: 'accepted' as any,
      resolved_at: now as any,
      payment_order_id: paymentOrderId ?? offer.payment_order_id,
    })
    .where(
      and(
        eq(schema.eventWaitlistOffers.id, offerId),
        eq(schema.eventWaitlistOffers.status, 'pending' as any),
      ),
    );

}

export async function confirmWaitlistOfferPayment(orderId: number, offerId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [offer] = await db
    .select()
    .from(schema.eventWaitlistOffers)
    .where(eq(schema.eventWaitlistOffers.id, offerId))
    .limit(1);

  if (!offer) return;

  if (offer.status === 'pending') {
    await confirmWaitlistOfferAcceptance(offerId, orderId);
    const { createPaymentService } = await import('./paymentService.js');
    await createPaymentService().sendEventRegistrationCompletionEmailsForOrder(orderId);
    return;
  }

  if (offer.status === 'superseded' || offer.status === 'declined') {
    await issueEventRegistrationRefund({
      paymentOrderId: orderId,
      reason: 'Event waitlist offer superseded or declined after payment',
      bypassEligibility: true,
    });
  }
}

export async function resolveWaitlistOfferPaymentByToken(
  responseToken: string,
  sessionId?: string | null,
): Promise<{
  paymentStatus: string;
  offerStatus: EventWaitlistOfferStatus;
  offerId: number;
  confirmed: boolean;
  offerNoLongerAvailable: boolean;
  eventSlug: string;
}> {
  const loaded = await loadOfferByToken(responseToken);
  if (!loaded) throw new EventWaitlistServiceError('Offer not found', 404);

  const { offer, event } = loaded;
  const paymentOrderId = offer.payment_order_id;

  if (!paymentOrderId) {
    return {
      paymentStatus: 'none',
      offerStatus: offer.status as EventWaitlistOfferStatus,
      offerId: offer.id,
      confirmed: offer.status === 'accepted',
      offerNoLongerAvailable: offer.status === 'superseded' || offer.status === 'declined',
      eventSlug: event.slug,
    };
  }

  const { db, schema } = getDrizzleDb();
  const [order] = await db
    .select()
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.id, paymentOrderId))
    .limit(1);
  if (!order) throw new EventWaitlistServiceError('Payment order not found', 404);

  const { createPaymentService } = await import('./paymentService.js');
  const paymentService = createPaymentService();

  if (sessionId?.trim()) {
    await paymentService.reconcilePaymentOrderByToken(order.order_token, sessionId.trim(), 'checkout-return');
  } else {
    await paymentService.reconcilePaymentOrder(paymentOrderId, 'checkout-return');
  }

  const [updatedOrder] = await db
    .select({ status: schema.paymentOrders.status })
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.id, paymentOrderId))
    .limit(1);

  const [refreshedOffer] = await db
    .select()
    .from(schema.eventWaitlistOffers)
    .where(eq(schema.eventWaitlistOffers.id, offer.id))
    .limit(1);

  if (!refreshedOffer) throw new EventWaitlistServiceError('Offer not found', 404);

  if (updatedOrder?.status === 'succeeded' && refreshedOffer.status === 'pending') {
    await confirmWaitlistOfferPayment(paymentOrderId, offer.id);
  } else if (updatedOrder?.status === 'succeeded' && refreshedOffer.status === 'accepted') {
    await paymentService.sendEventRegistrationCompletionEmailsForOrder(paymentOrderId);
  }

  const [finalOffer] = await db
    .select()
    .from(schema.eventWaitlistOffers)
    .where(eq(schema.eventWaitlistOffers.id, offer.id))
    .limit(1);

  const offerStatus = (finalOffer?.status ?? refreshedOffer.status) as EventWaitlistOfferStatus;

  return {
    paymentStatus: updatedOrder?.status ?? 'unknown',
    offerStatus,
    offerId: offer.id,
    confirmed: offerStatus === 'accepted',
    offerNoLongerAvailable: offerStatus === 'superseded' || offerStatus === 'declined',
    eventSlug: event.slug,
  };
}
