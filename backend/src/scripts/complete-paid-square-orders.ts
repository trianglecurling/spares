/**
 * Mark Square payment-link orders COMPLETED when we already have a full payment.
 *
 * Square leaves payment-link orders OPEN after checkout unless we update them.
 * Accounting integrations typically sync only COMPLETED orders.
 *
 * Usage:
 *   bun run src/scripts/complete-paid-square-orders.ts --dry-run
 *   bun run src/scripts/complete-paid-square-orders.ts --apply
 *
 * Uses backend/data/db-config.json by default. For preview:
 *   DB_CONFIG_PROFILE=preview bun run src/scripts/complete-paid-square-orders.ts --dry-run
 */

import { connectDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';
import { config } from '../config.js';
import { createPaymentService } from '../services/paymentService.js';

function argvFlag(name: string): boolean {
  return process.argv.includes(name);
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
  const squareEnvironment = config.payment.providers.square.environment;

  console.log(
    JSON.stringify({
      mode: dryRun ? 'dry-run' : 'apply',
      database: dbConfig.type,
      profile: process.env.DB_CONFIG_PROFILE ?? 'default',
      squareEnvironment,
    })
  );

  const summary = await paymentService.completePaidProviderOrdersForFullyPaidPayments({
    dryRun,
    provider: 'square',
  });

  console.log(
    JSON.stringify(
      {
        checked: summary.checked,
        completed: summary.completed,
        alreadyCompleted: summary.alreadyCompleted,
        skipped: summary.skipped,
        failed: summary.failed,
        results: summary.results,
      },
      null,
      2
    )
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

await main();
