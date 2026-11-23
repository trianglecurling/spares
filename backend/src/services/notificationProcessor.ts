import { getDrizzleDb } from '../db/drizzle-db.js';
import { sendSpareRequestEmail } from './email.js';
import { sendSpareRequestSMS } from './sms.js';
import { getCurrentTimeAsync } from '../utils/time.js';
import { eq, and, or, sql, asc, isNull, lte, lt, gt, notInArray } from 'drizzle-orm';
import { sendOnceWithDeliveryClaim } from './spareRequestDelivery.js';
import { BATCH_SEND_CONCURRENCY } from '../domains/spares/spareNotificationConstants.js';
import {
  decideAfterQueueSend,
  generalPoolEmailsAllowed,
  hoursUntilSpareGame,
  isByeBatchListingPlaceholder,
  isUrgentSpareRequest,
} from '../domains/spares/spareByePriorityLogic.js';
import { normalizeDateString, normalizeTimeString } from '../domains/spares/spareDateTime.js';
import {
  byePriorityWindowMs,
  getSpareSettings,
  type SpareSettings,
} from '../domains/spares/spareSettings.js';
import { config, DEFAULT_NOTIFICATION_PROCESSOR_ID } from '../config.js';

let lastDbErrorLogAt = 0;
const DB_ERROR_LOG_THROTTLE_MS = 30_000;
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
/** One staggered queue email at a time in this process, so the bye hold is saved before the next row is claimed. */
let notificationProcessorActive = false;
/** Urgent requests currently being sent to everyone; the staggered tick leaves these alone. */
const drainingRequestIds = new Set<number>();

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
    const maybeCause = (error as { cause?: unknown }).cause;
    if (maybeCause instanceof Error) return maybeCause.message;
    if (typeof maybeCause === 'object' && maybeCause !== null) {
      const causeMessage = (maybeCause as { message?: unknown }).message;
      if (typeof causeMessage === 'string') return causeMessage;
    }
  }
  return '';
}

function isTransientDbDisconnectError(error: unknown): boolean {
  const msg = getErrorMessage(error);
  return (
    msg.includes('Connection terminated unexpectedly') ||
    msg.includes('terminating connection') ||
    msg.includes('ECONNRESET') ||
    msg.includes('EPIPE') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('Connection terminated') ||
    msg.includes('Connection refused')
  );
}

function logTransientDbError(): void {
  const nowMs = Date.now();
  if (nowMs - lastDbErrorLogAt > DB_ERROR_LOG_THROTTLE_MS) {
    lastDbErrorLogAt = nowMs;
    console.warn('[Notification Processor] DB unavailable; will retry.');
  }
}

interface SpareRequest {
  id: number;
  requester_id: number;
  league_id: number | null;
  requested_for_name: string;
  game_date: string;
  game_time: string;
  position: string | null;
  message: string | null;
  status: string;
  notification_status: string | null;
  notification_paused?: number | null;
  next_notification_at: string | null;
  notification_generation?: number | null;
  public_listing_at?: Date | string | null;
  notification_processor_id?: string | null;
}

/** Requests started before processor IDs existed have no owner and belong to the default processor. */
function isOwnedByThisProcessor(processorId: string | null | undefined): boolean {
  return (processorId ?? DEFAULT_NOTIFICATION_PROCESSOR_ID) === config.notificationProcessorId;
}

function ownedByThisProcessorCondition() {
  const { schema } = getDrizzleDb();
  const column = schema.spareRequests.notification_processor_id;
  return config.notificationProcessorId === DEFAULT_NOTIFICATION_PROCESSOR_ID
    ? or(isNull(column), eq(column, DEFAULT_NOTIFICATION_PROCESSOR_ID))
    : eq(column, config.notificationProcessorId);
}

type QueueMemberRow = {
  queue_id: number;
  spare_request_id: number;
  member_id: number;
  queue_order: number;
  is_bye_priority: number;
  claimed_at: string | Date | null;
  notified_at: string | null;
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  opted_in_sms: number;
};

function toValidDate(value: Date | unknown, label: string): Date {
  if (value instanceof Date && !isNaN(value.getTime()) && typeof value.toISOString === 'function') {
    return value;
  }
  console.warn(`${label} did not return a valid Date, using current time`);
  return new Date();
}

async function currentDate(): Promise<Date> {
  return toValidDate(await getCurrentTimeAsync(), 'getCurrentTime()');
}

