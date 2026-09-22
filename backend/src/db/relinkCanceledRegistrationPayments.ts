import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { getDrizzleDb } from './drizzle-db.js';
import { mapCanceledSiblingPaymentsToLiveRegistrations } from '../domains/payments/queries/paymentSummaries.js';
import { SUBMITTED_CURLER_REGISTRATION_STATUSES } from '../registration/registrationDraftProgress.js';

const RELINKABLE_ORDER_STATUSES = ['succeeded', 'partially_refunded', 'pending_refund'] as const;
const SETTLED_ORDER_STATUSES = ['succeeded', 'partially_refunded', 'refunded', 'pending_refund'] as const;

export type CanceledPaymentRelinkPlan = {
  orderId: number;
  fromRegistrationId: number;
  toRegistrationId: number;
};

export function planCanceledPaymentRelinks(input: {
  orders: Array<{ id: number; subjectId: number | null }>;
  canceledRegistrations: Array<{
    id: number;
    curlerMemberId: number | null;
    sessionId: number;
    cancelledAt?: string | Date | null;
  }>;
  liveRegistrations: Array<{
    id: number;
    curlerMemberId: number | null;
    sessionId: number;
    status: string;
  }>;
}): CanceledPaymentRelinkPlan[] {
  const canceledById = new Map(input.canceledRegistrations.map((row) => [row.id, row]));
  const canceledToLive = mapCanceledSiblingPaymentsToLiveRegistrations({
    requestedRegistrations: input.liveRegistrations,
    canceledSiblings: input.canceledRegistrations,
  });

  const plans: CanceledPaymentRelinkPlan[] = [];
  for (const order of input.orders) {
    if (order.subjectId == null) continue;
    const canceled = canceledById.get(order.subjectId);
    if (!canceled) continue;
    const liveId = canceledToLive.get(canceled.id);
    if (liveId == null) continue;
    plans.push({
      orderId: order.id,
      fromRegistrationId: canceled.id,
      toRegistrationId: liveId,
    });
  }
  return plans;
}

