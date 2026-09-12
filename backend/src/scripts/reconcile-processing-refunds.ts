/**
 * Re-fetch in-flight refunds from Square/Stripe so missed webhooks get applied.
 *
 * Usage:
 *   bun run src/scripts/reconcile-processing-refunds.ts --dry-run
 *   bun run src/scripts/reconcile-processing-refunds.ts --apply
 *
 * Uses backend/data/db-config.json by default. For preview:
 *   DB_CONFIG_PROFILE=preview bun run src/scripts/reconcile-processing-refunds.ts --dry-run
 */

import { eq, inArray } from 'drizzle-orm';
import { closeDatabase, connectDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { config } from '../config.js';
import { createPaymentService } from '../services/paymentService.js';

const IN_FLIGHT = ['processing', 'requested', 'approved'] as const;

function argvFlag(name: string): boolean {
  return process.argv.includes(name);
}

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

async function loadInFlightRefunds() {
  const { db, schema } = getDrizzleDb();
  return db
    .select({
      id: schema.refunds.id,
      orderId: schema.refunds.payment_order_id,
      amountMinor: schema.refunds.amount_minor,
      status: schema.refunds.status,
      reason: schema.refunds.reason,
      provider: schema.refunds.provider,
      providerRefundId: schema.refunds.provider_refund_id,
      processedAt: schema.refunds.processed_at,
      orderStatus: schema.paymentOrders.status,
      orderAmountMinor: schema.paymentOrders.amount_minor,
      subjectType: schema.paymentOrders.subject_type,
      subjectId: schema.paymentOrders.subject_id,
    })
    .from(schema.refunds)
    .innerJoin(schema.paymentOrders, eq(schema.refunds.payment_order_id, schema.paymentOrders.id))
    .where(inArray(schema.refunds.status, [...IN_FLIGHT]));
}

async function main() {
  const apply = argvFlag('--apply');
  const dryRun = !apply || argvFlag('--dry-run');
  if (apply && argvFlag('--dry-run')) {
    console.error('Pass either --dry-run or --apply, not both.');
    process.exit(1);
  }

  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json to exist.');
    process.exit(1);
  }

  await connectDatabase(dbConfig);
  const paymentService = createPaymentService();
  const before = await loadInFlightRefunds();

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? 'dry-run' : 'apply',
        profile: process.env.DB_CONFIG_PROFILE ?? 'default',
        squareEnvironment: config.payment.providers.square.environment,
        inFlightCount: before.length,
        inFlightTotalMinor: before.reduce((sum, row) => sum + row.amountMinor, 0),
        refunds: before.map((row) => ({
          refundId: row.id,
          orderId: row.orderId,
          subject: `${row.subjectType}:${row.subjectId ?? 'none'}`,
          amount: money(row.amountMinor),
          localStatus: row.status,
          orderStatus: row.orderStatus,
          provider: row.provider,
          providerRefundId: row.providerRefundId,
          reason: row.reason,
        })),
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    const missingIds = before.filter((row) => !row.providerRefundId);
    if (missingIds.length > 0) {
      console.log(
        `\n${missingIds.length} refund(s) have no provider refund id and cannot be re-queried from Square/Stripe.`,
      );
    }
    await closeDatabase();
    return;
  }

  const orderIds = [...new Set(before.map((row) => row.orderId))];
  for (const orderId of orderIds) {
    await paymentService.reconcileRefundsForOrder(orderId);
  }

  const after = await loadInFlightRefunds();
  const afterById = new Map(after.map((row) => [row.id, row]));
  const { db, schema } = getDrizzleDb();
  const refreshed =
    before.length === 0
      ? []
      : await db
          .select({
            id: schema.refunds.id,
            status: schema.refunds.status,
            processedAt: schema.refunds.processed_at,
            orderStatus: schema.paymentOrders.status,
          })
          .from(schema.refunds)
          .innerJoin(schema.paymentOrders, eq(schema.refunds.payment_order_id, schema.paymentOrders.id))
          .where(
            inArray(
              schema.refunds.id,
              before.map((row) => row.id),
            ),
          );

  const results = refreshed.map((row) => {
    const previous = before.find((item) => item.id === row.id);
    return {
      refundId: row.id,
      orderId: previous?.orderId,
      amount: previous ? money(previous.amountMinor) : null,
      previousStatus: previous?.status,
      currentStatus: row.status,
      orderStatus: row.orderStatus,
      changed: previous?.status !== row.status,
      stillInFlight: afterById.has(row.id),
      reason: previous?.reason,
    };
  });

  console.log(
    JSON.stringify(
      {
        reconciledOrders: orderIds.length,
        stillInFlight: after.length,
        updated: results.filter((row) => row.changed).length,
        results,
      },
      null,
      2,
    ),
  );

  await closeDatabase();
}

await main();
