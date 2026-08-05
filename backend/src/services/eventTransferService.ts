/* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle row shapes */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { EventRegistrationStatus } from '../db/drizzle-schema.js';
import { hasDirectRegistrationCapacity } from './eventCapacityLogic.js';
import { getEventById, getRegistrationById, listEventsInTransferGroup } from './eventService.js';
import { isArchivedAt } from '../utils/softDelete.js';

export class EventTransferServiceError extends Error {
  statusCode: number;
  code?: string;

  constructor(message: string, statusCode = 400, code?: string) {
    super(message);
    this.name = 'EventTransferServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type TransferableSessionSummary = {
  eventId: number;
  title: string;
  slug: string;
  timespans: Array<{ start_dt: string; end_dt: string; sort_order: number }>;
  openSpots: number | null;
  waitlistEnabled: boolean;
  eligible: boolean;
  ineligibleReason: string | null;
  /** What status the registration would receive if transferred now. */
  resultingStatus: 'confirmed' | 'waitlisted' | null;
};

function eventTimeMs(value: string | Date | null | undefined): number | null {
  if (value == null || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function feesMatch(
  source: { fee_minor: number; member_fee_minor?: number | null; currency: string },
  target: { fee_minor: number; member_fee_minor?: number | null; currency: string },
): boolean {
  return (
    source.fee_minor === target.fee_minor &&
    (source.member_fee_minor ?? null) === (target.member_fee_minor ?? null) &&
    (source.currency || 'usd') === (target.currency || 'usd')
  );
}

function fieldCompatibilityIssue(
  sourceFields: Array<{ field_key: string; field_type: string; scope: string; required: number; label: string }>,
  targetFields: Array<{ field_key: string; field_type: string; scope: string; required: number; label: string }>,
): string | null {
  const sourceByKey = new Map(sourceFields.map((f) => [f.field_key, f]));
  const targetByKey = new Map(targetFields.map((f) => [f.field_key, f]));

  for (const target of targetFields) {
    if (target.field_type === 'subheading') continue;
    const source = sourceByKey.get(target.field_key);
    if (!source) {
      if (target.required === 1) {
        return `Target event requires field "${target.label}" which is missing on the current event`;
      }
      continue;
    }
    if (source.field_type !== target.field_type || source.scope !== target.scope) {
      return `Field "${target.label}" is not compatible between sessions`;
    }
  }

  for (const source of sourceFields) {
    if (source.field_type === 'subheading') continue;
    const target = targetByKey.get(source.field_key);
    if (target && (source.field_type !== target.field_type || source.scope !== target.scope)) {
      return `Field "${source.label}" is not compatible between sessions`;
    }
  }

  return null;
}

function registrationReferencedInDrawJson(drawJson: string | null | undefined, registrationId: number): boolean {
  if (!drawJson || !drawJson.trim()) return false;
  try {
    const parsed = JSON.parse(drawJson) as { games?: Array<{ slots?: Array<{ sourceType?: string; registrationId?: number }> }> };
    for (const game of parsed.games ?? []) {
      for (const slot of game.slots ?? []) {
        if (slot?.sourceType === 'registration' && slot.registrationId === registrationId) {
          return true;
        }
      }
    }
  } catch {
    // If draw JSON is malformed, be conservative and block.
    return drawJson.includes(`"registrationId":${registrationId}`) || drawJson.includes(`"registrationId": ${registrationId}`);
  }
  return false;
}

function targetAcceptsTransfers(target: any, nowMs: number): string | null {
  if (isArchivedAt(target.archived_at)) return 'Target session is archived';
  if (target.published !== 1) return 'Target session is not published';
  const startMs = eventTimeMs(target.registration_start);
  if (startMs != null && nowMs < startMs) return 'Registration has not opened for the target session';
  const cutoff = target.registration_cutoff || target.timespans?.[0]?.start_dt;
  const cutoffMs = eventTimeMs(cutoff);
  if (cutoffMs != null && nowMs > cutoffMs) return 'Registration is closed for the target session';
  return null;
}

async function nextWaitlistPosition(eventId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const lastWaitlisted = await db
    .select({ waitlist_position: schema.eventRegistrations.waitlist_position })
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.event_id, eventId),
        eq(schema.eventRegistrations.status, 'waitlisted' as any),
      ),
    )
    .orderBy(desc(schema.eventRegistrations.waitlist_position))
    .limit(1);
  return (lastWaitlisted[0]?.waitlist_position ?? 0) + 1;
}

