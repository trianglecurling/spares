import { and, eq, isNull, or } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { generateVolunteerProgramShareToken } from '../utils/volunteerProgramShareToken.js';

/** Fill share tokens for programs created before unlisted links existed. */
export async function ensureVolunteerProgramShareTokens(): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const programs = await db
    .select({
      id: schema.volunteerPrograms.id,
      shareToken: schema.volunteerPrograms.share_token,
    })
    .from(schema.volunteerPrograms);

  for (const program of programs) {
    if (String(program.shareToken ?? '').trim()) continue;
    await db
      .update(schema.volunteerPrograms)
      .set({ share_token: generateVolunteerProgramShareToken() } as never)
      .where(
        and(
          eq(schema.volunteerPrograms.id, program.id),
          or(isNull(schema.volunteerPrograms.share_token), eq(schema.volunteerPrograms.share_token, ''))
        )
      );
  }
}
