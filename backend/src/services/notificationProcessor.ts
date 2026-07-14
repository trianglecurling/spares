import { getDrizzleDb } from '../db/drizzle-db.js';
import { sendSpareRequestEmail } from './email.js';
import { sendSpareRequestSMS } from './sms.js';
import { getCurrentTimeAsync } from '../utils/time.js';
import { eq, and, or, sql, asc, isNull, lte, lt } from 'drizzle-orm';
import { sendOnceWithDeliveryClaim } from './spareRequestDelivery.js';
import { BYE_PRIORITY_WAIT_MS } from '../domains/spares/spareNotificationConstants.js';
import { decideAfterQueueSend } from '../domains/spares/spareByePriorityLogic.js';

let lastDbErrorLogAt = 0;
const DB_ERROR_LOG_THROTTLE_MS = 30_000;

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
  next_notification_at: string | null;
  notification_generation?: number | null;
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

async function sendQueueMemberNotification(params: {
  spareRequest: SpareRequest;
  nextInQueue: QueueMemberRow;
  requesterName: string;
  nowDate: Date;
}): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const { spareRequest, nextInQueue, requesterName, nowDate } = params;
  const generation = Number(spareRequest.notification_generation ?? 0);

  let leagueName: string | undefined;
  if (spareRequest.league_id) {
    const leagueRows = await db
      .select({ name: schema.leagues.name })
      .from(schema.leagues)
      .where(eq(schema.leagues.id, spareRequest.league_id))
      .limit(1);
    leagueName = leagueRows[0]?.name || undefined;
  }

  const canEmail = Boolean(nextInQueue.email);
  const canSms = Boolean(nextInQueue.phone && nextInQueue.opted_in_sms === 1);
  let delivered = false;

  if (canEmail) {
    const sent = await sendOnceWithDeliveryClaim(
      {
        spareRequestId: spareRequest.id,
        memberId: nextInQueue.member_id,
        notificationGeneration: generation,
        channel: 'email',
        kind: 'spare_request',
      },
      async () => {
        console.log(
          `[Notification Processor] Calling sendSpareRequestEmail for ${nextInQueue.email} (request ${spareRequest.id})`
        );
        await sendSpareRequestEmail(
          nextInQueue.email!,
          nextInQueue.name,
          requesterName,
          {
            leagueName,
            requestedForName: spareRequest.requested_for_name,
            gameDate: spareRequest.game_date,
            gameTime: spareRequest.game_time,
            position: spareRequest.position || undefined,
            message: spareRequest.message || undefined,
          },
          spareRequest.id
        );
        console.log(`[Notification Processor] Email function completed for ${nextInQueue.email}`);
      }
    );
    if (sent) {
      delivered = true;
    } else {
      console.log(
        `[Notification Processor] Skipping duplicate email to ${nextInQueue.email} for request ${spareRequest.id}`
      );
    }
  }

  if (canSms) {
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
          spareRequest.game_date,
          spareRequest.game_time
        );
        console.log(`[Notification Processor] SMS sent to ${nextInQueue.phone}`);
      }
    );
    if (sent) {
      delivered = true;
    } else {
      console.log(
        `[Notification Processor] Skipping duplicate SMS to ${nextInQueue.phone} for request ${spareRequest.id}`
      );
    }
  }

  if (!canEmail && !canSms) {
    console.log(
      `[Notification Processor] Member ${nextInQueue.member_id} has no reachable email/SMS; advancing queue without counting as delivered`
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

  console.log(
    `[Notification Processor] Marked queue item ${nextInQueue.queue_id} (member ${nextInQueue.member_id}) as processed (delivered=${delivered})`
  );

  return delivered;
}

async function scheduleAfterQueueSend(params: {
  spareRequestId: number;
  processedWasByePriority: boolean;
  nowDate: Date;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const { spareRequestId, processedWasByePriority, nowDate } = params;

  const currentStatusResults = await db
    .select({ status: schema.spareRequests.status })
    .from(schema.spareRequests)
    .where(eq(schema.spareRequests.id, spareRequestId))
    .limit(1);
  const currentStatus = currentStatusResults[0] as { status: string } | undefined;

  if (currentStatus?.status !== 'open') {
    await db
      .update(schema.spareRequests)
      .set({
        notification_status: 'completed',
        next_notification_at: null,
      })
      .where(eq(schema.spareRequests.id, spareRequestId));
    return;
  }

  const remainingRows = await db
    .select({
      is_bye_priority: schema.spareRequestNotificationQueue.is_bye_priority,
    })
    .from(schema.spareRequestNotificationQueue)
    .where(
      and(
        eq(schema.spareRequestNotificationQueue.spare_request_id, spareRequestId),
        isNull(schema.spareRequestNotificationQueue.notified_at)
      )
    );

  const configResults = await db
    .select({ notification_delay_seconds: schema.serverConfig.notification_delay_seconds })
    .from(schema.serverConfig)
    .where(eq(schema.serverConfig.id, 1))
    .limit(1);
  const config = configResults[0] as { notification_delay_seconds: number | null } | undefined;
  const delaySeconds = config?.notification_delay_seconds ?? 180;

  const decision = decideAfterQueueSend({
    requestStillOpen: currentStatus?.status === 'open',
    remainingQueue: remainingRows.map((row) => ({ isByePriority: row.is_bye_priority === 1 })),
    processedWasByePriority,
    staggerDelaySeconds: delaySeconds,
    byeWaitMs: BYE_PRIORITY_WAIT_MS,
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

  await db
    .update(schema.spareRequests)
    .set({ next_notification_at: nextNotificationTime })
    .where(eq(schema.spareRequests.id, spareRequestId));
}

/**
 * Processes the next notification in the queue for staggered notifications.
 * This function should be called periodically (e.g., every minute) to process pending notifications.
 */
export async function processNextNotification(): Promise<void> {
  try {
    const { db, schema } = getDrizzleDb();
    const now = await getCurrentTimeAsync();
    const nowDate = toValidDate(now, 'getCurrentTime()');

    const pendingRequests = await db
      .select()
      .from(schema.spareRequests)
      .where(
        and(
          eq(schema.spareRequests.status, 'open'),
          eq(schema.spareRequests.notification_status, 'in_progress'),
          eq(schema.spareRequests.notification_paused, 0),
          or(
            isNull(schema.spareRequests.next_notification_at),
            lte(schema.spareRequests.next_notification_at, nowDate)
          )!
        )
      )
      .orderBy(sql`${schema.spareRequests.next_notification_at} ASC NULLS FIRST`)
      .limit(1) as SpareRequest[];

    if (pendingRequests.length === 0) {
      return;
    }

    const spareRequest = pendingRequests[0];
    const claimTimeoutMs = 10 * 60 * 1000;
    const claimExpiredBefore = new Date(nowDate.getTime() - claimTimeoutMs);

    const nextInQueueResults = await db
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
      .innerJoin(
        schema.members,
        eq(schema.spareRequestNotificationQueue.member_id, schema.members.id)
      )
      .where(
        and(
          eq(schema.spareRequestNotificationQueue.spare_request_id, spareRequest.id),
          isNull(schema.spareRequestNotificationQueue.notified_at),
          or(
            isNull(schema.spareRequestNotificationQueue.claimed_at),
            lt(schema.spareRequestNotificationQueue.claimed_at, claimExpiredBefore)
          )!
        )
      )
      .orderBy(asc(schema.spareRequestNotificationQueue.queue_order))
      .limit(1);

    const nextInQueue = nextInQueueResults[0] as QueueMemberRow | undefined;

    if (!nextInQueue) {
      await markRequestNotificationsCompleted(spareRequest.id, nowDate);
      return;
    }

    const requesters = await db
      .select({ name: schema.members.name })
      .from(schema.members)
      .where(eq(schema.members.id, spareRequest.requester_id))
      .limit(1);

    const requester = requesters[0] as { name: string } | undefined;
    if (!requester) {
      console.error(`Requester not found for spare request ${spareRequest.id}`);
      return;
    }

    const claimedRows = await db
      .update(schema.spareRequestNotificationQueue)
      .set({ claimed_at: nowDate })
      .where(
        and(
          eq(schema.spareRequestNotificationQueue.id, nextInQueue.queue_id),
          isNull(schema.spareRequestNotificationQueue.notified_at),
          or(
            isNull(schema.spareRequestNotificationQueue.claimed_at),
            lt(schema.spareRequestNotificationQueue.claimed_at, claimExpiredBefore)
          )!
        )
      )
      .returning({ id: schema.spareRequestNotificationQueue.id });

    if (!claimedRows || claimedRows.length === 0) {
      return;
    }

    console.log(
      `[Notification Processor] Sending notification to member ${nextInQueue.member_id} (${nextInQueue.name}) for request ${spareRequest.id}`
    );

    try {
      await sendQueueMemberNotification({
        spareRequest,
        nextInQueue,
        requesterName: requester.name,
        nowDate,
      });
    } catch (error) {
      await db
        .update(schema.spareRequestNotificationQueue)
        .set({ claimed_at: null })
        .where(eq(schema.spareRequestNotificationQueue.id, nextInQueue.queue_id));
      throw error;
    }

    await scheduleAfterQueueSend({
      spareRequestId: spareRequest.id,
      processedWasByePriority: nextInQueue.is_bye_priority === 1,
      nowDate,
    });
  } catch (error) {
    if (isTransientDbDisconnectError(error)) {
      const nowMs = Date.now();
      if (nowMs - lastDbErrorLogAt > DB_ERROR_LOG_THROTTLE_MS) {
        lastDbErrorLogAt = nowMs;
        console.warn('[Notification Processor] DB unavailable; will retry.');
      }
      return;
    }

    throw error;
  }
}

/**
 * Processes all notifications for a specific request immediately.
 * Uses the same queue/claim logic but does not wait between sends.
 */
export async function processAllNotificationsForRequest(spareRequestId: number): Promise<void> {
  try {
    const { db, schema } = getDrizzleDb();

    while (true) {
      const now = await getCurrentTimeAsync();
      const nowDate = toValidDate(now, 'getCurrentTime()');

      const spareRequestRows = await db
        .select()
        .from(schema.spareRequests)
        .where(eq(schema.spareRequests.id, spareRequestId))
        .limit(1);
      const spareRequest = spareRequestRows[0] as SpareRequest | undefined;

      if (!spareRequest) {
        return;
      }

      if (spareRequest.status !== 'open') {
        await db
          .update(schema.spareRequests)
          .set({
            notification_status: 'completed',
            next_notification_at: null,
          })
          .where(eq(schema.spareRequests.id, spareRequest.id));
        return;
      }

      const claimTimeoutMs = 10 * 60 * 1000;
      const claimExpiredBefore = new Date(nowDate.getTime() - claimTimeoutMs);

      const nextInQueueResults = await db
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
        .innerJoin(
          schema.members,
          eq(schema.spareRequestNotificationQueue.member_id, schema.members.id)
        )
        .where(
          and(
            eq(schema.spareRequestNotificationQueue.spare_request_id, spareRequest.id),
            isNull(schema.spareRequestNotificationQueue.notified_at),
            or(
              isNull(schema.spareRequestNotificationQueue.claimed_at),
              lt(schema.spareRequestNotificationQueue.claimed_at, claimExpiredBefore)
            )!
          )
        )
        .orderBy(asc(schema.spareRequestNotificationQueue.queue_order))
        .limit(1);

      const nextInQueue = nextInQueueResults[0] as QueueMemberRow | undefined;

      if (!nextInQueue) {
        await markRequestNotificationsCompleted(spareRequest.id, nowDate);
        return;
      }

      const requesters = await db
        .select({ name: schema.members.name })
        .from(schema.members)
        .where(eq(schema.members.id, spareRequest.requester_id))
        .limit(1);

      const requester = requesters[0] as { name: string } | undefined;
      if (!requester) {
        console.error(`Requester not found for spare request ${spareRequest.id}`);
        return;
      }

      const claimedRows = await db
        .update(schema.spareRequestNotificationQueue)
        .set({ claimed_at: nowDate })
        .where(
          and(
            eq(schema.spareRequestNotificationQueue.id, nextInQueue.queue_id),
            isNull(schema.spareRequestNotificationQueue.notified_at),
            or(
              isNull(schema.spareRequestNotificationQueue.claimed_at),
              lt(schema.spareRequestNotificationQueue.claimed_at, claimExpiredBefore)
            )!
          )
        )
        .returning({ id: schema.spareRequestNotificationQueue.id });

      if (!claimedRows || claimedRows.length === 0) {
        continue;
      }

      try {
        await sendQueueMemberNotification({
          spareRequest,
          nextInQueue,
          requesterName: requester.name,
          nowDate,
        });
      } catch (error) {
        await db
          .update(schema.spareRequestNotificationQueue)
          .set({ claimed_at: null })
          .where(eq(schema.spareRequestNotificationQueue.id, nextInQueue.queue_id));
        throw error;
      }
    }
  } catch (error) {
    if (isTransientDbDisconnectError(error)) {
      const nowMs = Date.now();
      if (nowMs - lastDbErrorLogAt > DB_ERROR_LOG_THROTTLE_MS) {
        lastDbErrorLogAt = nowMs;
        console.warn('[Notification Processor] DB unavailable; will retry.');
      }
      return;
    }

    throw error;
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

  console.log('Notification processor started (checking every 5 seconds)');
}
