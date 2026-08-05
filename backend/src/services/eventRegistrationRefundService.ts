import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { createPaymentService, PaymentServiceError } from './paymentService.js';

export type EventRegistrationRefundResult = {
  refundIssued: boolean;
  refundStatus: string | null;
  refundError: string | null;
};

const REFUNDABLE_ORDER_STATUS_LIST = ['succeeded', 'partially_refunded'] as const;
const REFUNDABLE_ORDER_STATUSES = new Set<string>(REFUNDABLE_ORDER_STATUS_LIST);

export async function claimEventRegistrationRaceRefund(paymentOrderId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const { sql, and, eq } = await import('drizzle-orm');
  const { getDatabaseConfig } = await import('../db/config.js');
  const claimedAt = new Date().toISOString();
  const isPostgres = getDatabaseConfig()?.type === 'postgres';
  const metadataColumn = schema.paymentOrders.metadata;
  const notClaimedCondition = isPostgres
    ? sql`COALESCE(${metadataColumn}::jsonb->>'eventPaymentRaceRefundClaimedAt', '') = ''`
    : sql`COALESCE(json_extract(COALESCE(${metadataColumn}, '{}'), '$.eventPaymentRaceRefundClaimedAt'), '') = ''`;

  const claimed = await db
    .update(schema.paymentOrders)
    .set({
      metadata: isPostgres
        ? sql`(COALESCE(${metadataColumn}::jsonb, '{}'::jsonb) || jsonb_build_object('eventPaymentRaceRefundClaimedAt', cast(${claimedAt} as text)))::text`
        : sql`json_set(COALESCE(${metadataColumn}, '{}'), '$.eventPaymentRaceRefundClaimedAt', ${claimedAt})`,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(
        eq(schema.paymentOrders.id, paymentOrderId),
        notClaimedCondition,
      ),
    )
    .returning({ id: schema.paymentOrders.id });

  return claimed.length > 0;
}

export async function getPaymentOrderRefundableRemainingMinor(paymentOrderId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const [order] = await db
    .select({
      id: schema.paymentOrders.id,
      amount_minor: schema.paymentOrders.amount_minor,
      status: schema.paymentOrders.status,
    })
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.id, paymentOrderId))
    .limit(1);
  if (!order || !REFUNDABLE_ORDER_STATUSES.has(order.status)) {
    return 0;
  }

  const refundRows = await db
    .select({
      amount_minor: schema.refunds.amount_minor,
      status: schema.refunds.status,
    })
    .from(schema.refunds)
    .where(eq(schema.refunds.payment_order_id, paymentOrderId));

  const consumedMinor = refundRows
    .filter((row) =>
      row.status === 'succeeded' ||
      row.status === 'processing' ||
      row.status === 'requested' ||
      row.status === 'approved',
    )
    .reduce((sum, row) => sum + (row.amount_minor ?? 0), 0);

  return Math.max(0, (order.amount_minor ?? 0) - consumedMinor);
}

/** Net paid (succeeded/partially refunded orders minus refunds) for an event registration. */
export async function getEventRegistrationPaidNetMinor(registrationId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const orders = await db
    .select({ id: schema.paymentOrders.id })
    .from(schema.paymentOrders)
    .where(
      and(
        eq(schema.paymentOrders.subject_type, 'event_registration'),
        eq(schema.paymentOrders.subject_id, registrationId),
        inArray(schema.paymentOrders.status, REFUNDABLE_ORDER_STATUS_LIST),
      ),
    );

  let total = 0;
  for (const order of orders) {
    total += await getPaymentOrderRefundableRemainingMinor(order.id);
  }
  return total;
}

/**
 * Refunds across all paid orders for a registration (primary + balance top-ups),
 * oldest first, until amountMinor is covered or refundable balance is exhausted.
 */
/** Full refund of every refundable payment order for an event registration. */
export async function issueEventRegistrationFullRefund(input: {
  registrationId: number;
  reason: string;
  requestedByMemberId?: number | null;
  surfaceIneligibleError?: boolean;
}): Promise<EventRegistrationRefundResult & { refundAmountMinor: number }> {
  const { db, schema } = getDrizzleDb();
  const orders = await db
    .select({ id: schema.paymentOrders.id })
    .from(schema.paymentOrders)
    .where(
      and(
        eq(schema.paymentOrders.subject_type, 'event_registration'),
        eq(schema.paymentOrders.subject_id, input.registrationId),
        inArray(schema.paymentOrders.status, REFUNDABLE_ORDER_STATUS_LIST),
      ),
    )
    .orderBy(asc(schema.paymentOrders.id));

  if (orders.length === 0) {
    return {
      refundIssued: false,
      refundStatus: null,
      refundError: input.surfaceIneligibleError ? 'No refundable payment found' : null,
      refundAmountMinor: 0,
    };
  }

  let anyIssued = false;
  let refundAmountMinor = 0;
  let lastStatus: string | null = null;
  let lastError: string | null = null;

  for (const order of orders) {
    const available = await getPaymentOrderRefundableRemainingMinor(order.id);
    if (available <= 0) continue;
    const result = await issueEventRegistrationRefund({
      paymentOrderId: order.id,
      reason: input.reason,
      requestedByMemberId: input.requestedByMemberId,
      surfaceIneligibleError: input.surfaceIneligibleError,
    });
    if (result.refundIssued) {
      anyIssued = true;
      lastStatus = result.refundStatus;
      refundAmountMinor += available;
    } else if (result.refundError) {
      lastError = result.refundError;
      break;
    }
  }

  if (anyIssued) {
    return {
      refundIssued: true,
      refundStatus: lastStatus,
      refundError: lastError,
      refundAmountMinor,
    };
  }

  return {
    refundIssued: false,
    refundStatus: null,
    refundError: input.surfaceIneligibleError
      ? lastError ?? 'No refundable balance remains'
      : lastError,
    refundAmountMinor: 0,
  };
}

