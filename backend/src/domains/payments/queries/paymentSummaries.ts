import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../../../db/drizzle-db.js';

export async function getRegistrationPaymentSummary(paymentOrderId: number | null) {
  if (!paymentOrderId) return null;

  const { db, schema } = getDrizzleDb();
  const [order] = await db
    .select({
      id: schema.paymentOrders.id,
      provider: schema.paymentOrders.provider,
      amount_minor: schema.paymentOrders.amount_minor,
      currency: schema.paymentOrders.currency,
      status: schema.paymentOrders.status,
      provider_order_id: schema.paymentOrders.provider_order_id,
      created_at: schema.paymentOrders.created_at,
      completed_at: schema.paymentOrders.completed_at,
    })
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.id, paymentOrderId))
    .limit(1);

  if (!order) return null;

  const [paymentTransactions, refunds, refundTotalRows] = await Promise.all([
    db
      .select({
        provider_transaction_id: schema.paymentTransactions.provider_transaction_id,
        transaction_type: schema.paymentTransactions.transaction_type,
        amount_minor: schema.paymentTransactions.amount_minor,
        status: schema.paymentTransactions.status,
        occurred_at: schema.paymentTransactions.occurred_at,
      })
      .from(schema.paymentTransactions)
      .where(
        and(
          eq(schema.paymentTransactions.payment_order_id, paymentOrderId),
          inArray(schema.paymentTransactions.transaction_type, ['charge', 'capture']),
        ),
      )
      .orderBy(desc(schema.paymentTransactions.created_at), desc(schema.paymentTransactions.id))
      .limit(1),
    db
      .select({
        status: schema.refunds.status,
        amount_minor: schema.refunds.amount_minor,
        provider_refund_id: schema.refunds.provider_refund_id,
        processed_at: schema.refunds.processed_at,
        created_at: schema.refunds.created_at,
      })
      .from(schema.refunds)
      .where(eq(schema.refunds.payment_order_id, paymentOrderId))
      .orderBy(desc(schema.refunds.created_at), desc(schema.refunds.id))
      .limit(1),
    db
      .select({
        refunded_minor: sql<number>`COALESCE(SUM(${schema.refunds.amount_minor}), 0)`,
      })
      .from(schema.refunds)
      .where(and(eq(schema.refunds.payment_order_id, paymentOrderId), eq(schema.refunds.status, 'succeeded')))
      .limit(1),
  ]);

  const latestPaymentTransaction = paymentTransactions[0] ?? null;
  const latestRefund = refunds[0] ?? null;
  const refundTotals = refundTotalRows[0] ?? null;

  const inferredPaidMinor =
    latestPaymentTransaction?.status === 'succeeded' ? latestPaymentTransaction.amount_minor : null;
  const paidByOrderStatus = ['succeeded', 'refunded', 'partially_refunded'].includes(order.status)
    ? order.amount_minor
    : null;
  const paid_minor = inferredPaidMinor ?? paidByOrderStatus;

  return {
    order_id: order.id,
    provider: order.provider,
    status: order.status,
    amount_minor: order.amount_minor,
    currency: order.currency,
    paid_minor,
    refunded_minor: Number(refundTotals?.refunded_minor ?? 0),
    provider_order_id: order.provider_order_id,
    created_at: order.created_at,
    completed_at: order.completed_at,
    latest_transaction: latestPaymentTransaction ?? null,
    latest_refund: latestRefund ?? null,
  };
}