function gameHasStarted(spareRequest: SpareRequest, now: Date): boolean {
  return (
    hoursUntilSpareGame({
      gameDate: normalizeDateString(spareRequest.game_date),
      gameTime: normalizeTimeString(spareRequest.game_time),
      now,
      timeZone: config.timeZone,
    }) <= 0
  );
}

function requestIsUrgent(spareRequest: SpareRequest, now: Date, settings: SpareSettings): boolean {
  return isUrgentSpareRequest({
    gameDate: normalizeDateString(spareRequest.game_date),
    gameTime: normalizeTimeString(spareRequest.game_time),
    now,
    timeZone: config.timeZone,
    urgentThresholdHours: settings.urgentThresholdHours,
  });
}

async function markRequestNotificationsCompleted(spareRequestId: number, nowDate: Date): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.spareRequests)
    .set({
      notifications_sent_at: nowDate,
      notification_status: 'completed',
      next_notification_at: null,
      // Ensure completed requests are listable (e.g. bye-only queues).
      public_listing_at: nowDate,
    })
    .where(eq(schema.spareRequests.id, spareRequestId));
}

async function loadSpareRequest(spareRequestId: number): Promise<SpareRequest | undefined> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.spareRequests)
    .where(eq(schema.spareRequests.id, spareRequestId))
    .limit(1);
  return rows[0] as SpareRequest | undefined;
}

async function loadRequesterName(requesterId: number): Promise<string | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ name: schema.members.name })
    .from(schema.members)
    .where(eq(schema.members.id, requesterId))
    .limit(1);
  return rows[0]?.name ?? null;
}

async function loadLeagueName(leagueId: number | null): Promise<string | undefined> {
  if (!leagueId) return undefined;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ name: schema.leagues.name })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);
  return rows[0]?.name || undefined;
}

async function findNextQueueMember(
  spareRequestId: number,
  nowDate: Date,
  generalPoolAllowed: boolean,
): Promise<QueueMemberRow | undefined> {
  const { db, schema } = getDrizzleDb();
  const claimExpiredBefore = new Date(nowDate.getTime() - CLAIM_TIMEOUT_MS);
  const rows = await db
    .select({
      queue_id: schema.spareRequestNotificationQueue.id,
      spare_request_id: schema.spareRequestNotificationQueue.spare_request_id,
      member_id: schema.spareRequestNotificationQueue.member_id,
      queue_order: schema.spareRequestNotificationQueue.queue_order,
      is_bye_priority: schema.spareRequestNotificationQueue.is_bye_priority,
      claimed_at: schema.spareRequestNotificationQueue.claimed_at,
      notified_at: schema.spareRequestNotificationQueue.notified_at,
      id: schema.members.id,
      name: schema.members.name,
      email: schema.members.email,
      phone: schema.members.phone,
      opted_in_sms: schema.members.opted_in_sms,
    })
    .from(schema.spareRequestNotificationQueue)
    .innerJoin(schema.members, eq(schema.spareRequestNotificationQueue.member_id, schema.members.id))
    .where(
      and(
        eq(schema.spareRequestNotificationQueue.spare_request_id, spareRequestId),
        isNull(schema.spareRequestNotificationQueue.notified_at),
        or(
          isNull(schema.spareRequestNotificationQueue.claimed_at),
          lt(schema.spareRequestNotificationQueue.claimed_at, claimExpiredBefore),
        )!,
        generalPoolAllowed ? undefined : eq(schema.spareRequestNotificationQueue.is_bye_priority, 1),
      ),
    )
    .orderBy(asc(schema.spareRequestNotificationQueue.queue_order))
    .limit(1);
  return rows[0] as QueueMemberRow | undefined;
}

async function claimQueueRow(queueId: number, nowDate: Date): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const claimExpiredBefore = new Date(nowDate.getTime() - CLAIM_TIMEOUT_MS);
  const claimedRows = await db
    .update(schema.spareRequestNotificationQueue)
    .set({ claimed_at: nowDate })
    .where(
      and(
        eq(schema.spareRequestNotificationQueue.id, queueId),
        isNull(schema.spareRequestNotificationQueue.notified_at),
        or(
          isNull(schema.spareRequestNotificationQueue.claimed_at),
          lt(schema.spareRequestNotificationQueue.claimed_at, claimExpiredBefore),
        )!,
      ),
    )
    .returning({ id: schema.spareRequestNotificationQueue.id });
  return Boolean(claimedRows && claimedRows.length > 0);
}

