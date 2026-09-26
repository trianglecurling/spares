import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../../../db/drizzle-db.js';

export type RegistrationPaymentActivityItem = {
  id: string;
  kind: 'payment' | 'refund';
  orderId: number;
  orderToken: string | null;
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

type PaymentOrderActivityRow = {
  id: number;
  order_token: string | null;
  provider: RegistrationPaymentActivityItem['provider'];
  amount_minor: number;
  currency: string;
  status: string;
  provider_order_id: string | null;
  metadata: unknown;
  completed_at: string | Date | null;
  created_at: string | Date | null;
};

type RefundActivityRow = {
  id: number;
  payment_order_id: number;
  provider: RegistrationPaymentActivityItem['provider'];
  amount_minor: number;
  currency: string;
  status: string;
  reason: string | null;
  provider_refund_id: string | null;
  processed_at: string | Date | null;
  created_at: string | Date | null;
};

function sortPaymentActivity(items: RegistrationPaymentActivityItem[]): RegistrationPaymentActivityItem[] {
  return items.sort((left, right) => {
    const leftTime = left.occurredAt ? new Date(left.occurredAt).getTime() : 0;
    const rightTime = right.occurredAt ? new Date(right.occurredAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

export type RegistrationPaymentLinkRow = {
  id: number;
  curlerMemberId: number | null;
  sessionId: number;
  status: string;
};

export type CanceledSiblingRegistrationRow = {
  id: number;
  curlerMemberId: number | null;
  sessionId: number;
  cancelledAt?: string | Date | null;
};

function canceledSiblingRecency(row: CanceledSiblingRegistrationRow): number {
  if (row.cancelledAt instanceof Date) return row.cancelledAt.getTime();
  if (typeof row.cancelledAt === 'string' && row.cancelledAt.trim()) {
    const parsed = Date.parse(row.cancelledAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return row.id;
}

/**
 * Map the most recently canceled registration onto the unique live
 * registration for the same curler and session. Older canceled test
 * checkouts stay on their original rows so they are not treated as a
 * live overpayment. Ambiguous (0 or 2+) live rows are skipped so a
 * payment is never credited twice.
 */
export function mapCanceledSiblingPaymentsToLiveRegistrations(input: {
  requestedRegistrations: RegistrationPaymentLinkRow[];
  canceledSiblings: CanceledSiblingRegistrationRow[];
}): Map<number, number> {
  const liveByKey = new Map<string, number[]>();
  for (const row of input.requestedRegistrations) {
    if (row.status === 'cancelled' || row.curlerMemberId == null) continue;
    const key = `${row.curlerMemberId}:${row.sessionId}`;
    const list = liveByKey.get(key) ?? [];
    list.push(row.id);
    liveByKey.set(key, list);
  }

  const latestCanceledByKey = new Map<string, CanceledSiblingRegistrationRow>();
  for (const canceled of input.canceledSiblings) {
    if (canceled.curlerMemberId == null) continue;
    const key = `${canceled.curlerMemberId}:${canceled.sessionId}`;
    const current = latestCanceledByKey.get(key);
    if (!current || canceledSiblingRecency(canceled) >= canceledSiblingRecency(current)) {
      latestCanceledByKey.set(key, canceled);
    }
  }

  const canceledToLive = new Map<number, number>();
  for (const [key, canceled] of latestCanceledByKey) {
    const lives = liveByKey.get(key) ?? [];
    if (lives.length !== 1) continue;
    const liveId = lives[0];
    if (liveId == null || liveId === canceled.id) continue;
    canceledToLive.set(canceled.id, liveId);
  }
  return canceledToLive;
}

export function remapPaymentOrderSubjectToRequestedRegistrations(input: {
  subjectId: number | null;
  requestedIds: ReadonlySet<number>;
  canceledToLive: ReadonlyMap<number, number>;
}): number[] {
  if (input.subjectId == null) return [];
  const targets = new Set<number>();
  if (input.requestedIds.has(input.subjectId)) targets.add(input.subjectId);
  const liveId = input.canceledToLive.get(input.subjectId);
  if (liveId != null && input.requestedIds.has(liveId)) targets.add(liveId);
  return [...targets];
}

export function groupPaymentActivityByRegistration(input: {
  registrationIds: number[];
  subjectOrders: Array<{ id: number; subjectId: number | null }>;
  invoiceLinks: Array<{ paymentOrderId: number | null; registrationId: number }>;
  orders: PaymentOrderActivityRow[];
  refunds: RefundActivityRow[];
}): Map<number, RegistrationPaymentActivityItem[]> {
  const result = new Map<number, RegistrationPaymentActivityItem[]>();
  for (const registrationId of input.registrationIds) {
    result.set(registrationId, []);
  }

  const orderIdsToRegistrations = new Map<number, Set<number>>();
  const addLink = (orderId: number, registrationId: number) => {
    const set = orderIdsToRegistrations.get(orderId) ?? new Set<number>();
    set.add(registrationId);
    orderIdsToRegistrations.set(orderId, set);
  };
  for (const row of input.subjectOrders) {
    if (row.subjectId != null) addLink(row.id, row.subjectId);
  }
  for (const row of input.invoiceLinks) {
    if (row.paymentOrderId != null) addLink(row.paymentOrderId, row.registrationId);
  }

  const orderTokenById = new Map(input.orders.map((order) => [order.id, order.order_token ?? null]));
  for (const order of input.orders) {
    const metadata = parsePaymentMetadata(order.metadata);
    const item: RegistrationPaymentActivityItem = {
      id: `payment:${order.id}`,
      kind: 'payment',
      orderId: order.id,
      orderToken: order.order_token ?? null,
      amountMinor: order.amount_minor,
      currency: order.currency,
      status: order.status,
      occurredAt: normalizeOccurredAt(order.completed_at ?? order.created_at),
      provider: order.provider,
      providerReference: order.provider_order_id,
      label: metadata.paymentKind === 'registration_balance' ? 'Additional payment' : 'Payment',
    };
    for (const registrationId of orderIdsToRegistrations.get(order.id) ?? []) {
      result.get(registrationId)?.push(item);
    }
  }
  for (const refund of input.refunds) {
    const item: RegistrationPaymentActivityItem = {
      id: `refund:${refund.id}`,
      kind: 'refund',
      orderId: refund.payment_order_id,
      orderToken: orderTokenById.get(refund.payment_order_id) ?? null,
      amountMinor: refund.amount_minor,
      currency: refund.currency,
      status: refund.status,
      occurredAt: normalizeOccurredAt(refund.processed_at ?? refund.created_at),
      provider: refund.provider,
      providerReference: refund.provider_refund_id,
      label: refund.reason?.trim() || 'Refund',
    };
    for (const registrationId of orderIdsToRegistrations.get(refund.payment_order_id) ?? []) {
      result.get(registrationId)?.push(item);
    }
  }

  for (const items of result.values()) {
    sortPaymentActivity(items);
  }
  return result;
}

export async function listCurlingRegistrationPaymentActivityByRegistrationIds(
  registrationIds: number[],
): Promise<Map<number, RegistrationPaymentActivityItem[]>> {
  const empty = new Map<number, RegistrationPaymentActivityItem[]>();
  for (const registrationId of registrationIds) empty.set(registrationId, []);
  if (registrationIds.length === 0) return empty;

  const { db, schema } = getDrizzleDb();
  const requestedRegistrations = await db
    .select({
      id: schema.curlingRegistrations.id,
      curlerMemberId: schema.curlingRegistrations.curler_member_id,
      sessionId: schema.curlingRegistrations.session_id,
      status: schema.curlingRegistrations.status,
    })
    .from(schema.curlingRegistrations)
    .where(inArray(schema.curlingRegistrations.id, registrationIds));

  const liveCurlers = requestedRegistrations.filter(
    (row) => row.status !== 'cancelled' && row.curlerMemberId != null,
  );
  const liveCurlerIds = [...new Set(liveCurlers.map((row) => row.curlerMemberId as number))];
  const liveSessionIds = [...new Set(liveCurlers.map((row) => row.sessionId))];
  const canceledSiblings =
    liveCurlerIds.length > 0 && liveSessionIds.length > 0
      ? await db
          .select({
            id: schema.curlingRegistrations.id,
            curlerMemberId: schema.curlingRegistrations.curler_member_id,
            sessionId: schema.curlingRegistrations.session_id,
            cancelledAt: schema.curlingRegistrations.cancelled_at,
          })
          .from(schema.curlingRegistrations)
          .where(
            and(
              eq(schema.curlingRegistrations.status, 'cancelled'),
              inArray(schema.curlingRegistrations.curler_member_id, liveCurlerIds),
              inArray(schema.curlingRegistrations.session_id, liveSessionIds),
            ),
          )
      : [];

  const canceledToLive = mapCanceledSiblingPaymentsToLiveRegistrations({
    requestedRegistrations,
    canceledSiblings,
  });
  const lookupIds = [
    ...new Set([...registrationIds, ...canceledSiblings.map((row) => row.id)]),
  ];
  const requestedIds = new Set(registrationIds);

  const [subjectOrders, invoiceLinks] = await Promise.all([
    db
      .select({
        id: schema.paymentOrders.id,
        subjectId: schema.paymentOrders.subject_id,
      })
      .from(schema.paymentOrders)
      .where(
        and(
          eq(schema.paymentOrders.subject_type, 'curling_registration'),
          inArray(schema.paymentOrders.subject_id, lookupIds),
        ),
      ),
    db
      .select({
        paymentOrderId: schema.registrationInvoices.payment_order_id,
        registrationId: schema.registrationInvoices.registration_id,
      })
      .from(schema.registrationInvoices)
      .where(inArray(schema.registrationInvoices.registration_id, lookupIds)),
  ]);

  const remappedSubjectOrders: Array<{ id: number; subjectId: number | null }> = [];
  for (const row of subjectOrders) {
    for (const subjectId of remapPaymentOrderSubjectToRequestedRegistrations({
      subjectId: row.subjectId,
      requestedIds,
      canceledToLive,
    })) {
      remappedSubjectOrders.push({ id: row.id, subjectId });
    }
  }
  const remappedInvoiceLinks: Array<{ paymentOrderId: number | null; registrationId: number }> = [];
  for (const row of invoiceLinks) {
    for (const registrationId of remapPaymentOrderSubjectToRequestedRegistrations({
      subjectId: row.registrationId,
      requestedIds,
      canceledToLive,
    })) {
      remappedInvoiceLinks.push({ paymentOrderId: row.paymentOrderId, registrationId });
    }
  }

  const orderIds = [
    ...new Set([
      ...remappedSubjectOrders.map((row) => row.id),
      ...remappedInvoiceLinks.map((row) => row.paymentOrderId).filter((id): id is number => id != null),
    ]),
  ];
  if (orderIds.length === 0) return empty;

  const [orders, refunds] = await Promise.all([
    db
      .select({
        id: schema.paymentOrders.id,
        order_token: schema.paymentOrders.order_token,
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

  return groupPaymentActivityByRegistration({
    registrationIds,
    subjectOrders: remappedSubjectOrders,
    invoiceLinks: remappedInvoiceLinks,
    orders,
    refunds,
  });
}

export async function listCurlingRegistrationPaymentActivity(
  registrationId: number,
): Promise<RegistrationPaymentActivityItem[]> {
  const byRegistration = await listCurlingRegistrationPaymentActivityByRegistrationIds([registrationId]);
  return byRegistration.get(registrationId) ?? [];
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
