import { config } from '../config.js';
import { createPaymentService } from './paymentService.js';

let running = false;

export async function reconcileStalePaymentsOnce(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const paymentService = createPaymentService();
    const staleBefore = new Date(Date.now() - config.payment.reconcile.staleAfterSeconds * 1000);
    const summary = await paymentService.reconcileStalePendingOrders(
      staleBefore,
      config.payment.reconcile.batchSize,
      'background-reconcile',
      config.payment.reconcile.maxPendingAgeSeconds > 0
        ? config.payment.reconcile.maxPendingAgeSeconds
        : null
    );

    if (summary.checked > 0 || summary.changed > 0 || summary.skippedByMaxAge > 0) {
      console.log(
        `[Payment Reconciliation] checked=${summary.checked} changed=${summary.changed} skipped_by_max_age=${summary.skippedByMaxAge} stale_before=${summary.staleThresholdIso}${summary.maxPendingAgeThresholdIso ? ` max_pending_age_before=${summary.maxPendingAgeThresholdIso}` : ''}`
      );
    }
  } catch (error) {
    console.error('[Payment Reconciliation] Processor run failed:', error);
  } finally {
    running = false;
  }
}

export function startPaymentReconciliationProcessor(): void {
  if (!config.payment.reconcile.enabled) {
    console.log('[Payment Reconciliation] Disabled by config');
    return;
  }

  // Kick off quickly after startup, then run on interval.
  setTimeout(() => {
    void reconcileStalePaymentsOnce();
  }, 2000);

  setInterval(() => {
    void reconcileStalePaymentsOnce();
  }, config.payment.reconcile.intervalMs);

  console.log(
    `[Payment Reconciliation] Started (interval=${config.payment.reconcile.intervalMs}ms, stale_after=${config.payment.reconcile.staleAfterSeconds}s, max_pending_age=${config.payment.reconcile.maxPendingAgeSeconds}s, batch=${config.payment.reconcile.batchSize})`
  );
}
