import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../../../db/drizzle-db.js';
import { getCurrentDateStringAsync } from '../../../utils/time.js';
import { memberIsNotSocialCondition } from '../../../services/memberMembershipStatusService.js';
import type { Member } from '../../../types.js';
import { normalizeDateString, normalizeTimeString } from '../spareDateTime.js';
import {
  buildPublicSpareRecipientPools,
  buildUnavailableMemberIds,
  computeByeTeamIds,
  memberIdsForTeams,
} from '../spareByePriorityLogic.js';

export type PublicSpareRecipient = Pick<
  Member,
  | 'id'
  | 'name'
  | 'email'
  | 'phone'
  | 'is_server_admin'
  | 'opted_in_sms'
  | 'email_subscribed'
  | 'email_visible'
  | 'phone_visible'
  | 'theme_preference'
  | 'created_at'
  | 'updated_at'
>;

export type PublicSpareRecipientPools = {
  byeRecipients: PublicSpareRecipient[];
  otherRecipients: PublicSpareRecipient[];
  /** Bye first, then shuffled others. */
  orderedRecipients: Array<PublicSpareRecipient & { isByePriority: boolean }>;
};

function memberSelectFields(schema: ReturnType<typeof getDrizzleDb>['schema']) {
  return {
    id: schema.members.id,
    name: schema.members.name,
    email: schema.members.email,
    phone: schema.members.phone,
    is_server_admin: schema.members.is_server_admin,
    opted_in_sms: schema.members.opted_in_sms,
    email_subscribed: schema.members.email_subscribed,
    email_visible: schema.members.email_visible,
    phone_visible: schema.members.phone_visible,
    theme_preference: schema.members.theme_preference,
    created_at: schema.members.created_at,
    updated_at: schema.members.updated_at,
  };
}

function sameDateCondition(column: unknown, dateValue: string) {
  return sql`date(${column}) = date(${dateValue})`;
}

function sameTimeCondition(column: unknown, timeValue: string) {
  return sql`substr(CAST(${column} AS TEXT), 1, 5) = ${timeValue}`;
}

/**
 * Members on a scheduled team for the given league draw slot.
 */
export async function getMemberIdsPlayingAtDraw(params: {
  leagueId: number;
  gameDate: string;
  gameTime: string;
}): Promise<Set<number>> {
  const { db, schema } = getDrizzleDb();
  const gameDate = normalizeDateString(params.gameDate);
  const gameTime = normalizeTimeString(params.gameTime);

  const games = await db
    .select({
      team1_id: schema.games.team1_id,
      team2_id: schema.games.team2_id,
    })
    .from(schema.games)
    .where(
      and(
        eq(schema.games.league_id, params.leagueId),
        eq(schema.games.status, 'scheduled'),
        sameDateCondition(schema.games.game_date, gameDate),
        sameTimeCondition(schema.games.game_time, gameTime),
      ),
    );

  const teamIds = [...new Set(games.flatMap((g) => [g.team1_id, g.team2_id]))];
  if (teamIds.length === 0) return new Set();

  const rows = await db
    .select({
      team_id: schema.teamMembers.team_id,
      member_id: schema.teamMembers.member_id,
    })
    .from(schema.teamMembers)
    .where(inArray(schema.teamMembers.team_id, teamIds));

  return memberIdsForTeams(
    teamIds,
    rows.map((row) => ({ teamId: row.team_id, memberId: row.member_id })),
  );
}

/**
 * Members who already accepted a spare for this league draw slot.
 */
export async function getMemberIdsAlreadySparingAtDraw(params: {
  leagueId: number;
  gameDate: string;
  gameTime: string;
}): Promise<Set<number>> {
  const { db, schema } = getDrizzleDb();
  const gameDate = normalizeDateString(params.gameDate);
  const gameTime = normalizeTimeString(params.gameTime);

  const rows = await db
    .select({ filled_by_member_id: schema.spareRequests.filled_by_member_id })
    .from(schema.spareRequests)
    .where(
      and(
        eq(schema.spareRequests.league_id, params.leagueId),
        eq(schema.spareRequests.status, 'filled'),
        sameDateCondition(schema.spareRequests.game_date, gameDate),
        sameTimeCondition(schema.spareRequests.game_time, gameTime),
      ),
    );

  return new Set(
    rows
      .map((r) => r.filled_by_member_id)
      .filter((id): id is number => typeof id === 'number'),
  );
}

/**
 * Rostered team members whose team has no scheduled game on this date
 * (any draw time) — i.e. on bye for the day.
 */
