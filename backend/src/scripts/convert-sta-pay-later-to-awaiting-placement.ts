import { eq } from 'drizzle-orm';
import { connectDatabase } from '../db/index.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { convertUnpaidImmediateRegistrationToAwaitingPlacement } from '../registration/registrationMembershipPaymentService.js';

const REGISTRATION_IDS = [194, 198, 205, 230, 251, 283, 334];

async function resolveActorMemberId(): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const [actor] = await db
    .select({ id: schema.members.id, email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.email, 'trevorsg@gmail.com'))
    .limit(1);
  if (actor) return actor.id;
  throw new Error('Could not find actor member trevorsg@gmail.com');
}

async function main() {
  const dbConfig = getDatabaseConfig();
  if (!dbConfig) {
    console.error('Database config not found. Expected backend/data/db-config.json to exist.');
    process.exit(1);
  }
  if (process.env.DB_CONFIG_PROFILE === 'preview') {
    console.error('Refusing to run against the preview profile. Unset DB_CONFIG_PROFILE.');
    process.exit(1);
  }

  await connectDatabase(dbConfig);
  const actorMemberId = await resolveActorMemberId();
  console.log(`Using actor member ${actorMemberId} on ${dbConfig.type} database.`);

  for (const registrationId of REGISTRATION_IDS) {
    try {
      const result = await convertUnpaidImmediateRegistrationToAwaitingPlacement({
        registrationId,
        actorMemberId,
      });
      console.log(
        JSON.stringify({
          ok: true,
          ...result,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          ok: false,
          registrationId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

await main();