export async function issueEventRegistrationRefundAmount(input: {
  registrationId: number;
  amountMinor: number;
  reason: string;
  requestedByMemberId?: number | null;
  surfaceIneligibleError?: boolean;
}): Promise<EventRegistrationRefundResult> {
  const requested = Math.max(0, Math.floor(input.amountMinor));
  if (requested <= 0) {
    return { refundIssued: false, refundStatus: null, refundError: null };
  }

  const { db, schema } = getDrizzleDb();
  const orders = await db
    .select({ id: schema.paymentOrders.id })
    .from(schema.paymentOrders)
    .where(
      and(
        eq(schema.paymentOrders.subject_type, 'event_registration'),
        eq(schema.paymentOrders.subject_id, input.registrationId),
        inArray(schema.paymentOrders.status, REFUNDABLE_ORDER_STATUS_LIST),
      ),
    )
    .orderBy(asc(schema.paymentOrders.id));

  let remainingToRefund = requested;
  let anyIssued = false;
  let lastStatus: string | null = null;
  let lastError: string | null = null;

  for (const order of orders) {
    if (remainingToRefund <= 0) break;
    const available = await getPaymentOrderRefundableRemainingMinor(order.id);
    if (available <= 0) continue;
    const chunk = Math.min(remainingToRefund, available);
    const result = await issueEventRegistrationRefund({
      paymentOrderId: order.id,
      amountMinor: chunk,
      reason: input.reason,
      requestedByMemberId: input.requestedByMemberId,
      surfaceIneligibleError: input.surfaceIneligibleError,
    });
    if (result.refundIssued) {
      anyIssued = true;
      lastStatus = result.refundStatus;
      remainingToRefund -= chunk;
    } else if (result.refundError) {
      lastError = result.refundError;
      break;
    }
  }

  if (anyIssued) {
    return { refundIssued: true, refundStatus: lastStatus, refundError: remainingToRefund > 0 ? lastError : null };
  }

  return {
    refundIssued: false,
    refundStatus: null,
    refundError: input.surfaceIneligibleError
      ? lastError ?? 'No refundable balance remains'
      : lastError,
  };
}

export async function issueEventRegistrationRefund(input: {
  paymentOrderId: number;
  reason: string;
  requestedByMemberId?: number | null;
  surfaceIneligibleError?: boolean;
  bypassEligibility?: boolean;
  /** When set, issues a partial refund up to the remaining refundable balance. */
  amountMinor?: number | null;
}): Promise<EventRegistrationRefundResult> {
  const { db, schema } = getDrizzleDb();
  const [order] = await db
    .select({
      id: schema.paymentOrders.id,
      status: schema.paymentOrders.status,
    })
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.id, input.paymentOrderId))
    .limit(1);

  if (!order) {
    return {
      refundIssued: false,
      refundStatus: null,
      refundError: input.surfaceIneligibleError ? 'Payment order not found' : null,
    };
  }

  if (!REFUNDABLE_ORDER_STATUSES.has(order.status)) {
    if (input.bypassEligibility && (order.status === 'refunded' || order.status === 'pending_refund')) {
      return {
        refundIssued: true,
        refundStatus: order.status,
        refundError: null,
      };
    }
    return {
      refundIssued: false,
      refundStatus: null,
      refundError: input.surfaceIneligibleError
        ? `Payment order cannot be refunded from status ${order.status}`
        : null,
    };
  }

  let amountMinor = input.amountMinor ?? null;
  if (amountMinor != null) {
    const remaining = await getPaymentOrderRefundableRemainingMinor(order.id);
    amountMinor = Math.min(Math.max(0, amountMinor), remaining);
    if (amountMinor <= 0) {
      return {
        refundIssued: false,
        refundStatus: null,
        refundError: input.surfaceIneligibleError ? 'No refundable balance remains' : null,
      };
    }
  }

  try {
    const refundResult = await createPaymentService().createRefundForOrder({
      orderId: order.id,
      reason: input.reason,
      requestedByMemberId: input.requestedByMemberId,
      amountMinor,
    });
    const refundIssued =
      refundResult.status === 'succeeded' || refundResult.status === 'processing';
    return {
      refundIssued,
      refundStatus: refundResult.status,
      refundError: null,
    };
  } catch (err) {
    // Prefer PaymentServiceError, but also accept name/message fallbacks — circular imports can
    // break `instanceof` across the payment adapter boundary.
    const message =
      err instanceof PaymentServiceError
        ? err.message
        : err instanceof Error && err.name === 'PaymentServiceError'
          ? err.message
          : err instanceof Error && err.message.trim()
            ? err.message
            : 'Failed to issue refund';
    return {
      refundIssued: false,
      refundStatus: null,
      refundError: message,
    };
  }
}
