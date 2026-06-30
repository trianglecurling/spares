import { eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { createPaymentService, PaymentServiceError } from './paymentService.js';

export type EventRegistrationRefundResult = {
  refundIssued: boolean;
  refundStatus: string | null;
  refundError: string | null;
};

const REFUNDABLE_ORDER_STATUSES = new Set(['succeeded', 'partially_refunded']);

export async function issueEventRegistrationRefund(input: {
  paymentOrderId: number;
  reason: string;
  requestedByMemberId?: number | null;
  surfaceIneligibleError?: boolean;
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