async function evaluateTransferTarget(input: {
  registration: any;
  sourceEvent: any;
  targetEvent: any;
  adminOverride: boolean;
  nowMs: number;
}): Promise<{ eligible: boolean; reason: string | null; resultingStatus: 'confirmed' | 'waitlisted' | null }> {
  const { registration, sourceEvent, targetEvent, adminOverride, nowMs } = input;

  if (!sourceEvent.transfer_group_id || sourceEvent.transfer_group_id !== targetEvent.transfer_group_id) {
    return { eligible: false, reason: 'Sessions are not linked for registration moves', resultingStatus: null };
  }
  if (registration.event_id === targetEvent.id) {
    return { eligible: false, reason: 'Already registered for this session', resultingStatus: null };
  }
  if (registration.status !== 'confirmed' && registration.status !== 'waitlisted') {
    return { eligible: false, reason: 'Only confirmed or waitlisted registrations can be moved', resultingStatus: null };
  }
  if (registration.special_link_id != null) {
    return { eligible: false, reason: 'Registrations created with a special link cannot be moved', resultingStatus: null };
  }
  if (!feesMatch(sourceEvent, targetEvent)) {
    return { eligible: false, reason: 'Fees do not match between sessions', resultingStatus: null };
  }

  const formIssue = fieldCompatibilityIssue(sourceEvent.registrationFields || [], targetEvent.registrationFields || []);
  if (formIssue) {
    return { eligible: false, reason: formIssue, resultingStatus: null };
  }

  const groupSize = registration.group_size ?? 1;
  if (groupSize > 1 && !targetEvent.allow_group_registration) {
    return { eligible: false, reason: 'Group registration is not allowed on the target session', resultingStatus: null };
  }
  if (targetEvent.max_group_size && groupSize > targetEvent.max_group_size) {
    return { eligible: false, reason: `Maximum group size on the target session is ${targetEvent.max_group_size}`, resultingStatus: null };
  }

  if (registrationReferencedInDrawJson(sourceEvent.tournament_draw_json, registration.id)) {
    return { eligible: false, reason: 'Registration is part of a published tournament draw', resultingStatus: null };
  }

  if (!adminOverride) {
    const dateIssue = targetAcceptsTransfers(targetEvent, nowMs);
    if (dateIssue) {
      return { eligible: false, reason: dateIssue, resultingStatus: null };
    }
  } else if (isArchivedAt(targetEvent.archived_at)) {
    return { eligible: false, reason: 'Target session is archived', resultingStatus: null };
  }

  // Capacity: exclude this registration from source demand when computing target demand
  // (it is not yet on the target). Target demand is independent.
  const { getRegistrationDemandCount } = await import('./eventWaitlistService.js');
  const demand = await getRegistrationDemandCount(targetEvent.id);
  const hasRoom = hasDirectRegistrationCapacity(targetEvent.capacity, demand, groupSize);

  if (hasRoom || adminOverride) {
    return { eligible: true, reason: null, resultingStatus: 'confirmed' };
  }
  // Confirmed registrants may only move into sessions with open capacity — not onto a waitlist.
  if (registration.status === 'confirmed') {
    return { eligible: false, reason: 'Target session is full', resultingStatus: null };
  }
  if (targetEvent.enable_waitlist === 1) {
    return { eligible: true, reason: null, resultingStatus: 'waitlisted' };
  }
  return { eligible: false, reason: 'Target session is full', resultingStatus: null };
}

export async function listTransferableSessionsForRegistration(input: {
  registrationId: number;
  adminOverride?: boolean;
}): Promise<TransferableSessionSummary[]> {
  const registration = await getRegistrationById(input.registrationId);
  if (!registration) throw new EventTransferServiceError('Registration not found', 404);

  const sourceEvent = await getEventById(registration.event_id);
  if (!sourceEvent?.transfer_group_id) return [];

  const siblings = await listEventsInTransferGroup(sourceEvent.transfer_group_id, sourceEvent.id);
  const nowMs = Date.now();
  const { getOpenSpots } = await import('./eventWaitlistService.js');
  const { db, schema } = getDrizzleDb();

  const summaries: TransferableSessionSummary[] = [];
  for (const siblingRow of siblings) {
    const targetEvent = await getEventById(siblingRow.id);
    if (!targetEvent) continue;
    const evaluation = await evaluateTransferTarget({
      registration,
      sourceEvent,
      targetEvent,
      adminOverride: input.adminOverride === true,
      nowMs,
    });
    const timespans = await db
      .select()
      .from(schema.eventTimespans)
      .where(eq(schema.eventTimespans.event_id, targetEvent.id))
      .orderBy(asc(schema.eventTimespans.sort_order));
    summaries.push({
      eventId: targetEvent.id,
      title: targetEvent.title,
      slug: targetEvent.slug,
      timespans: timespans.map((ts) => ({
        start_dt: ts.start_dt,
        end_dt: ts.end_dt,
        sort_order: ts.sort_order,
      })),
      openSpots: await getOpenSpots(targetEvent.id, targetEvent.capacity),
      waitlistEnabled: targetEvent.enable_waitlist === 1,
      eligible: evaluation.eligible,
      ineligibleReason: evaluation.reason,
      resultingStatus: evaluation.resultingStatus,
    });
  }

  return summaries.sort((a, b) => {
    const aStart = a.timespans[0]?.start_dt ?? '';
    const bStart = b.timespans[0]?.start_dt ?? '';
    return aStart.localeCompare(bStart) || a.title.localeCompare(b.title);
  });
}

