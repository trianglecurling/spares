import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { getCurrentTimeAsync } from '../utils/time.js';

export type SpareDeliveryChannel = 'email' | 'sms';

export interface SpareDeliveryKey {
  spareRequestId: number;
  memberId: number;
  notificationGeneration: number;
  channel: SpareDeliveryChannel;
  kind: string;
}

/**
 * Idempotency guard for notifications: claims a (request, member, generation, channel, kind) key,
 * runs the sender, then marks it sent. If another process tries the same key concurrently,
 * only one will win the claim.
 *
 * Important: We allow retries if a prior claim is "stuck" (process crash) by expiring claims.
 */
export async function sendOnceWithDeliveryClaim(
  key: SpareDeliveryKey,
  send: () => Promise<void>,
  options?: { claimTimeoutMs?: number }
): Promise<boolean> {
  const claimTimeoutMs = options?.claimTimeoutMs ?? 10 * 60 * 1000; // 10 minutes
  const { db, schema } = getDrizzleDb();

  // Defensive: if the table isn't present (partially migrated DB), fail open rather than breaking notifications.
  if (!schema.spareRequestNotificationDeliveries) {
    await send();
    return true;
  }

  const deliveries = schema.spareRequestNotificationDeliveries;
  const now = await getCurrentTimeAsync();
  const nowDate = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
  const claimExpiredBefore = new Date(nowDate.getTime() - claimTimeoutMs);

  // Ensure a row exists for this key (do-nothing on conflict).
  try {
    await db
      .insert(deliveries)
      .values({
        spare_request_id: key.spareRequestId,
        member_id: key.memberId,
        notification_generation: key.notificationGeneration,
        channel: key.channel,
        kind: key.kind,
      })
      .onConflictDoNothing();
  } catch (e) {
    // If we can't write the idempotency row for any reason, do not block sending.
    await send();
    return true;
  }

  // Claim the delivery if not already sent and not currently claimed (or claim expired).
  const claimedRows = await db
    .update(deliveries)
    .set({ claimed_at: nowDate })
    .where(
      and(
        eq(deliveries.spare_request_id, key.spareRequestId),
        eq(deliveries.member_id, key.memberId),
        eq(deliveries.notification_generation, key.notificationGeneration),
        eq(deliveries.channel, key.channel),
        eq(deliveries.kind, key.kind),
        isNull(deliveries.sent_at),
        or(isNull(deliveries.claimed_at), lt(deliveries.claimed_at, claimExpiredBefore))!
      )
    )
    .returning({ id: deliveries.id });

  if (!claimedRows || claimedRows.length === 0) {
    return false; // already sent or another process is sending it
  }

  const deliveryId = claimedRows[0].id as number;

  try {
    await send();
    await db
      .update(deliveries)
      .set({ sent_at: nowDate, claimed_at: null })
      .where(eq(deliveries.id, deliveryId));
    return true;
  } catch (e) {
    // Clear claim so it can be retried.
    await db
      .update(deliveries)
      .set({ claimed_at: null })
      .where(eq(deliveries.id, deliveryId));
    throw e;
  }
}

