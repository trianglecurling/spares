import { initializeDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';

async function main() {
  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database configuration not found. Run installation first.');
    process.exit(1);
  }

  // Root `bun run db:migrate` runs this script: Drizzle SQL migrations, then idempotent seeds.
  await initializeDatabase(dbConfig);
  console.log('Database migrations and bootstrap completed successfully.');
}

main().catch((error) => {
  console.error('Database initialization failed:', error);
  process.exit(1);
});
