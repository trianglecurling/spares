import { initializeDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';

async function main() {
  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database configuration not found. Run installation first.');
    process.exit(1);
  }

  await initializeDatabase(dbConfig);
  console.log('Database initialized successfully.');
}

main().catch((error) => {
  console.error('Database initialization failed:', error);
  process.exit(1);
});
