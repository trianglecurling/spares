import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../../../db/drizzle-db.js';

export type RegistrationPaymentActivityItem = {
  id: string;
  kind: 'payment' | 'refund';
  orderId: number;
  amountMinor: number;
  currency: string;
  status: string;
  occurredAt: string | null;
  provider: 'stripe' | 'paypal' | 'square';
  providerReference: string | null;
  label: string;
};

function normalizeOccurredAt(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parsePaymentMetadata(metadata: unknown): Record<string, unknown> {
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
}

export async function listCurlingRegistrationPaymentActivity(
  registrationId: number,
): Promise<RegistrationPaymentActivityItem[]> {
  const { db, schema } = getDrizzleDb();
  const [subjectOrders, invoiceOrderRows] = await Promise.all([
    db
      .select({ id: schema.paymentOrders.id })
      .from(schema.paymentOrders)
      .where(
        and(
          eq(schema.paymentOrders.subject_type, 'curling_registration'),
          eq(schema.paymentOrders.subject_id, registrationId),
        ),
      ),
    db
      .select({ paymentOrderId: schema.registrationInvoices.payment_order_id })
      .from(schema.registrationInvoices)
      .where(eq(schema.registrationInvoices.registration_id, registrationId)),
  ]);

  const orderIds = [
    ...new Set([
      ...subjectOrders.map((row) => row.id),
      ...invoiceOrderRows
        .map((row) => row.paymentOrderId)
        .filter((id): id is number => id != null),
    ]),
  ];
  if (orderIds.length === 0) return [];

  const [orders, refunds] = await Promise.all([
    db
      .select({
        id: schema.paymentOrders.id,
        provider: schema.paymentOrders.provider,
        amount_minor: schema.paymentOrders.amount_minor,
        currency: schema.paymentOrders.currency,
        status: schema.paymentOrders.status,
        provider_order_id: schema.paymentOrders.provider_order_id,
        metadata: schema.paymentOrders.metadata,
        completed_at: schema.paymentOrders.completed_at,
        created_at: schema.paymentOrders.created_at,
      })
      .from(schema.paymentOrders)
      .where(inArray(schema.paymentOrders.id, orderIds)),
    db
      .select({
        id: schema.refunds.id,
        payment_order_id: schema.refunds.payment_order_id,
        provider: schema.refunds.provider,
        amount_minor: schema.refunds.amount_minor,
        currency: schema.refunds.currency,
        status: schema.refunds.status,
        reason: schema.refunds.reason,
        provider_refund_id: schema.refunds.provider_refund_id,
        processed_at: schema.refunds.processed_at,
        created_at: schema.refunds.created_at,
      })
      .from(schema.refunds)
      .where(inArray(schema.refunds.payment_order_id, orderIds)),
  ]);

  const items: RegistrationPaymentActivityItem[] = [];
  for (const order of orders) {
    const metadata = parsePaymentMetadata(order.metadata);
    const isBalance = metadata.paymentKind === 'registration_balance';
    items.push({
      id: `payment:${order.id}`,
      kind: 'payment',
      orderId: order.id,
      amountMinor: order.amount_minor,
      currency: order.currency,
      status: order.status,
      occurredAt: normalizeOccurredAt(order.completed_at ?? order.created_at),
      provider: order.provider,
      providerReference: order.provider_order_id,
      label: isBalance ? 'Additional payment' : 'Payment',
    });
  }

  for (const refund of refunds) {
    items.push({
      id: `refund:${refund.id}`,
      kind: 'refund',
      orderId: refund.payment_order_id,
      amountMinor: refund.amount_minor,
      currency: refund.currency,
      status: refund.status,
      occurredAt: normalizeOccurredAt(refund.processed_at ?? refund.created_at),
      provider: refund.provider,
      providerReference: refund.provider_refund_id,
      label: refund.reason?.trim() || 'Refund',
    });
  }

  return items.sort((left, right) => {
    const leftTime = left.occurredAt ? new Date(left.occurredAt).getTime() : 0;
    const rightTime = right.occurredAt ? new Date(right.occurredAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

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
