import { eq } from 'drizzle-orm';
import { getDrizzleDb } from '../../db/drizzle-db.js';
import { getCurrentTimeAsync } from '../../utils/time.js';
import { processAllNotificationsForRequest } from '../../services/notificationProcessor.js';
import {
  getPublicSpareRecipients,
  getSpareRequestCcMemberIds,
  type PublicSpareRecipientPools,
} from './queries/publicSpareRecipients.js';
import { initialPublicListingAt, isUrgentSpareRequest } from './spareByePriorityLogic.js';
import { getSpareSettings } from './spareSettings.js';
import { config } from '../../config.js';

export type StartPublicSpareNotificationsResult = {
  notificationsQueued: number;
  notificationStatus: 'in_progress' | 'completed';
  notificationMode: 'immediate' | 'staggered' | 'none';
  byeRecipientCount: number;
  pools: PublicSpareRecipientPools;
};

/**
 * Shared public notification start used by create, make-public, and re-issue.
 * - Builds recipient pools (league-scoped, CC-excluded, unavailable filtered, bye prioritized)
 * - Enqueues bye first, then randomized others
 * - Urgent (game within the urgent threshold): drain immediately; dashboard listing is immediate
 * - Otherwise: bye batch first (no inter-bye delay), then the bye window, then staggered rest
 */
export async function startPublicSpareNotifications(params: {
  spareRequestId: number;
  leagueId: number;
  gameDate: string;
  gameTime: string;
  position: string | null | undefined;
  requesterId: number;
  /** Extra IDs to exclude (e.g. known CC ids before they are persisted). */
  excludeMemberIds?: number[];
  /** When true, also load persisted CC rows for this request. */
  includePersistedCcs?: boolean;
  clearHadCancellation?: boolean;
}): Promise<StartPublicSpareNotificationsResult> {
  const { db, schema } = getDrizzleDb();
  const now = await getCurrentTimeAsync();
  const settings = await getSpareSettings();
  const isUrgent = isUrgentSpareRequest({
    gameDate: params.gameDate,
    gameTime: params.gameTime,
    now,
    timeZone: config.timeZone,
    urgentThresholdHours: settings.urgentThresholdHours,
  });

  const persistedCcIds = params.includePersistedCcs
    ? await getSpareRequestCcMemberIds(params.spareRequestId)
    : [];
  const excludeMemberIds = [
    ...new Set([...(params.excludeMemberIds ?? []), ...persistedCcIds]),
  ];

  const pools = await getPublicSpareRecipients({
    leagueId: params.leagueId,
    gameDate: params.gameDate,
    gameTime: params.gameTime,
    position: params.position,
    requesterId: params.requesterId,
    excludeMemberIds,
  });

  await db
    .delete(schema.spareRequestNotificationQueue)
    .where(eq(schema.spareRequestNotificationQueue.spare_request_id, params.spareRequestId));

  const ordered = pools.orderedRecipients;
  const publicListingAt = initialPublicListingAt({
    now,
    isUrgent,
    hasByePriority: pools.byeRecipients.length > 0,
  });

  if (ordered.length === 0) {
    await db
      .update(schema.spareRequests)
      .set({
        notification_status: 'completed',
        next_notification_at: null,
        notification_paused: 0,
        public_listing_at: publicListingAt,
        ...(params.clearHadCancellation ? { had_cancellation: 0 } : {}),
      })
      .where(eq(schema.spareRequests.id, params.spareRequestId));

    return {
      notificationsQueued: 0,
      notificationStatus: 'completed',
      notificationMode: 'none',
      byeRecipientCount: 0,
      pools,
    };
  }

  await db.insert(schema.spareRequestNotificationQueue).values(
    ordered.map((recipient, index) => ({
      spare_request_id: params.spareRequestId,
      member_id: recipient.id,
      queue_order: index,
      is_bye_priority: recipient.isByePriority ? 1 : 0,
      was_delivered: 0,
    })),
  );

  await db
    .update(schema.spareRequests)
    .set({
      notification_status: 'in_progress',
      next_notification_at: now,
      notification_paused: 0,
      public_listing_at: publicListingAt,
      notification_processor_id: config.notificationProcessorId,
      // Do not stamp notifications_sent_at here — only when the queue finishes.
      ...(params.clearHadCancellation ? { had_cancellation: 0 } : {}),
    })
    .where(eq(schema.spareRequests.id, params.spareRequestId));

  if (isUrgent) {
    processAllNotificationsForRequest(params.spareRequestId).catch((error) => {
      console.error(
        `[Spare Request] Error processing immediate notifications for ${params.spareRequestId}:`,
        error,
      );
    });

    return {
      notificationsQueued: ordered.length,
      notificationStatus: 'in_progress',
      notificationMode: 'immediate',
      byeRecipientCount: pools.byeRecipients.length,
      pools,
    };
  }

  return {
    notificationsQueued: ordered.length,
    notificationStatus: 'in_progress',
    notificationMode: 'staggered',
    byeRecipientCount: pools.byeRecipients.length,
    pools,
  };
}
