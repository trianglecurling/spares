import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import {
  normalizeHalfYearExperienceValue,
  otherClubYearsFromSpecifiedExperience,
} from './curlingExperienceYears.js';

const SUBMITTED_REGISTRATION_STATUSES = [
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
  'paid',
  'confirmed',
] as const;

export async function syncMemberOtherClubExperienceYears(input: {
  memberId: number;
  experienceType: string | null | undefined;
  experienceSelfReportedYears: number | null | undefined;
  db?: ReturnType<typeof getDrizzleDb>['db'];
}): Promise<void> {
  const years = otherClubYearsFromSpecifiedExperience(input.experienceType, input.experienceSelfReportedYears);
  if (years == null) return;
  const db = input.db ?? getDrizzleDb().db;
  const { schema } = getDrizzleDb();
  await db
    .update(schema.members)
    .set({
      baseline_other_club_experience_years: years,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.members.id, input.memberId));
}

/** Copy specified registration years onto the member profile when the profile value is still 0. */
export async function backfillMemberOtherClubExperienceYears(): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const members = await db
    .select({
      id: schema.members.id,
      baselineOtherClubExperienceYears: schema.members.baseline_other_club_experience_years,
    })
    .from(schema.members)
    .where(eq(schema.members.baseline_other_club_experience_years, 0));
  if (members.length === 0) return 0;

  const memberIds = members.map((member) => member.id);
  const registrations = await db
    .select({
      memberId: schema.curlingRegistrations.curler_member_id,
      experienceType: schema.curlingRegistrations.experience_type,
      experienceSelfReportedYears: schema.curlingRegistrations.experience_self_reported_years,
    })
    .from(schema.curlingRegistrations)
    .where(
      and(
        inArray(schema.curlingRegistrations.curler_member_id, memberIds),
        sql`${schema.curlingRegistrations.submitted_at} IS NOT NULL`,
        inArray(schema.curlingRegistrations.status, [...SUBMITTED_REGISTRATION_STATUSES]),
      ),
    )
    .orderBy(desc(schema.curlingRegistrations.updated_at), desc(schema.curlingRegistrations.id));

  const yearsByMember = new Map<number, number>();
  for (const row of registrations) {
    if (row.memberId == null || yearsByMember.has(row.memberId)) continue;
    const years = otherClubYearsFromSpecifiedExperience(row.experienceType, row.experienceSelfReportedYears);
    if (years == null || years <= 0) continue;
    yearsByMember.set(row.memberId, years);
  }

  let updated = 0;
  for (const [memberId, years] of yearsByMember) {
    await db
      .update(schema.members)
      .set({
        baseline_other_club_experience_years: normalizeHalfYearExperienceValue(years),
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.members.id, memberId));
    updated += 1;
  }
  return updated;
}
