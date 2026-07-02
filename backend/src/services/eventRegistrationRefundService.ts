import { eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { createPaymentService, PaymentServiceError } from './paymentService.js';

export type EventRegistrationRefundResult = {
  refundIssued: boolean;
  refundStatus: string | null;
  refundError: string | null;
};

const REFUNDABLE_ORDER_STATUSES = new Set(['succeeded', 'partially_refunded']);

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

export async function issueEventRegistrationRefund(input: {
  paymentOrderId: number;
  reason: string;
  requestedByMemberId?: number | null;
  surfaceIneligibleError?: boolean;
  bypassEligibility?: boolean;
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

  try {
    const refundResult = await createPaymentService().createRefundForOrder({
      orderId: order.id,
      reason: input.reason,
      requestedByMemberId: input.requestedByMemberId,
    });
    const refundIssued =
      refundResult.status === 'succeeded' || refundResult.status === 'processing';
    return {
      refundIssued,
      refundStatus: refundResult.status,
      refundError: null,
    };
  } catch (err) {
    return {
      refundIssued: false,
      refundStatus: null,
      refundError: err instanceof PaymentServiceError ? err.message : 'Failed to issue refund',
    };
  }
}
