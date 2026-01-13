import { initializeDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { normalizeEmail } from '../utils/auth.js';
import { config as appConfig } from '../config.js';
import { sql } from 'drizzle-orm';

async function ensureAdminMembersExist(): Promise<void> {
  const dbConfig = getDatabaseConfig();
  if (!dbConfig) return;

  const { db, schema } = getDrizzleDb();
  const memberCountResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.members);

  const memberCount = Number(memberCountResult[0]?.count || 0);
  if (memberCount !== 0) return;

  // Combine SERVER_ADMINS env var + db-config.json adminEmails
  const serverAdminEmails = new Set<string>();

  if (appConfig.admins && appConfig.admins.length > 0) {
    appConfig.admins.forEach((email) => serverAdminEmails.add(normalizeEmail(email)));
  }

  if (dbConfig.adminEmails && dbConfig.adminEmails.length > 0) {
    dbConfig.adminEmails.forEach((email) => serverAdminEmails.add(normalizeEmail(email)));
  }

  for (const email of serverAdminEmails) {
    const normalizedEmail = normalizeEmail(email);

    const existingMembers = await db
      .select()
      .from(schema.members)
      .where(sql`LOWER(${schema.members.email}) = LOWER(${normalizedEmail})`)
      .limit(1);

    if (existingMembers.length > 0) continue;

    const emailName = normalizedEmail.split('@')[0] || 'admin';
    const name =
      emailName
        .split(/[._-]/)
        .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'Admin User';

    await db.insert(schema.members).values({
      name,
      email: normalizedEmail,
      is_admin: 0,
      is_server_admin: 1,
      email_subscribed: 1,
      opted_in_sms: 0,
      first_login_completed: 0,
      email_visible: 0,
      phone_visible: 0,
    });

    console.log(`Created server admin member: ${normalizedEmail}`);
  }
}

async function main() {
  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json to exist.');
    process.exit(1);
  }

  await initializeDatabase(dbConfig);
  await ensureAdminMembersExist();

  console.log(`Database initialized successfully (${dbConfig.type}).`);
}

main().catch((err) => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});

