import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { CurlingExperienceTypeSqlite } from '../db/drizzle-schema.js';
import {
  memberExperienceBaselinesFromRow,
  type MemberExperienceBaselines,
} from '../registration/curlingExperienceYears.js';
import { totalExperienceYears } from '../registration/registrationAgeExperience.js';
import type { RegistrationContext } from '../registration/registrationContext.js';

const SUBMITTED_REGISTRATION_STATUSES = [
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
  'paid',
  'confirmed',
] as const;

async function loadCompletedSessions(
  memberId: number,
): Promise<RegistrationContext['experience']['completedSessions']> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.leagueRoster.league_id,
      seasonKey: schema.curlingSeasons.name,
    })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .innerJoin(schema.curlingSessions, eq(schema.leagues.session_id, schema.curlingSessions.id))
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
    .where(eq(schema.leagueRoster.member_id, memberId));

  return rows.map((row) => ({
    leagueId: row.leagueId,
    seasonKey: row.seasonKey,
  }));
}

async function loadLatestSubmittedRegistrationExperience(memberId: number): Promise<{
  experienceType: CurlingExperienceTypeSqlite | null;
  experienceSelfReportedYears: number | null;
} | null> {
  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select({
      experienceType: schema.curlingRegistrations.experience_type,
      experienceSelfReportedYears: schema.curlingRegistrations.experience_self_reported_years,
    })
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.curler_member_id, memberId),
        sql`${schema.curlingRegistrations.submitted_at} IS NOT NULL`,
        inArray(schema.curlingRegistrations.status, [...SUBMITTED_REGISTRATION_STATUSES]),
      ),
    )
    .orderBy(desc(schema.curlingRegistrations.updated_at), desc(schema.curlingRegistrations.id))
    .limit(1);

  if (!registration) return null;
  return {
    experienceType: registration.experienceType ?? null,
    experienceSelfReportedYears:
      registration.experienceSelfReportedYears === null || registration.experienceSelfReportedYears === undefined
        ? null
        : Number(registration.experienceSelfReportedYears),
  };
}

export function resolveMemberExperienceType(input: {
  registrationExperienceType: CurlingExperienceTypeSqlite | null;
  completedSessionCount: number;
  baselines: MemberExperienceBaselines;
}): CurlingExperienceTypeSqlite {
  const hasBaselineExperience =
    input.baselines.baselineOtherClubExperienceYears > 0 || input.baselines.baselineClubExperienceYears > 0;
  const useKnownExperience =
    input.registrationExperienceType === null &&
    (input.completedSessionCount > 0 || hasBaselineExperience);
  return (
    input.registrationExperienceType ??
    (useKnownExperience ? 'known_existing' : input.completedSessionCount > 0 ? 'known_existing' : 'none_or_minimal')
  );
}

export function computeMemberTotalExperienceYears(input: {
  experienceType: CurlingExperienceTypeSqlite;
  experienceSelfReportedYears: number | null;
  baselines: MemberExperienceBaselines;
  completedSessions: RegistrationContext['experience']['completedSessions'];
}): number {
  return totalExperienceYears({
    experienceType: input.experienceType,
    selfReportedYears: input.experienceSelfReportedYears,
    baselines: input.baselines,
    completedSessions: input.completedSessions,
  });
}

export async function getMemberTotalExperienceYears(memberId: number): Promise<number | null> {
  const { db, schema } = getDrizzleDb();
  const [member] = await db
    .select({
      baseline_other_club_experience_years: schema.members.baseline_other_club_experience_years,
      baseline_club_experience_years: schema.members.baseline_club_experience_years,
    })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);

  if (!member) return null;

  const baselines = memberExperienceBaselinesFromRow(member);
  const completedSessions = await loadCompletedSessions(memberId);
  const registration = await loadLatestSubmittedRegistrationExperience(memberId);
  const experienceType = resolveMemberExperienceType({
    registrationExperienceType: registration?.experienceType ?? null,
    completedSessionCount: completedSessions.length,
    baselines,
  });

  return computeMemberTotalExperienceYears({
    experienceType,
    experienceSelfReportedYears: registration?.experienceSelfReportedYears ?? null,
    baselines,
    completedSessions,
  });
}