async function releaseQueueClaim(queueId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.spareRequestNotificationQueue)
    .set({ claimed_at: null })
    .where(eq(schema.spareRequestNotificationQueue.id, queueId));
}

async function sendQueueMemberNotification(params: {
  spareRequest: SpareRequest;
  nextInQueue: QueueMemberRow;
  requesterName: string;
  leagueName: string | undefined;
  nowDate: Date;
}): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const { spareRequest, nextInQueue, requesterName, leagueName, nowDate } = params;
  const generation = Number(spareRequest.notification_generation ?? 0);

  const canEmail = Boolean(nextInQueue.email);
  const canSms = Boolean(nextInQueue.phone && nextInQueue.opted_in_sms === 1);
  let delivered = false;

  // A failure for one recipient is logged and skipped so it cannot hold up everyone after them.
  if (canEmail) {
    try {
      const sent = await sendOnceWithDeliveryClaim(
        {
          spareRequestId: spareRequest.id,
          memberId: nextInQueue.member_id,
          notificationGeneration: generation,
          channel: 'email',
          kind: 'spare_request',
        },
        async () => {
          await sendSpareRequestEmail(
            nextInQueue.email!,
            nextInQueue.name,
            requesterName,
            {
              leagueName,
              requestedForName: spareRequest.requested_for_name,
              gameDate: normalizeDateString(spareRequest.game_date),
              gameTime: normalizeTimeString(spareRequest.game_time),
              position: spareRequest.position || undefined,
              message: spareRequest.message || undefined,
            },
            spareRequest.id,
          );
        },
      );
      if (sent) {
        delivered = true;
      } else {
        console.log(
          `[Notification Processor] Skipping duplicate email to member ${nextInQueue.member_id} for request ${spareRequest.id}`,
        );
      }
    } catch (error) {
      if (isTransientDbDisconnectError(error)) throw error;
      console.error(
        `[Notification Processor] Email to member ${nextInQueue.member_id} for request ${spareRequest.id} failed:`,
        error,
      );
    }
  }

  if (canSms) {
    try {
      const sent = await sendOnceWithDeliveryClaim(
        {
          spareRequestId: spareRequest.id,
          memberId: nextInQueue.member_id,
          notificationGeneration: generation,
          channel: 'sms',
          kind: 'spare_request',
        },
        async () => {
          await sendSpareRequestSMS(
            nextInQueue.phone!,
            requesterName,
            normalizeDateString(spareRequest.game_date),
            normalizeTimeString(spareRequest.game_time),
          );
        },
      );
      if (sent) {
        delivered = true;
      } else {
        console.log(
          `[Notification Processor] Skipping duplicate SMS to member ${nextInQueue.member_id} for request ${spareRequest.id}`,
        );
      }
    } catch (error) {
      if (isTransientDbDisconnectError(error)) throw error;
      console.error(
        `[Notification Processor] SMS to member ${nextInQueue.member_id} for request ${spareRequest.id} failed:`,
        error,
      );
    }
  }

  if (!canEmail && !canSms) {
    console.log(
      `[Notification Processor] Member ${nextInQueue.member_id} has no reachable email/SMS; advancing queue without counting as delivered`,
    );
  }

  // Always advance the queue so unreachable members do not block later recipients.
  await db
    .update(schema.spareRequestNotificationQueue)
    .set({
      notified_at: nowDate,
      claimed_at: null,
      was_delivered: delivered ? 1 : 0,
    })
    .where(eq(schema.spareRequestNotificationQueue.id, nextInQueue.queue_id));

  return delivered;
}