export async function transferRegistration(input: {
  registrationId: number;
  targetEventId: number;
  adminOverride?: boolean;
}): Promise<{
  registrationId: number;
  sourceEventId: number;
  targetEventId: number;
  status: EventRegistrationStatus;
  waitlistPosition: number | null;
  accessToken: string | null;
}> {
  const { db, schema } = getDrizzleDb();
  const registration = await getRegistrationById(input.registrationId);
  if (!registration) throw new EventTransferServiceError('Registration not found', 404);

  const sourceEvent = await getEventById(registration.event_id);
  if (!sourceEvent) throw new EventTransferServiceError('Source event not found', 404);

  const targetEvent = await getEventById(input.targetEventId);
  if (!targetEvent) throw new EventTransferServiceError('Target event not found', 404);

  const evaluation = await evaluateTransferTarget({
    registration,
    sourceEvent,
    targetEvent,
    adminOverride: input.adminOverride === true,
    nowMs: Date.now(),
  });
  if (!evaluation.eligible || !evaluation.resultingStatus) {
    throw new EventTransferServiceError(evaluation.reason || 'Cannot move registration to that session', 400);
  }

  const sourceFieldIdByKey = new Map<string, number>(
    (sourceEvent.registrationFields || []).map((f: any) => [f.field_key as string, f.id as number]),
  );
  const targetFieldIdByKey = new Map<string, number>(
    (targetEvent.registrationFields || []).map((f: any) => [f.field_key as string, f.id as number]),
  );

  const existingValues = await db
    .select()
    .from(schema.eventRegistrationFieldValues)
    .where(eq(schema.eventRegistrationFieldValues.registration_id, registration.id));

  const remappedValues: Array<{
    registration_id: number;
    field_id: number;
    registration_member_id: number | null;
    value: string | null;
  }> = [];

  for (const value of existingValues) {
    let sourceKey: string | null = null;
    for (const [key, id] of sourceFieldIdByKey) {
      if (id === value.field_id) {
        sourceKey = key;
        break;
      }
    }
    if (!sourceKey) continue;
    const targetFieldId = targetFieldIdByKey.get(sourceKey);
    if (targetFieldId == null) continue; // drop obsolete optional fields
    remappedValues.push({
      registration_id: registration.id,
      field_id: targetFieldId,
      registration_member_id: value.registration_member_id,
      value: value.value,
    });
  }

  // Ensure required target fields that had source values are present (already checked by compatibility).

  const { resolvePendingOfferForRegistration } = await import('./eventWaitlistService.js');
  if (registration.status === 'waitlisted') {
    await resolvePendingOfferForRegistration(registration.id, 'manager').catch(() => {});
  }

  // Also supersede any pending offer tied to this registration on the source event.
  await db
    .update(schema.eventWaitlistOffers)
    .set({ status: 'superseded' as any, resolved_at: new Date() as any })
    .where(
      and(
        eq(schema.eventWaitlistOffers.registration_id, registration.id),
        eq(schema.eventWaitlistOffers.status, 'pending' as any),
      ),
    );

  let waitlistPosition: number | null = null;
  const nextStatus = evaluation.resultingStatus;
  if (nextStatus === 'waitlisted') {
    waitlistPosition = await nextWaitlistPosition(targetEvent.id);
  }

  await db
    .delete(schema.eventRegistrationFieldValues)
    .where(eq(schema.eventRegistrationFieldValues.registration_id, registration.id));

  if (remappedValues.length > 0) {
    await db.insert(schema.eventRegistrationFieldValues).values(remappedValues);
  }

  await db
    .update(schema.eventRegistrations)
    .set({
      event_id: targetEvent.id,
      status: nextStatus as any,
      waitlist_position: waitlistPosition,
      special_link_id: null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    } as Record<string, unknown>)
    .where(eq(schema.eventRegistrations.id, registration.id));

  return {
    registrationId: registration.id,
    sourceEventId: sourceEvent.id,
    targetEventId: targetEvent.id,
    status: nextStatus,
    waitlistPosition,
    accessToken: registration.access_token ?? null,
  };
}

export async function listTransferableSessionsForAccessToken(accessToken: string): Promise<TransferableSessionSummary[]> {
  const { getRegistrationByAccessToken } = await import('./eventService.js');
  const registration = await getRegistrationByAccessToken(accessToken);
  if (!registration) throw new EventTransferServiceError('Registration not found', 404);
  return listTransferableSessionsForRegistration({
    registrationId: registration.id,
    adminOverride: false,
  });
}

export async function transferRegistrationByAccessToken(input: {
  accessToken: string;
  targetEventId: number;
}) {
  const { getRegistrationByAccessToken } = await import('./eventService.js');
  const registration = await getRegistrationByAccessToken(input.accessToken);
  if (!registration) throw new EventTransferServiceError('Registration not found', 404);
  return transferRegistration({
    registrationId: registration.id,
    targetEventId: input.targetEventId,
    adminOverride: false,
  });
}