async function tableExists(tableName: string, dialect: 'sqlite' | 'postgres'): Promise<boolean> {
  const { db } = getDrizzleDb();
  const query =
    dialect === 'postgres'
      ? `SELECT 1 FROM information_schema.tables WHERE table_name = '${tableName}' LIMIT 1`
      : `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${tableName}' LIMIT 1`;
  try {
    const result = await db.execute(sql.raw(query));
    const rows = (result as { rows?: unknown[] }).rows ?? result;
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Early paid registrations were sometimes canceled and replaced while the
 * Square/Stripe order stayed on the canceled row. Billing only counts the live
 * registration, so those curlies still look unpaid. Relink the order (and the
 * live invoice when it is not already pointing at a settled payment).
 */
export async function relinkCanceledRegistrationPayments(
  dialect: 'sqlite' | 'postgres',
): Promise<number> {
  if (
    !(await tableExists('curling_registrations', dialect)) ||
    !(await tableExists('payment_orders', dialect)) ||
    !(await tableExists('registration_invoices', dialect))
  ) {
    return 0;
  }

  const { db, schema } = getDrizzleDb();
  const orders = await db
    .select({
      id: schema.paymentOrders.id,
      subjectId: schema.paymentOrders.subject_id,
    })
    .from(schema.paymentOrders)
    .where(
      and(
        eq(schema.paymentOrders.subject_type, 'curling_registration'),
        inArray(schema.paymentOrders.status, [...RELINKABLE_ORDER_STATUSES]),
        isNotNull(schema.paymentOrders.subject_id),
      ),
    );
  if (orders.length === 0) return 0;

  const subjectIds = [
    ...new Set(orders.map((row) => row.subjectId).filter((id): id is number => id != null)),
  ];
  const canceledRegistrations = await db
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
        inArray(schema.curlingRegistrations.id, subjectIds),
      ),
    );
  if (canceledRegistrations.length === 0) return 0;

  const curlerIds = [
    ...new Set(
      canceledRegistrations
        .map((row) => row.curlerMemberId)
        .filter((id): id is number => id != null),
    ),
  ];
  const sessionIds = [...new Set(canceledRegistrations.map((row) => row.sessionId))];
  const allCanceledSiblings =
    curlerIds.length > 0
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
              inArray(schema.curlingRegistrations.curler_member_id, curlerIds),
              inArray(schema.curlingRegistrations.session_id, sessionIds),
            ),
          )
      : canceledRegistrations;
  const liveRegistrations =
    curlerIds.length > 0
      ? await db
          .select({
            id: schema.curlingRegistrations.id,
            curlerMemberId: schema.curlingRegistrations.curler_member_id,
            sessionId: schema.curlingRegistrations.session_id,
            status: schema.curlingRegistrations.status,
          })
          .from(schema.curlingRegistrations)
          .where(
            and(
              ne(schema.curlingRegistrations.status, 'cancelled'),
              inArray(schema.curlingRegistrations.curler_member_id, curlerIds),
              inArray(schema.curlingRegistrations.session_id, sessionIds),
              inArray(schema.curlingRegistrations.status, [...SUBMITTED_CURLER_REGISTRATION_STATUSES]),
            ),
          )
      : [];

  const plans = planCanceledPaymentRelinks({
    orders,
    canceledRegistrations: allCanceledSiblings,
    liveRegistrations,
  });
  if (plans.length === 0) return 0;

  const { confirmCurlingRegistrationForPaymentOrder } = await import(
    '../registration/registrationMembershipPaymentService.js'
  );

  for (const plan of plans) {
    await db
      .update(schema.paymentOrders)
      .set({
        subject_id: plan.toRegistrationId,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.paymentOrders.id, plan.orderId));

    const [invoice] = await db
      .select({
        id: schema.registrationInvoices.id,
        paymentOrderId: schema.registrationInvoices.payment_order_id,
        status: schema.registrationInvoices.status,
        totalMinor: schema.registrationInvoices.total_minor,
      })
      .from(schema.registrationInvoices)
      .where(eq(schema.registrationInvoices.registration_id, plan.toRegistrationId))
      .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
      .limit(1);
    if (!invoice) continue;

    const [order] = await db
      .select({
        status: schema.paymentOrders.status,
        amountMinor: schema.paymentOrders.amount_minor,
        subjectId: schema.paymentOrders.subject_id,
      })
      .from(schema.paymentOrders)
      .where(eq(schema.paymentOrders.id, plan.orderId))
      .limit(1);
    if (!order) continue;

    let currentOrderStatus: string | null = null;
    let currentOrderSubjectId: number | null = null;
    if (invoice.paymentOrderId != null) {
      const [currentOrder] = await db
        .select({
          status: schema.paymentOrders.status,
          subjectId: schema.paymentOrders.subject_id,
        })
        .from(schema.paymentOrders)
        .where(eq(schema.paymentOrders.id, invoice.paymentOrderId))
        .limit(1);
      currentOrderStatus = currentOrder?.status ?? null;
      currentOrderSubjectId = currentOrder?.subjectId ?? null;
    }
    const currentIsSettledOnLive =
      currentOrderSubjectId === plan.toRegistrationId &&
      currentOrderStatus != null &&
      (SETTLED_ORDER_STATUSES as readonly string[]).includes(currentOrderStatus);
    if (!currentIsSettledOnLive && order.amountMinor === invoice.totalMinor) {
      await db
        .update(schema.registrationInvoices)
        .set({
          payment_order_id: plan.orderId,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.registrationInvoices.id, invoice.id));
    }

    try {
      await confirmCurlingRegistrationForPaymentOrder(plan.orderId);
    } catch {
      // Amount mismatch or already-confirmed invoices should not roll back the relink.
    }
  }

  console.log(
    `Relinked ${plans.length} canceled registration payment(s) onto live registrations: ${plans
      .map((plan) => `${plan.orderId}:${plan.fromRegistrationId}→${plan.toRegistrationId}`)
      .join(', ')}`,
  );
  return plans.length;
}
