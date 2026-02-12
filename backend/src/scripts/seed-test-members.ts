import { initializeDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';

async function seedTestMembers(): Promise<void> {
  const { db, schema } = getDrizzleDb();

  const members = Array.from({ length: 100 }, (_, i) => {
    const num = String(i).padStart(2, '0');
    return {
      name: `Test ${num}`,
      email: `test${num}@example.com`,
      phone: null,
      valid_through: null,
      spare_only: 0,
      is_admin: 0,
      is_server_admin: 0,
      opted_in_sms: 0,
      email_subscribed: 1,
      first_login_completed: 0,
      email_visible: 0,
      phone_visible: 0,
    };
  });

  await db.transaction(async (tx) => {
    for (const member of members) {
      await tx.insert(schema.members).values(member);
    }
  });

  console.log('Seeded 100 test members (Test 00 – Test 99).');
}

async function main() {
  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json to exist.');
    process.exit(1);
  }

  await initializeDatabase(dbConfig);
  await seedTestMembers();
}

main().catch((err) => {
  console.error('Seeding test members failed:', err);
  process.exit(1);
});
