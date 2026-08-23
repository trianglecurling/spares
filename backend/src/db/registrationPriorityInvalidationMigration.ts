import { and, desc, eq, isNotNull, isNull, notExists, sql } from 'drizzle-orm';
import { getDrizzleDb } from './drizzle-db.js';
import type { CurlingRegistrationStatusSqlite } from './drizzle-schema.js';

/**
 * The original cancel treated "submitted with no priority rows" as pre-model.
 * That is wrong: social, Junior Recreational, sabbatical-only, and other
 * no-league-play registrations submit with an empty priority list on purpose.
 *
 * The cancel was a status-only UPDATE. It did not email, refund, cancel
 * invoices, drop waitlists, or set cancelled_at. Real member/staff cancels
 * always set cancelled_at, so that NULL is the fingerprint of this hook.
 */

export type RestorableInvoiceSnapshot = {
  status: string | null;
  deferred: number | boolean | null;
};

export type RestorablePaymentOrder = {
  status: string | null;
};

export type RestorablePaymentDecision = {
  outcome?: string | null;
  requiresStaffReview?: boolean | null;
  deferralReasons?: string[] | null;
};

export function parsePaymentDecisionJson(value: unknown): RestorablePaymentDecision | null {
  if (value == null) return null;
  const parsed =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const deferralReasons = Array.isArray(record.deferralReasons)
    ? record.deferralReasons.filter((reason): reason is string => typeof reason === 'string')
    : null;
  return {
    outcome: typeof record.outcome === 'string' ? record.outcome : null,
    requiresStaffReview: typeof record.requiresStaffReview === 'boolean' ? record.requiresStaffReview : null,
    deferralReasons,
  };
}

export function inferRestoredRegistrationStatus(input: {
  invoice: RestorableInvoiceSnapshot | null;
  paymentOrder: RestorablePaymentOrder | null;
  paymentDecision: RestorablePaymentDecision | null;
}): CurlingRegistrationStatusSqlite {
  const invoiceStatus = input.invoice?.status ?? null;
  const orderStatus = input.paymentOrder?.status ?? null;
  const deferred = Boolean(input.invoice?.deferred) || invoiceStatus === 'deferred';
  const decision = input.paymentDecision;
  const staffReview =
    decision?.requiresStaffReview === true ||
    (decision?.deferralReasons ?? []).includes('staff_review_required');

  if (invoiceStatus === 'paid' || orderStatus === 'succeeded') {
    return 'confirmed';
  }
  if (
    invoiceStatus === 'checkout_started' ||
    orderStatus === 'pending' ||
    orderStatus === 'created'
  ) {
    return 'payment_started';
  }
  if (deferred || decision?.outcome === 'deferred_payment') {
    return staffReview ? 'awaiting_staff_review' : 'awaiting_placement';
  }
  if (
    decision?.outcome === 'immediate_payment' ||
    invoiceStatus === 'awaiting_payment' ||
    invoiceStatus === 'failed'
  ) {
    return 'awaiting_payment';
  }
  if (decision?.outcome === 'no_payment_required') {
    return 'confirmed';
  }
  return 'submitted';
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

export async function restoreFalselyCancelledEmptyPriorityRegistrations(
  dialect: 'sqlite' | 'postgres',
): Promise<void> {
  if (
    !(await tableExists('curling_registrations', dialect)) ||
    !(await tableExists('registration_invoices', dialect)) ||
    !(await tableExists('registration_league_priorities', dialect))
  ) {
    return;
  }

  const { db, schema } = getDrizzleDb();
  const cancelled = await db
    .select({
      id: schema.curlingRegistrations.id,
      paymentDecisionJson: schema.curlingRegistrations.payment_decision_json,
    })
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.status, 'cancelled'),
        isNull(schema.curlingRegistrations.cancelled_at),
        isNotNull(schema.curlingRegistrations.submitted_at),
        notExists(
          db
            .select({ one: sql`1` })
            .from(schema.registrationLeaguePriorities)
            .where(eq(schema.registrationLeaguePriorities.registration_id, schema.curlingRegistrations.id)),
        ),
      ),
    );
  const victims = Array.isArray(cancelled) ? cancelled : [];
  if (victims.length === 0) return;

  const restored: Array<{ id: number; status: CurlingRegistrationStatusSqlite }> = [];
  for (const row of victims) {
    const id = Number(row.id);
    if (!Number.isInteger(id) || id <= 0) continue;

    const [invoice] = await db
      .select({
        status: schema.registrationInvoices.status,
        deferred: schema.registrationInvoices.deferred,
        paymentOrderId: schema.registrationInvoices.payment_order_id,
      })
      .from(schema.registrationInvoices)
      .where(eq(schema.registrationInvoices.registration_id, id))
      .orderBy(desc(schema.registrationInvoices.updated_at), desc(schema.registrationInvoices.id))
      .limit(1);

    let paymentOrder: RestorablePaymentOrder | null = null;
    if (invoice?.paymentOrderId) {
      const [order] = await db
        .select({ status: schema.paymentOrders.status })
        .from(schema.paymentOrders)
        .where(eq(schema.paymentOrders.id, invoice.paymentOrderId))
        .limit(1);
      paymentOrder = order ? { status: order.status } : null;
    }

    const status = inferRestoredRegistrationStatus({
      invoice: invoice
        ? { status: invoice.status, deferred: invoice.deferred }
        : null,
      paymentOrder,
      paymentDecision: parsePaymentDecisionJson(row.paymentDecisionJson),
    });

    await db
      .update(schema.curlingRegistrations)
      .set({
        status,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(schema.curlingRegistrations.id, id),
          eq(schema.curlingRegistrations.status, 'cancelled'),
          isNull(schema.curlingRegistrations.cancelled_at),
        ),
      );
    restored.push({ id, status });
  }

  if (restored.length > 0) {
    console.log(
      `Restored ${restored.length} registration(s) cancelled by the empty-priority migrate hook: ${restored
        .map((row) => `${row.id}→${row.status}`)
        .join(', ')}`,
    );
  }
}