export async function getMemberIdsOnByeForDay(params: {
  leagueId: number;
  gameDate: string;
}): Promise<Set<number>> {
  const { db, schema } = getDrizzleDb();
  const gameDate = normalizeDateString(params.gameDate);

  const teams = await db
    .select({ id: schema.leagueTeams.id })
    .from(schema.leagueTeams)
    .where(eq(schema.leagueTeams.league_id, params.leagueId));
  const allTeamIds = teams.map((t) => t.id);
  if (allTeamIds.length === 0) return new Set();

  const playingGames = await db
    .select({
      team1_id: schema.games.team1_id,
      team2_id: schema.games.team2_id,
    })
    .from(schema.games)
    .where(
      and(
        eq(schema.games.league_id, params.leagueId),
        eq(schema.games.status, 'scheduled'),
        sameDateCondition(schema.games.game_date, gameDate),
      ),
    );

  const byeTeamIds = computeByeTeamIds(
    allTeamIds,
    playingGames.map((g) => ({ team1Id: g.team1_id, team2Id: g.team2_id })),
  );
  if (byeTeamIds.length === 0) return new Set();

  const rows = await db
    .select({
      team_id: schema.teamMembers.team_id,
      member_id: schema.teamMembers.member_id,
    })
    .from(schema.teamMembers)
    .where(inArray(schema.teamMembers.team_id, byeTeamIds));

  return memberIdsForTeams(
    byeTeamIds,
    rows.map((row) => ({ teamId: row.team_id, memberId: row.member_id })),
  );
}

/**
 * Build the public spare notification audience for a request:
 * - Available members for the request league (minus requester/CCs/unavailable)
 * - Plus league members on bye for that day (same exclusions)
 * - Bye recipients are ordered first; others are randomized
 */
export async function getPublicSpareRecipients(params: {
  leagueId: number;
  gameDate: string;
  gameTime: string;
  position: string | null | undefined;
  requesterId: number;
  excludeMemberIds?: number[];
}): Promise<PublicSpareRecipientPools> {
  const { db, schema } = getDrizzleDb();
  const today = await getCurrentDateStringAsync();
  const gameDate = normalizeDateString(params.gameDate);
  const gameTime = normalizeTimeString(params.gameTime);

  const [playingIds, alreadySparingIds, byeIds] = await Promise.all([
    getMemberIdsPlayingAtDraw({
      leagueId: params.leagueId,
      gameDate,
      gameTime,
    }),
    getMemberIdsAlreadySparingAtDraw({
      leagueId: params.leagueId,
      gameDate,
      gameTime,
    }),
    getMemberIdsOnByeForDay({
      leagueId: params.leagueId,
      gameDate,
    }),
  ]);

  const unavailableMemberIds = buildUnavailableMemberIds({
    playingAtDraw: playingIds,
    alreadySparingAtDraw: alreadySparingIds,
  });

  const availabilityConditions = [
    eq(schema.memberAvailability.league_id, params.leagueId),
    eq(schema.memberAvailability.available, 1),
    eq(schema.members.email_subscribed, 1),
    memberIsNotSocialCondition(schema, today),
    ne(schema.members.id, params.requesterId),
  ];
  if (params.position === 'skip') {
    availabilityConditions.push(eq(schema.memberAvailability.can_skip, 1));
  }

  const availableRows = (await db
    .selectDistinct(memberSelectFields(schema))
    .from(schema.members)
    .innerJoin(schema.memberAvailability, eq(schema.members.id, schema.memberAvailability.member_id))
    .where(and(...availabilityConditions))) as PublicSpareRecipient[];

  const availableById = new Map(availableRows.map((row) => [row.id, row]));
  const exclude = new Set<number>([params.requesterId, ...(params.excludeMemberIds ?? [])]);

  let byeCandidateIds = [...byeIds].filter((id) => !exclude.has(id) && !unavailableMemberIds.has(id));
  let canSkipMemberIds: Set<number> | undefined;
  if (params.position === 'skip') {
    const canSkipRows =
      byeCandidateIds.length === 0
        ? []
        : await db
            .select({ member_id: schema.memberAvailability.member_id })
            .from(schema.memberAvailability)
            .where(
              and(
                eq(schema.memberAvailability.league_id, params.leagueId),
                eq(schema.memberAvailability.can_skip, 1),
                inArray(schema.memberAvailability.member_id, byeCandidateIds),
              ),
            );
    canSkipMemberIds = new Set(canSkipRows.map((r) => r.member_id));
    byeCandidateIds = byeCandidateIds.filter(
      (id) => canSkipMemberIds!.has(id) || availableById.has(id),
    );
  }

  const byeMembersToLoad = byeCandidateIds.filter((id) => !availableById.has(id));
  const byeExtraRows =
    byeMembersToLoad.length === 0
      ? []
      : ((await db
          .select(memberSelectFields(schema))
          .from(schema.members)
          .where(
            and(
              inArray(schema.members.id, byeMembersToLoad),
              eq(schema.members.email_subscribed, 1),
              memberIsNotSocialCondition(schema, today),
            ),
          )) as PublicSpareRecipient[]);

  return buildPublicSpareRecipientPools({
    availableMembers: availableRows,
    byeMemberIds: byeIds,
    extraByeMembers: byeExtraRows,
    requesterId: params.requesterId,
    excludeMemberIds: params.excludeMemberIds,
    unavailableMemberIds,
    position: params.position,
    canSkipMemberIds,
  });
}

/** Load CC member IDs for a spare request (for exclusion from public pool). */
export async function getSpareRequestCcMemberIds(spareRequestId: number): Promise<number[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ member_id: schema.spareRequestCcs.member_id })
    .from(schema.spareRequestCcs)
    .where(eq(schema.spareRequestCcs.spare_request_id, spareRequestId));
  return rows.map((r) => r.member_id);
}
