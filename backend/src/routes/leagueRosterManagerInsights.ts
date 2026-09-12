import { and, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { loadWaitlistQueueMemberStats } from '../registration/waitlistQueueMemberStats.js';
import { resolveAdjacentSessionsForLeagues } from '../services/curlingSessionService.js';
import type { ClubTenure } from '../services/memberMembershipCardService.js';
import { sortLeaguesByDayOfWeekThenFirstDrawTime } from '../utils/leagueOrdering.js';

const ROSTERED_STATUSES = ['active', 'completed'] as const;

export type LeagueRosterManagerInsight = {
  totalExperienceYears: number | null;
  clubTenure: ClubTenure | null;
  previousSessionName: string | null;
  previousSessionLeagues: string[];
};

export async function loadLeagueRosterManagerInsights(
  leagueId: number,
  memberIds: number[],
): Promise<Map<number, LeagueRosterManagerInsight>> {
  const insights = new Map<number, LeagueRosterManagerInsight>();
  const uniqueIds = [...new Set(memberIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (uniqueIds.length === 0) return insights;

  const { db, schema } = getDrizzleDb();
  const [leagueRow] = await db
    .select({ sessionId: schema.leagues.session_id })
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);

  const [statsByMemberId, previousSession] = await Promise.all([
    loadWaitlistQueueMemberStats(uniqueIds),
    leagueRow?.sessionId != null
      ? resolveAdjacentSessionsForLeagues(leagueRow.sessionId)
      : Promise.resolve({ previous: null, next: null }),
  ]);

  const previousSessionName = previousSession.previous?.name ?? null;
  const previousLeaguesByMemberId = new Map<number, string[]>();

  if (previousSession.previous) {
    const previousLeaguesUnsorted = await db
      .select({
        id: schema.leagues.id,
        name: schema.leagues.name,
        day_of_week: schema.leagues.day_of_week,
      })
      .from(schema.leagues)
      .where(eq(schema.leagues.session_id, previousSession.previous.id));
    const previousLeagues = await sortLeaguesByDayOfWeekThenFirstDrawTime(
      db,
      schema,
      previousLeaguesUnsorted,
    );
    const previousLeagueIds = previousLeagues.map((league) => league.id);
    const leagueNameById = new Map(previousLeagues.map((league) => [league.id, league.name]));

    if (previousLeagueIds.length > 0) {
      const rosterRows = await db
        .select({
          memberId: schema.leagueRoster.member_id,
          leagueId: schema.leagueRoster.league_id,
        })
        .from(schema.leagueRoster)
        .where(
          and(
            inArray(schema.leagueRoster.league_id, previousLeagueIds),
            inArray(schema.leagueRoster.member_id, uniqueIds),
            inArray(schema.leagueRoster.status, [...ROSTERED_STATUSES]),
          ),
        );

      const leagueIdsByMember = new Map<number, Set<number>>();
      for (const row of rosterRows) {
        const list = leagueIdsByMember.get(row.memberId) ?? new Set<number>();
        list.add(row.leagueId);
        leagueIdsByMember.set(row.memberId, list);
      }

      for (const [memberId, leagueIds] of leagueIdsByMember) {
        previousLeaguesByMemberId.set(
          memberId,
          previousLeagues
            .filter((league) => leagueIds.has(league.id))
            .map((league) => leagueNameById.get(league.id) ?? league.name),
        );
      }
    }
  }

  for (const memberId of uniqueIds) {
    const stats = statsByMemberId.get(memberId);
    insights.set(memberId, {
      totalExperienceYears: stats?.totalExperienceYears ?? 0,
      clubTenure: stats?.clubTenure ?? null,
      previousSessionName,
      previousSessionLeagues: previousLeaguesByMemberId.get(memberId) ?? [],
    });
  }

  return insights;
}

export function emptyLeagueRosterManagerInsight(): LeagueRosterManagerInsight {
  return {
    totalExperienceYears: null,
    clubTenure: null,
    previousSessionName: null,
    previousSessionLeagues: [],
  };
}
