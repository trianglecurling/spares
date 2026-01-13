import { getDrizzleDb } from '../db/drizzle-db.js';
import { sendSpareRequestEmail } from './email.js';
import { sendSpareRequestSMS } from './sms.js';
import { generateEmailLinkToken } from '../utils/auth.js';
import { getCurrentTime, getCurrentTimestamp, getCurrentTimeAsync } from '../utils/time.js';
import { eq, and, or, sql, asc, isNull, isNotNull, lte, lt } from 'drizzle-orm';
import { Member } from '../types.js';

let lastDbErrorLogAt = 0;
const DB_ERROR_LOG_THROTTLE_MS = 30_000;

function isTransientDbDisconnectError(error: unknown): boolean {
  const msg = String((error as any)?.cause?.message ?? (error as any)?.message ?? '');
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

interface NotificationQueueItem {
  id: number;
  spare_request_id: number;
  member_id: number;
  queue_order: number;
  notified_at: string | null;
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
}


/**
 * Processes the next notification in the queue for staggered notifications.
 * This function should be called periodically (e.g., every minute) to process pending notifications.
 */
export async function processNextNotification(): Promise<void> {
  try {
    const { db, schema } = getDrizzleDb();
    const now = await getCurrentTimeAsync();

    // Ensure now is a Date object - Drizzle PostgreSQL timestamp columns require Date objects
    // getCurrentTime() should always return a Date, but we'll be defensive
    let nowDate: Date;
    if (now instanceof Date && !isNaN(now.getTime())) {
      nowDate = now;
    } else {
      // Fallback: create a new Date
      console.warn('getCurrentTime() did not return a valid Date, using current time');
      nowDate = new Date();
    }

    // Double-check it's a valid Date object with toISOString method
    if (typeof nowDate.toISOString !== 'function') {
      console.error('nowDate is not a valid Date object, creating new Date');
      nowDate = new Date();
    }

    // Find spare requests that need the next notification sent
    // Conditions:
    // 1. Status is 'open' (not filled or cancelled)
    // 2. notification_status is 'in_progress' (staggered notifications active)
    // 3. notification_paused is 0 (not paused)
    // 4. next_notification_at is in the past or null
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
      .orderBy(
        sql`${schema.spareRequests.next_notification_at} ASC NULLS FIRST`
      )
      .limit(1) as SpareRequest[];

    if (pendingRequests.length === 0) {
      return; // Nothing to process
    }

    const spareRequest = pendingRequests[0];

    // Get the next member in the queue who hasn't been notified yet.
    // Note: We also support "claimed_at" to avoid duplicate sends when multiple processors are running.
    // If a process crashes after claiming, the claim expires and can be retried.
    const claimTimeoutMs = 10 * 60 * 1000; // 10 minutes
    const claimExpiredBefore = new Date(nowDate.getTime() - claimTimeoutMs);

    const nextInQueueResults = await db
      .select({
        queue_id: schema.spareRequestNotificationQueue.id,
        spare_request_id: schema.spareRequestNotificationQueue.spare_request_id,
        member_id: schema.spareRequestNotificationQueue.member_id,
        queue_order: schema.spareRequestNotificationQueue.queue_order,
        claimed_at: (schema.spareRequestNotificationQueue as any).claimed_at,
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
            isNull((schema.spareRequestNotificationQueue as any).claimed_at),
            lt((schema.spareRequestNotificationQueue as any).claimed_at, claimExpiredBefore)
          )!
        )
      )
      .orderBy(asc(schema.spareRequestNotificationQueue.queue_order))
      .limit(1);

    const nextInQueue = nextInQueueResults[0] as {
      queue_id: number;
      spare_request_id: number;
      member_id: number;
      queue_order: number;
      claimed_at: any;
      notified_at: string | null;
      id: number;
      name: string;
      email: string | null;
      phone: string | null;
      opted_in_sms: number;
    } | undefined;

    if (!nextInQueue) {
      // No more members to notify - mark as complete
      await db
        .update(schema.spareRequests)
        .set({
          notification_status: 'completed',
          next_notification_at: null,
        })
        .where(eq(schema.spareRequests.id, spareRequest.id));
      return;
    }

    // Get requester details
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

    // Claim the queue item BEFORE sending to prevent duplicate sends across multiple processors.
    const claimedRows = await db
      .update(schema.spareRequestNotificationQueue)
      .set({ claimed_at: nowDate })
      .where(
        and(
          eq(schema.spareRequestNotificationQueue.id, nextInQueue.queue_id),
          isNull(schema.spareRequestNotificationQueue.notified_at),
          or(
            isNull((schema.spareRequestNotificationQueue as any).claimed_at),
            lt((schema.spareRequestNotificationQueue as any).claimed_at, claimExpiredBefore)
          )!
        )
      )
      .returning({ id: schema.spareRequestNotificationQueue.id });

    if (!claimedRows || claimedRows.length === 0) {
      // Another processor claimed it first.
      return;
    }

    // Send notification to this member
    console.log(`[Notification Processor] Sending notification to member ${nextInQueue.member_id} (${nextInQueue.name}) for request ${spareRequest.id}`);

    try {
      // League name (optional; older requests may not have league_id)
      let leagueName: string | undefined;
      if ((spareRequest as any).league_id) {
        const leagueRows = await db
          .select({ name: schema.leagues.name })
          .from(schema.leagues)
          .where(eq(schema.leagues.id, (spareRequest as any).league_id))
          .limit(1);
        leagueName = leagueRows[0]?.name || undefined;
      }

      if (nextInQueue.email) {
        // Generate token using member object (need to construct it from the query result)
        // Match the Member interface from types.ts
        const memberForToken = {
          id: nextInQueue.id,
          name: nextInQueue.name,
          email: nextInQueue.email,
          phone: nextInQueue.phone,
          is_admin: 0, // Not admin for spare requests
          first_login_completed: 1, // Assuming first login completed
          opted_in_sms: nextInQueue.opted_in_sms,
          email_subscribed: 1, // Assuming subscribed if email is present
          email_visible: 0,
          phone_visible: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Member;
        const acceptToken = generateEmailLinkToken(memberForToken);
        console.log(`[Notification Processor] Calling sendSpareRequestEmail for ${nextInQueue.email} (request ${spareRequest.id})`);
        await sendSpareRequestEmail(
          nextInQueue.email,
          nextInQueue.name,
          requester.name,
          {
            leagueName,
            requestedForName: spareRequest.requested_for_name,
            gameDate: spareRequest.game_date,
            gameTime: spareRequest.game_time,
            position: spareRequest.position || undefined,
            message: spareRequest.message || undefined,
          },
          acceptToken,
          spareRequest.id
        );
        console.log(`[Notification Processor] Email function completed for ${nextInQueue.email}`);
      }

      if (nextInQueue.phone && nextInQueue.opted_in_sms === 1) {
        await sendSpareRequestSMS(
          nextInQueue.phone,
          requester.name,
          spareRequest.game_date,
          spareRequest.game_time
        );
        console.log(`[Notification Processor] SMS sent to ${nextInQueue.phone}`);
      }

      // Mark this member as notified (and clear claim)
      await db
        .update(schema.spareRequestNotificationQueue)
        .set({ notified_at: nowDate, claimed_at: null })
        .where(eq(schema.spareRequestNotificationQueue.id, nextInQueue.queue_id));

      console.log(`[Notification Processor] Marked queue item ${nextInQueue.queue_id} (member ${nextInQueue.member_id}) as notified`);
    } catch (error) {
      // Clear claim so it can be retried later.
      await db
        .update(schema.spareRequestNotificationQueue)
        .set({ claimed_at: null })
        .where(eq(schema.spareRequestNotificationQueue.id, nextInQueue.queue_id));
      throw error;
    }

    // Check if request is still open (might have been filled while we were processing)
    const currentStatusResults = await db
      .select({ status: schema.spareRequests.status })
      .from(schema.spareRequests)
      .where(eq(schema.spareRequests.id, spareRequest.id))
      .limit(1);
    
    const currentStatus = currentStatusResults[0] as { status: string } | undefined;

    if (currentStatus?.status !== 'open') {
      // Request was filled or cancelled - stop notifications
      await db
        .update(schema.spareRequests)
        .set({
          notification_status: 'stopped',
          next_notification_at: null,
        })
        .where(eq(schema.spareRequests.id, spareRequest.id));
      return;
    }

    // Schedule next notification based on configured delay
    const configResults = await db
      .select({ notification_delay_seconds: schema.serverConfig.notification_delay_seconds })
      .from(schema.serverConfig)
      .where(eq(schema.serverConfig.id, 1))
      .limit(1);
    
    const config = configResults[0] as { notification_delay_seconds: number | null } | undefined;
    
    const delaySeconds = config?.notification_delay_seconds ?? 180; // Default to 3 minutes (180 seconds)
    let nextNotificationTime = new Date(nowDate.getTime() + delaySeconds * 1000);
    // Ensure nextNotificationTime is a valid Date object
    if (!(nextNotificationTime instanceof Date) || isNaN(nextNotificationTime.getTime())) {
      console.error('Invalid nextNotificationTime, using current time');
      nextNotificationTime = new Date();
    }
    // Drizzle PostgreSQL timestamp columns require Date objects (not strings)
    // Ensure it has the toISOString method
    if (typeof nextNotificationTime.toISOString !== 'function') {
      console.error('nextNotificationTime missing toISOString method, creating new Date');
      nextNotificationTime = new Date();
    }
    await db
      .update(schema.spareRequests)
      .set({ next_notification_at: nextNotificationTime })
      .where(eq(schema.spareRequests.id, spareRequest.id));
  } catch (error) {
    // If the DB connection drops (restart / idle timeout), this interval will spam logs.
    // Throttle these errors and just retry on the next interval.
    if (isTransientDbDisconnectError(error)) {
      const nowMs = Date.now();
      if (nowMs - lastDbErrorLogAt > DB_ERROR_LOG_THROTTLE_MS) {
        lastDbErrorLogAt = nowMs;
        console.warn('[Notification Processor] DB unavailable; will retry.');
      }
      return;
    }

    // For non-transient errors, keep the original behavior (surface the error).
    throw error;
  }
}

/**
 * Starts the notification processor interval.
 * Call this once when the server starts.
 */
export function startNotificationProcessor(): void {
  // Process notifications every 5 seconds to handle any configured delay
  // This ensures we can process notifications even with very short delays (e.g., 10 seconds)
  setInterval(() => {
    processNextNotification().catch((error) => {
      console.error('Error in notification processor:', error);
    });
  }, 5 * 1000); // Check every 5 seconds

  console.log('Notification processor started (checking every 5 seconds)');
}