async function scheduleAfterQueueSend(params: {
  spareRequestId: number;
  processedWasByePriority: boolean;
  nowDate: Date;
  settings: SpareSettings;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const { spareRequestId, processedWasByePriority, nowDate, settings } = params;

  const currentStatusResults = await db
    .select({ status: schema.spareRequests.status })
    .from(schema.spareRequests)
    .where(eq(schema.spareRequests.id, spareRequestId))
    .limit(1);
  const currentStatus = currentStatusResults[0] as { status: string } | undefined;

  const remainingRows = await db
    .select({
      is_bye_priority: schema.spareRequestNotificationQueue.is_bye_priority,
    })
    .from(schema.spareRequestNotificationQueue)
    .where(
      and(
        eq(schema.spareRequestNotificationQueue.spare_request_id, spareRequestId),
        isNull(schema.spareRequestNotificationQueue.notified_at),
      ),
    );

  const decision = decideAfterQueueSend({
    requestStillOpen: currentStatus?.status === 'open',
    remainingQueue: remainingRows.map((row) => ({ isByePriority: row.is_bye_priority === 1 })),
    processedWasByePriority,
    staggerDelaySeconds: settings.notificationDelaySeconds,
    byeWaitMs: byePriorityWindowMs(settings),
  });

  if (decision.kind === 'stop_request_closed') {
    await db
      .update(schema.spareRequests)
      .set({
        notification_status: 'completed',
        next_notification_at: null,
      })
      .where(eq(schema.spareRequests.id, spareRequestId));
    return;
  }

  if (decision.kind === 'complete') {
    await markRequestNotificationsCompleted(spareRequestId, nowDate);
    return;
  }

  if (decision.kind === 'start_bye_wait') {
    const listingAt = new Date(nowDate.getTime() + decision.waitMs);
    await db
      .update(schema.spareRequests)
      .set({
        next_notification_at: listingAt,
        public_listing_at: listingAt,
      })
      .where(eq(schema.spareRequests.id, spareRequestId));
    return;
  }

  let nextNotificationTime =
    decision.kind === 'continue_bye_immediately'
      ? nowDate
      : new Date(nowDate.getTime() + decision.delaySeconds * 1000);

  if (!(nextNotificationTime instanceof Date) || isNaN(nextNotificationTime.getTime())) {
    nextNotificationTime = new Date();
  }

  if (decision.kind === 'continue_bye_immediately') {
    // Keep the bye batch due now, including when an earlier hold was saved before the last bye-priority email.
    await db
      .update(schema.spareRequests)
      .set({ next_notification_at: nextNotificationTime })
      .where(eq(schema.spareRequests.id, spareRequestId));
    return;
  }

  // Do not let this stagger replace a bye hold that is already further in the future.
  await db
    .update(schema.spareRequests)
    .set({ next_notification_at: nextNotificationTime })
    .where(
      and(
        eq(schema.spareRequests.id, spareRequestId),
        or(
          isNull(schema.spareRequests.next_notification_at),
          lte(schema.spareRequests.next_notification_at, nextNotificationTime),
        )!,
      ),
    );
}

/**
 * The recipient query found nobody it is allowed to email.
 * General-pool members are omitted from that query until public_listing_at.
 * If they are the only people left, save the bye hold instead of treating the list as finished.
 */
async function whenNoEligibleRecipient(
  spareRequestId: number,
  nowDate: Date,
  settings: SpareSettings,
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const remaining = await db
    .select({ is_bye_priority: schema.spareRequestNotificationQueue.is_bye_priority })
    .from(schema.spareRequestNotificationQueue)
    .where(
      and(
        eq(schema.spareRequestNotificationQueue.spare_request_id, spareRequestId),
        isNull(schema.spareRequestNotificationQueue.notified_at),
      ),
    );

  if (remaining.length === 0) {
    await markRequestNotificationsCompleted(spareRequestId, nowDate);
    return;
  }

  if (remaining.some((row) => row.is_bye_priority === 1)) {
    return;
  }

  const listingRows = await db
    .select({ public_listing_at: schema.spareRequests.public_listing_at })
    .from(schema.spareRequests)
    .where(eq(schema.spareRequests.id, spareRequestId))
    .limit(1);
  const listingAt = listingRows[0]?.public_listing_at ?? null;

  if (listingAt == null || isByeBatchListingPlaceholder(listingAt)) {
    const holdEndsAt = new Date(nowDate.getTime() + byePriorityWindowMs(settings));
    await db
      .update(schema.spareRequests)
      .set({
        next_notification_at: holdEndsAt,
        public_listing_at: holdEndsAt,
      })
      .where(eq(schema.spareRequests.id, spareRequestId));
    console.log(
      `[Notification Processor] General-pool emails for request ${spareRequestId} wait until ${holdEndsAt.toISOString()}`,
    );
    return;
  }

  const listingDate = listingAt instanceof Date ? listingAt : new Date(listingAt);
  if (Number.isNaN(listingDate.getTime()) || listingDate.getTime() <= nowDate.getTime()) {
    return;
  }

  await db
    .update(schema.spareRequests)
    .set({ next_notification_at: listingDate })
    .where(
      and(
        eq(schema.spareRequests.id, spareRequestId),
        or(
          isNull(schema.spareRequests.next_notification_at),
          lte(schema.spareRequests.next_notification_at, listingDate),
        )!,
      ),
    );
}

/**
 * Processes the next staggered notification. Called every few seconds.
 * Urgent requests are handed to `processAllNotificationsForRequest` instead, so the
 * bye hold and stagger delay never apply to them (including after a restart, or when
 * a staggered request crosses into the urgent window).
 */
export async function processNextNotification(): Promise<void> {
  if (notificationProcessorActive) {
    return;
  }
  notificationProcessorActive = true;
  try {
    const { db, schema } = getDrizzleDb();
    const nowDate = await currentDate();
    const settings = await getSpareSettings();
    const draining = [...drainingRequestIds];
    const activeConditions = [
      eq(schema.spareRequests.status, 'open'),
      eq(schema.spareRequests.notification_status, 'in_progress'),
      eq(schema.spareRequests.notification_paused, 0),
      ownedByThisProcessorCondition(),
      draining.length > 0 ? notInArray(schema.spareRequests.id, draining) : undefined,
    ];

    // Urgent requests wait for nothing, even if a bye hold or stagger was saved earlier.
    const urgentCandidates = (await db
      .select()
      .from(schema.spareRequests)
      .where(
        and(
          ...activeConditions,
          sql`${schema.spareRequests.game_date} <= ${urgentCutoffDate(nowDate, settings)}`,
        ),
      )
      .orderBy(asc(schema.spareRequests.game_date), asc(schema.spareRequests.game_time))
      .limit(50)) as SpareRequest[];
    for (const row of urgentCandidates) {
      if (gameHasStarted(row, nowDate)) {
        await db
          .update(schema.spareRequests)
          .set({ notification_status: 'completed', next_notification_at: null })
          .where(eq(schema.spareRequests.id, row.id));
      }
    }
    const urgentRequest = urgentCandidates.find(
      (row) => !gameHasStarted(row, nowDate) && requestIsUrgent(row, nowDate, settings),
    );
    if (urgentRequest) {
      processAllNotificationsForRequest(urgentRequest.id).catch((error) => {
        console.error(`[Notification Processor] Urgent send for request ${urgentRequest.id} failed:`, error);
      });
      return;
    }

    const pendingRequests = (await db
      .select()
      .from(schema.spareRequests)
      .where(
        and(
          ...activeConditions,
          or(
            isNull(schema.spareRequests.next_notification_at),
            lte(schema.spareRequests.next_notification_at, nowDate),
          )!,
        ),
      )
      .orderBy(sql`${schema.spareRequests.next_notification_at} ASC NULLS FIRST`)
      .limit(1)) as SpareRequest[];

    const spareRequest = pendingRequests[0];
    if (!spareRequest) {
      return;
    }

    const generalPoolAllowed = generalPoolEmailsAllowed({
      publicListingAt: spareRequest.public_listing_at,
      now: nowDate,
    });

    const nextInQueue = await findNextQueueMember(spareRequest.id, nowDate, generalPoolAllowed);
    if (!nextInQueue) {
      await whenNoEligibleRecipient(spareRequest.id, nowDate, settings);
      return;
    }

    const requesterName = await loadRequesterName(spareRequest.requester_id);
    if (!requesterName) {
      console.error(`Requester not found for spare request ${spareRequest.id}`);
      return;
    }
    const leagueName = await loadLeagueName(spareRequest.league_id);

    // Players on bye are all notified together; the bye window starts once the last of them is sent.
    if (nextInQueue.is_bye_priority === 1) {
      await sendInParallel({
        spareRequestId: spareRequest.id,
        requesterName,
        leagueName,
        byeOnly: true,
      });
      await scheduleAfterQueueSend({
        spareRequestId: spareRequest.id,
        processedWasByePriority: true,
        nowDate: await currentDate(),
        settings,
      });
      return;
    }

    if (!(await claimQueueRow(nextInQueue.queue_id, nowDate))) {
      return;
    }

    try {
      await sendQueueMemberNotification({
        spareRequest,
        nextInQueue,
        requesterName,
        leagueName,
        nowDate,
      });
    } catch (error) {
      await releaseQueueClaim(nextInQueue.queue_id);
      throw error;
    }

    await scheduleAfterQueueSend({
      spareRequestId: spareRequest.id,
      processedWasByePriority: nextInQueue.is_bye_priority === 1,
      nowDate,
      settings,
    });
  } catch (error) {
    if (isTransientDbDisconnectError(error)) {
      logTransientDbError();
      return;
    }
    throw error;
  } finally {
    notificationProcessorActive = false;
  }
}

/** Latest game date that could be inside the urgent window, as YYYY-MM-DD (coarse SQL prefilter). */
function urgentCutoffDate(nowDate: Date, settings: SpareSettings): string {
  const cutoff = new Date(nowDate.getTime() + (settings.urgentThresholdHours + 24) * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
}

type DrainParams = {
  spareRequestId: number;
  requesterName: string;
  leagueName: string | undefined;
  /** Only send to bye-priority rows (the general pool waits for the bye window). */
  byeOnly?: boolean;
};

async function sendInParallel(params: DrainParams): Promise<void> {
  const results = await Promise.allSettled(
    Array.from({ length: BATCH_SEND_CONCURRENCY }, () => drainWorker(params)),
  );
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) throw failure.reason;
}

async function drainWorker(params: DrainParams): Promise<void> {
  const { db, schema } = getDrizzleDb();
  while (true) {
    const nowDate = await currentDate();
    const spareRequest = await loadSpareRequest(params.spareRequestId);
    if (!spareRequest) return;

    if (spareRequest.status !== 'open') {
      await db
        .update(schema.spareRequests)
        .set({ notification_status: 'completed', next_notification_at: null })
        .where(eq(schema.spareRequests.id, spareRequest.id));
      return;
    }
    if (spareRequest.notification_paused === 1) return;

    const nextInQueue = await findNextQueueMember(spareRequest.id, nowDate, !params.byeOnly);
    if (!nextInQueue) return;
    if (!(await claimQueueRow(nextInQueue.queue_id, nowDate))) continue;

    try {
      await sendQueueMemberNotification({
        spareRequest,
        nextInQueue,
        requesterName: params.requesterName,
        leagueName: params.leagueName,
        nowDate,
      });
    } catch (error) {
      await releaseQueueClaim(nextInQueue.queue_id).catch(() => {});
      throw error;
    }
  }
}

/**
 * Sends every remaining notification for an urgent request right away.
 * There is no bye window for urgent requests, so the listing opens immediately and
 * several recipients are notified in parallel.
 */
export async function processAllNotificationsForRequest(spareRequestId: number): Promise<void> {
  if (drainingRequestIds.has(spareRequestId)) return;
  drainingRequestIds.add(spareRequestId);
  try {
    const { db, schema } = getDrizzleDb();
    const settings = await getSpareSettings();
    const startedAt = await currentDate();

    const spareRequest = await loadSpareRequest(spareRequestId);
    if (!spareRequest) return;
    if (!isOwnedByThisProcessor(spareRequest.notification_processor_id)) return;
    if (gameHasStarted(spareRequest, startedAt)) {
      await db
        .update(schema.spareRequests)
        .set({ notification_status: 'completed', next_notification_at: null })
        .where(eq(schema.spareRequests.id, spareRequestId));
      return;
    }

    await db
      .update(schema.spareRequests)
      .set({ public_listing_at: startedAt, next_notification_at: startedAt })
      .where(
        and(
          eq(schema.spareRequests.id, spareRequestId),
          gt(schema.spareRequests.public_listing_at, startedAt),
        ),
      );

    const requesterName = await loadRequesterName(spareRequest.requester_id);
    if (!requesterName) {
      console.error(`Requester not found for spare request ${spareRequestId}`);
      return;
    }
    const leagueName = await loadLeagueName(spareRequest.league_id);

    await sendInParallel({ spareRequestId, requesterName, leagueName });

    const latest = await loadSpareRequest(spareRequestId);
    if (latest?.status === 'open' && latest.notification_paused !== 1) {
      await whenNoEligibleRecipient(spareRequestId, await currentDate(), settings);
    }
  } catch (error) {
    if (isTransientDbDisconnectError(error)) {
      logTransientDbError();
      return;
    }
    throw error;
  } finally {
    drainingRequestIds.delete(spareRequestId);
  }
}

/**
 * Starts the notification processor interval.
 * Call this once when the server starts.
 */
export function startNotificationProcessor(): void {
  setInterval(() => {
    processNextNotification().catch((error) => {
      console.error('Error in notification processor:', error);
    });
  }, 5 * 1000);

  console.log(
    `Notification processor started (checking every 5 seconds, processor ID "${config.notificationProcessorId}")`,
  );
}
