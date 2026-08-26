import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { CurlingExperienceTypeSqlite } from '../db/drizzle-schema.js';
import {
  memberExperienceBaselinesFromRow,
  normalizeHalfYearExperienceValue,
} from './curlingExperienceYears.js';
import { totalExperienceYears } from './registrationAgeExperience.js';
import {
  clubTenureSortYears,
  loadDashboardSessionForClubTenure,
  resolveClubTenure,
} from '../services/memberMembershipCardService.js';
import { getCurrentDateStringAsync } from '../utils/time.js';

const PURCHASED_SEASON_MEMBERSHIP_STATUSES = ['active', 'pending', 'expired'] as const;
const UNPAID_MEMBERSHIP_REGISTRATION_STATUSES = [
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
] as const;
const SUBMITTED_REGISTRATION_STATUSES = [
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
  'paid',
  'confirmed',
] as const;

export type WaitlistQueueMemberStats = {
  isLifetimeMember: boolean;
  clubTenureYears: number;
  otherClubYears: number;
  totalExperienceYears: number;
};

type MembershipSeason = { seasonId: number; startDate: string };

function uniqueMembershipSeasons(seasons: Array<{ seasonId: number; startDate: string | null }>): MembershipSeason[] {
  const byId = new Map<number, string>();
  for (const season of seasons) {
    const startDate = season.startDate?.slice(0, 10) ?? null;
    if (!startDate) continue;
    const existing = byId.get(season.seasonId);
    if (!existing || startDate < existing) {
      byId.set(season.seasonId, startDate);
    }
  }
  return [...byId.entries()].map(([seasonId, startDate]) => ({ seasonId, startDate }));
}

function dateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export async function loadWaitlistQueueMemberStats(
  memberIds: number[],
): Promise<Map<number, WaitlistQueueMemberStats>> {
  const stats = new Map<number, WaitlistQueueMemberStats>();
  const uniqueIds = [...new Set(memberIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (uniqueIds.length === 0) return stats;

  const { db, schema } = getDrizzleDb();
  const [{ session, firstSessionIdOfCurrentSeason }, today] = await Promise.all([
    loadDashboardSessionForClubTenure(),
    getCurrentDateStringAsync(),
  ]);

  const [memberRows, purchasedSeasons, rosterSeasons, pendingGrantRows, latestRegistrationRows] =
    await Promise.all([
      db
        .select({
          id: schema.members.id,
          lifetime_member: schema.members.lifetime_member,
          baseline_club_experience_years: schema.members.baseline_club_experience_years,
          baseline_other_club_experience_years: schema.members.baseline_other_club_experience_years,
        })
        .from(schema.members)
        .where(inArray(schema.members.id, uniqueIds)),
      db
        .select({
          memberId: schema.seasonMemberships.member_id,
          seasonId: schema.seasonMemberships.season_id,
          startDate: schema.curlingSeasons.start_date,
        })
        .from(schema.seasonMemberships)
        .innerJoin(schema.curlingSeasons, eq(schema.seasonMemberships.season_id, schema.curlingSeasons.id))
        .where(
          and(
            inArray(schema.seasonMemberships.member_id, uniqueIds),
            inArray(schema.seasonMemberships.status, [...PURCHASED_SEASON_MEMBERSHIP_STATUSES]),
          ),
        ),
      db
        .select({
          memberId: schema.leagueRoster.member_id,
          seasonId: schema.curlingSessions.season_id,
          startDate: schema.curlingSeasons.start_date,
          leagueId: schema.leagueRoster.league_id,
          seasonKey: schema.curlingSeasons.name,
        })
        .from(schema.leagueRoster)
        .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
        .innerJoin(schema.curlingSessions, eq(schema.leagues.session_id, schema.curlingSessions.id))
        .innerJoin(schema.curlingSeasons, eq(schema.curlingSessions.season_id, schema.curlingSeasons.id))
        .where(inArray(schema.leagueRoster.member_id, uniqueIds)),
      db
        .select({
          memberId: schema.curlingRegistrations.curler_member_id,
          membershipOption: schema.curlingRegistrations.membership_option,
          seasonId: schema.curlingSeasons.id,
          seasonStartDate: schema.curlingSeasons.start_date,
          seasonEndsAt: schema.curlingSeasons.end_date,
          seasonMembershipId: schema.seasonMemberships.id,
          registrationId: schema.curlingRegistrations.id,
        })
        .from(schema.curlingRegistrations)
        .innerJoin(schema.curlingSeasons, eq(schema.curlingRegistrations.season_id, schema.curlingSeasons.id))
        .leftJoin(
          schema.seasonMemberships,
          eq(schema.seasonMemberships.source_registration_id, schema.curlingRegistrations.id),
        )
        .where(
          and(
            inArray(schema.curlingRegistrations.curler_member_id, uniqueIds),
            inArray(schema.curlingRegistrations.status, [...UNPAID_MEMBERSHIP_REGISTRATION_STATUSES]),
          ),
        )
        .orderBy(desc(schema.curlingSeasons.end_date), desc(schema.curlingRegistrations.id)),
      db
        .select({
          memberId: schema.curlingRegistrations.curler_member_id,
          experienceType: schema.curlingRegistrations.experience_type,
          experienceSelfReportedYears: schema.curlingRegistrations.experience_self_reported_years,
          updatedAt: schema.curlingRegistrations.updated_at,
          id: schema.curlingRegistrations.id,
        })
        .from(schema.curlingRegistrations)
        .where(
          and(
            inArray(schema.curlingRegistrations.curler_member_id, uniqueIds),
            sql`${schema.curlingRegistrations.submitted_at} IS NOT NULL`,
            inArray(schema.curlingRegistrations.status, [...SUBMITTED_REGISTRATION_STATUSES]),
          ),
        )
        .orderBy(desc(schema.curlingRegistrations.updated_at), desc(schema.curlingRegistrations.id)),
    ]);

  const seasonsByMember = new Map<number, Array<{ seasonId: number; startDate: string | null }>>();
  const addSeason = (memberId: number, seasonId: number, startDate: unknown) => {
    const list = seasonsByMember.get(memberId) ?? [];
    list.push({ seasonId, startDate: dateOnly(startDate) });
    seasonsByMember.set(memberId, list);
  };
  for (const row of purchasedSeasons) addSeason(row.memberId, row.seasonId, row.startDate);
  for (const row of rosterSeasons) addSeason(row.memberId, row.seasonId, row.startDate);

  const pendingGrantByMember = new Map<number, { seasonId: number; seasonStartDate: string }>();
  for (const row of pendingGrantRows) {
    if (row.memberId == null || pendingGrantByMember.has(row.memberId)) continue;
    if (row.seasonMembershipId != null) continue;
    if (
      row.membershipOption !== 'regular' &&
      row.membershipOption !== 'social' &&
      row.membershipOption !== 'regular_spare_only' &&
      row.membershipOption !== 'junior_recreational'
    ) {
      continue;
    }
    const seasonEndsAt = dateOnly(row.seasonEndsAt);
    if (!seasonEndsAt || seasonEndsAt < today) continue;
    const seasonStartDate = dateOnly(row.seasonStartDate) ?? seasonEndsAt;
    pendingGrantByMember.set(row.memberId, { seasonId: row.seasonId, seasonStartDate });
  }

  const completedByMember = new Map<number, Array<{ leagueId: number; seasonKey: string }>>();
  for (const row of rosterSeasons) {
    const list = completedByMember.get(row.memberId) ?? [];
    list.push({ leagueId: row.leagueId, seasonKey: row.seasonKey });
    completedByMember.set(row.memberId, list);
  }

  const latestRegistrationByMember = new Map<
    number,
    { experienceType: CurlingExperienceTypeSqlite | null; experienceSelfReportedYears: number | null }
  >();
  for (const row of latestRegistrationRows) {
    if (row.memberId == null || latestRegistrationByMember.has(row.memberId)) continue;
    latestRegistrationByMember.set(row.memberId, {
      experienceType: row.experienceType ?? null,
      experienceSelfReportedYears:
        row.experienceSelfReportedYears == null ? null : Number(row.experienceSelfReportedYears),
    });
  }

  for (const member of memberRows) {
    const isLifetimeMember = (member.lifetime_member ?? 0) === 1;
    const baselines = memberExperienceBaselinesFromRow(member);
    const tenureSeasons = [...(seasonsByMember.get(member.id) ?? [])];
    const pendingGrant = pendingGrantByMember.get(member.id);
    if (pendingGrant) {
      tenureSeasons.push({ seasonId: pendingGrant.seasonId, startDate: pendingGrant.seasonStartDate });
    }
    if (isLifetimeMember && session) {
      tenureSeasons.push({ seasonId: session.seasonId, startDate: session.seasonStartDate });
    }
    const clubTenure = resolveClubTenure({
      membershipSeasons: uniqueMembershipSeasons(tenureSeasons),
      currentSession: session,
      firstSessionIdOfCurrentSeason,
      baselineClubExperienceYears: baselines.baselineClubExperienceYears,
    });

    const completedSessions = completedByMember.get(member.id) ?? [];
    const registration = latestRegistrationByMember.get(member.id);
    const hasBaselineExperience =
      baselines.baselineOtherClubExperienceYears > 0 || baselines.baselineClubExperienceYears > 0;
    const experienceType: CurlingExperienceTypeSqlite =
      registration?.experienceType ??
      (completedSessions.length > 0 || hasBaselineExperience ? 'known_existing' : 'none_or_minimal');

    stats.set(member.id, {
      isLifetimeMember,
      clubTenureYears: clubTenureSortYears(clubTenure),
      otherClubYears: normalizeHalfYearExperienceValue(baselines.baselineOtherClubExperienceYears),
      totalExperienceYears: totalExperienceYears({
        experienceType,
        selfReportedYears: registration?.experienceSelfReportedYears ?? null,
        baselines,
        completedSessions,
      }),
    });
  }

  return stats;
}

export function emptyWaitlistQueueMemberStats(): WaitlistQueueMemberStats {
  return {
    isLifetimeMember: false,
    clubTenureYears: 0,
    otherClubYears: 0,
    totalExperienceYears: 0,
  };
}
