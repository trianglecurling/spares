import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { getDrizzleDb } from '../../../db/drizzle-db.js';
import { getCurrentDateStringAsync, getCurrentTimeAsync } from '../../../utils/time.js';
import type { Member, SpareRequest } from '../../../types.js';

type SpareRequestDb = SpareRequest & {
  league_id: number | null;
  notification_generation: number | null;
  all_invites_declined_notified: number | null;
  notification_status: 'in_progress' | 'completed' | 'paused' | null;
  next_notification_at: string | null;
  notification_paused: number;
};

export class SpareQueryError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'SpareQueryError';
    this.statusCode = statusCode;
  }
}

function normalizeDateString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'string') {
    return value.includes('T') ? value.split('T')[0] : value;
  }
  return String(value);
}

function normalizeTimeString(value: unknown): string {
  if (value instanceof Date) {
    const timePart = value.toISOString().split('T')[1];
    return timePart ? timePart.slice(0, 5) : '';
  }
  if (typeof value === 'string') {
    if (value.includes('T')) {
      const timePart = value.split('T')[1] || '';
      return timePart.slice(0, 5);
    }
    return value.length >= 5 ? value.slice(0, 5) : value;
  }
  return String(value);
}

async function loadMemberNameMap(memberIds: number[]) {
  const { db, schema } = getDrizzleDb();
  if (memberIds.length === 0) {
    return new Map<number, string>();
  }

  const rows = await db
    .select({ id: schema.members.id, name: schema.members.name })
    .from(schema.members)
    .where(inArray(schema.members.id, memberIds));
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function loadSpareRequestForRequester(requestId: number, requesterId: number) {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.spareRequests)
    .where(and(eq(schema.spareRequests.id, requestId), eq(schema.spareRequests.requester_id, requesterId)))
    .limit(1);
  const spareRequest = rows[0] as SpareRequestDb | undefined;
  if (!spareRequest) {
    throw new SpareQueryError(404, 'Spare request not found');
  }
  return spareRequest;
}

export async function listCcSpareRequestsForMember(memberId: number) {
  const { db, schema } = getDrizzleDb();
  const today = await getCurrentDateStringAsync();

  const rowsRaw = await db
    .select({
      id: schema.spareRequests.id,
      league_name: schema.leagues.name,
      requester_name: schema.members.name,
      requester_email: schema.members.email,
      requester_phone: schema.members.phone,
      requested_for_name: schema.spareRequests.requested_for_name,
      game_date: schema.spareRequests.game_date,
      game_time: schema.spareRequests.game_time,
      position: schema.spareRequests.position,
      message: schema.spareRequests.message,
      request_type: schema.spareRequests.request_type,
      status: schema.spareRequests.status,
      filled_by_member_id: schema.spareRequests.filled_by_member_id,
      filled_at: schema.spareRequests.filled_at,
      created_at: schema.spareRequests.created_at,
    })
    .from(schema.spareRequestCcs)
    .innerJoin(schema.spareRequests, eq(schema.spareRequestCcs.spare_request_id, schema.spareRequests.id))
    .innerJoin(schema.members, eq(schema.spareRequests.requester_id, schema.members.id))
    .leftJoin(schema.leagues, eq(schema.spareRequests.league_id, schema.leagues.id))
    .where(
      and(
        eq(schema.spareRequestCcs.member_id, memberId),
        gte(schema.spareRequests.game_date, today),
        or(
          isNull(schema.spareRequests.requested_for_member_id),
          ne(schema.spareRequests.requested_for_member_id, memberId),
        )!,
      ),
    )
    .orderBy(asc(schema.spareRequests.game_date), asc(schema.spareRequests.game_time));

  const filledByIds = rowsRaw.map((row) => row.filled_by_member_id).filter((id): id is number => id !== null);
  const filledByNameMap = await loadMemberNameMap([...new Set(filledByIds)]);

  return rowsRaw.map((row) => ({
    id: row.id,
    requesterName: row.requester_name,
    requesterEmail: row.requester_email,
    requesterPhone: row.requester_phone,
    requestedForName: row.requested_for_name,
    gameDate: row.game_date,
    gameTime: row.game_time,
    leagueName: row.league_name || null,
    position: row.position,
    message: row.message,
    requestType: row.request_type,
    status: row.status,
    filledByName: row.filled_by_member_id ? filledByNameMap.get(row.filled_by_member_id) || null : null,
    filledAt: row.filled_at,
    createdAt: row.created_at,
  }));
}

export async function listAvailableSpareRequestsForMember(member: Member) {
  const { db, schema } = getDrizzleDb();
  const today = await getCurrentDateStringAsync();

  const memberAvailability = await db
    .select({ can_skip: schema.memberAvailability.can_skip })
    .from(schema.memberAvailability)
    .where(eq(schema.memberAvailability.member_id, member.id))
    .limit(1);
  const canSkip = memberAvailability[0]?.can_skip === 1;

  const publicConditions = [
    eq(schema.spareRequests.status, 'open'),
    eq(schema.spareRequests.request_type, 'public'),
    gte(schema.spareRequests.game_date, today),
    ne(schema.spareRequests.requester_id, member.id),
    or(
      isNull(schema.spareRequests.requested_for_member_id),
      ne(schema.spareRequests.requested_for_member_id, member.id),
    )!,
  ];

  if (!canSkip) {
    publicConditions.push(or(isNull(schema.spareRequests.position), ne(schema.spareRequests.position, 'skip'))!);
  }

  const publicRequests = await db
    .select({
      id: schema.spareRequests.id,
      league_name: schema.leagues.name,
      requester_name: schema.members.name,
      requester_email: schema.members.email,
      requester_phone: schema.members.phone,
      requested_for_name: schema.spareRequests.requested_for_name,
      game_date: schema.spareRequests.game_date,
      game_time: schema.spareRequests.game_time,
      position: schema.spareRequests.position,
      message: schema.spareRequests.message,
      request_type: schema.spareRequests.request_type,
      created_at: schema.spareRequests.created_at,
    })
    .from(schema.spareRequests)
    .innerJoin(schema.members, eq(schema.spareRequests.requester_id, schema.members.id))
    .leftJoin(schema.leagues, eq(schema.spareRequests.league_id, schema.leagues.id))
    .where(and(...publicConditions))
    .orderBy(asc(schema.spareRequests.game_date), asc(schema.spareRequests.game_time));

  const privateConditions = [
    eq(schema.spareRequests.status, 'open'),
    eq(schema.spareRequests.request_type, 'private'),
    eq(schema.spareRequestInvitations.member_id, member.id),
    gte(schema.spareRequests.game_date, today),
    ne(schema.spareRequests.requester_id, member.id),
    or(
      isNull(schema.spareRequests.requested_for_member_id),
      ne(schema.spareRequests.requested_for_member_id, member.id),
    )!,
  ];

  if (!canSkip) {
    privateConditions.push(or(isNull(schema.spareRequests.position), ne(schema.spareRequests.position, 'skip'))!);
  }

  const privateRequests = await db
    .select({
      id: schema.spareRequests.id,
      league_name: schema.leagues.name,
      requester_name: schema.members.name,
      requester_email: schema.members.email,
      requester_phone: schema.members.phone,
      requested_for_name: schema.spareRequests.requested_for_name,
      game_date: schema.spareRequests.game_date,
      game_time: schema.spareRequests.game_time,
      position: schema.spareRequests.position,
      message: schema.spareRequests.message,
      request_type: schema.spareRequests.request_type,
      created_at: schema.spareRequests.created_at,
      invite_declined_at: schema.spareRequestInvitations.declined_at,
    })
    .from(schema.spareRequests)
    .innerJoin(schema.members, eq(schema.spareRequests.requester_id, schema.members.id))
    .innerJoin(schema.spareRequestInvitations, eq(schema.spareRequests.id, schema.spareRequestInvitations.spare_request_id))
    .leftJoin(schema.leagues, eq(schema.spareRequests.league_id, schema.leagues.id))
    .where(and(...privateConditions))
    .orderBy(asc(schema.spareRequests.game_date), asc(schema.spareRequests.game_time));

  return [...publicRequests, ...privateRequests].map((row) => {
    const inviteDeclinedAt = 'invite_declined_at' in row ? row.invite_declined_at : null;
    return {
      id: row.id,
      requesterName: row.requester_name,
      requestedForName: row.requested_for_name,
      gameDate: row.game_date,
      gameTime: row.game_time,
      leagueName: row.league_name || null,
      position: row.position,
      message: row.message,
      requestType: row.request_type,
      requesterEmail: row.requester_email,
      requesterPhone: row.requester_phone,
      inviteDeclinedAt: inviteDeclinedAt || null,
      createdAt: row.created_at,
    };
  });
}

export async function listUpcomingOwnSpareRequests(memberId: number) {
  const { db, schema } = getDrizzleDb();
  const today = await getCurrentDateStringAsync();

  const requests = await db
    .select({
      id: schema.spareRequests.id,
      league_name: schema.leagues.name,
      requester_id: schema.spareRequests.requester_id,
      requested_for_name: schema.spareRequests.requested_for_name,
      requested_for_member_id: schema.spareRequests.requested_for_member_id,
      game_date: schema.spareRequests.game_date,
      game_time: schema.spareRequests.game_time,
      position: schema.spareRequests.position,
      message: schema.spareRequests.message,
      request_type: schema.spareRequests.request_type,
      status: schema.spareRequests.status,
      filled_by_name: schema.members.name,
      filled_by_email: schema.members.email,
      filled_by_phone: schema.members.phone,
      filled_at: schema.spareRequests.filled_at,
      cancelled_by_member_id: schema.spareRequests.cancelled_by_member_id,
      notifications_sent_at: schema.spareRequests.notifications_sent_at,
      had_cancellation: schema.spareRequests.had_cancellation,
      created_at: schema.spareRequests.created_at,
      sparer_comment: schema.spareResponses.comment,
    })
    .from(schema.spareRequests)
    .leftJoin(schema.members, eq(schema.spareRequests.filled_by_member_id, schema.members.id))
    .leftJoin(schema.leagues, eq(schema.spareRequests.league_id, schema.leagues.id))
    .leftJoin(schema.spareResponses, eq(schema.spareRequests.id, schema.spareResponses.spare_request_id))
    .where(
      and(
        or(eq(schema.spareRequests.requester_id, memberId), eq(schema.spareRequests.requested_for_member_id, memberId))!,
        gte(schema.spareRequests.game_date, today),
      ),
    )
    .orderBy(
      sql`CASE
        WHEN ${schema.spareRequests.status} = 'open' THEN 1
        WHEN ${schema.spareRequests.status} = 'filled' THEN 2
        WHEN ${schema.spareRequests.status} = 'cancelled' THEN 3
        ELSE 4
      END`,
      asc(schema.spareRequests.game_date),
      asc(schema.spareRequests.game_time),
    );

  const privateRequestIds = requests.filter((row) => row.request_type === 'private').map((row) => row.id);
  const inviteMap = new Map<number, { name: string; status: 'pending' | 'declined' }[]>();
  if (privateRequestIds.length > 0) {
    const inviteRows = await db
      .select({
        request_id: schema.spareRequestInvitations.spare_request_id,
        name: schema.members.name,
        declined_at: schema.spareRequestInvitations.declined_at,
      })
      .from(schema.spareRequestInvitations)
      .innerJoin(schema.members, eq(schema.spareRequestInvitations.member_id, schema.members.id))
      .where(inArray(schema.spareRequestInvitations.spare_request_id, privateRequestIds))
      .orderBy(asc(schema.members.name));

    for (const row of inviteRows) {
      const list = inviteMap.get(Number(row.request_id)) || [];
      list.push({ name: String(row.name), status: row.declined_at ? 'declined' : 'pending' });
      inviteMap.set(Number(row.request_id), list);
    }
  }

  const requesterIds = [...new Set(requests.map((row) => row.requester_id))];
  const requesterNameMap = await loadMemberNameMap(requesterIds);
  const cancellerIds = [
    ...new Set(requests.map((row) => row.cancelled_by_member_id).filter((id): id is number => Boolean(id))),
  ];
  const cancellerNameMap = await loadMemberNameMap(cancellerIds);

  return requests.map((row) => {
    const invites = row.request_type === 'private' ? inviteMap.get(row.id) || [] : undefined;
    const declinedCount = invites ? invites.filter((invite) => invite.status === 'declined').length : 0;
    const pendingCount = invites ? invites.filter((invite) => invite.status === 'pending').length : 0;

    return {
      id: row.id,
      requestedForName: row.requested_for_name,
      requestedForMemberId: row.requested_for_member_id,
      gameDate: row.game_date,
      gameTime: row.game_time,
      leagueName: row.league_name || null,
      position: row.position,
      message: row.message,
      requestType: row.request_type,
      status: row.status,
      requesterId: row.requester_id,
      requesterName: requesterNameMap.get(row.requester_id) || null,
      cancelledByName: row.cancelled_by_member_id ? cancellerNameMap.get(row.cancelled_by_member_id) || null : null,
      filledByName: row.filled_by_name,
      filledByEmail: row.filled_by_email,
      filledByPhone: row.filled_by_phone,
      filledAt: row.filled_at,
      sparerComment: row.sparer_comment,
      notificationsSentAt: row.notifications_sent_at,
      hadCancellation: row.had_cancellation === 1,
      invites,
      inviteCounts: invites ? { total: invites.length, pending: pendingCount, declined: declinedCount } : undefined,
      createdAt: row.created_at,
    };
  });
}

export async function listPastOwnSpareRequests(memberId: number) {
  const { db, schema } = getDrizzleDb();
  const today = await getCurrentDateStringAsync();
  const now = await getCurrentTimeAsync();
  const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const requests = await db
    .select({
      id: schema.spareRequests.id,
      requester_id: schema.spareRequests.requester_id,
      requested_for_name: schema.spareRequests.requested_for_name,
      requested_for_member_id: schema.spareRequests.requested_for_member_id,
      game_date: schema.spareRequests.game_date,
      game_time: schema.spareRequests.game_time,
      position: schema.spareRequests.position,
      message: schema.spareRequests.message,
      request_type: schema.spareRequests.request_type,
      status: schema.spareRequests.status,
      filled_by_name: schema.members.name,
      filled_by_email: schema.members.email,
      filled_by_phone: schema.members.phone,
      filled_at: schema.spareRequests.filled_at,
      cancelled_by_member_id: schema.spareRequests.cancelled_by_member_id,
      notifications_sent_at: schema.spareRequests.notifications_sent_at,
      had_cancellation: schema.spareRequests.had_cancellation,
      created_at: schema.spareRequests.created_at,
      sparer_comment: schema.spareResponses.comment,
    })
    .from(schema.spareRequests)
    .leftJoin(schema.members, eq(schema.spareRequests.filled_by_member_id, schema.members.id))
    .leftJoin(schema.spareResponses, eq(schema.spareRequests.id, schema.spareResponses.spare_request_id))
    .where(
      and(
        or(eq(schema.spareRequests.requester_id, memberId), eq(schema.spareRequests.requested_for_member_id, memberId))!,
        or(
          sql`${schema.spareRequests.game_date} < ${today}`,
          and(eq(schema.spareRequests.game_date, today), sql`${schema.spareRequests.game_time} < ${nowTime}`),
        ),
      ),
    )
    .orderBy(desc(schema.spareRequests.game_date), desc(schema.spareRequests.game_time));

  const requesterIds = [...new Set(requests.map((row) => row.requester_id))];
  const requesterNameMap = await loadMemberNameMap(requesterIds);
  const cancellerIds = [
    ...new Set(requests.map((row) => row.cancelled_by_member_id).filter((id): id is number => Boolean(id))),
  ];
  const cancellerNameMap = await loadMemberNameMap(cancellerIds);

  return requests.map((row) => ({
    id: row.id,
    requestedForName: row.requested_for_name,
    requestedForMemberId: row.requested_for_member_id,
    gameDate: row.game_date,
    gameTime: row.game_time,
    position: row.position,
    message: row.message,
    requestType: row.request_type,
    status: row.status,
    requesterId: row.requester_id,
    requesterName: requesterNameMap.get(row.requester_id) || null,
    cancelledByName: row.cancelled_by_member_id ? cancellerNameMap.get(row.cancelled_by_member_id) || null : null,
    filledByName: row.filled_by_name,
    filledByEmail: row.filled_by_email,
    filledByPhone: row.filled_by_phone,
    filledAt: row.filled_at,
    sparerComment: row.sparer_comment,
    notificationsSentAt: row.notifications_sent_at,
    hadCancellation: row.had_cancellation === 1,
    createdAt: row.created_at,
  }));
}

export async function listUpcomingSparingAssignments(memberId: number) {
  const { db, schema } = getDrizzleDb();
  const today = await getCurrentDateStringAsync();

  const requests = await db
    .select({
      id: schema.spareRequests.id,
      league_name: schema.leagues.name,
      requester_name: schema.members.name,
      requester_email: schema.members.email,
      requester_phone: schema.members.phone,
      requested_for_name: schema.spareRequests.requested_for_name,
      game_date: schema.spareRequests.game_date,
      game_time: schema.spareRequests.game_time,
      position: schema.spareRequests.position,
      message: schema.spareRequests.message,
      request_type: schema.spareRequests.request_type,
      created_at: schema.spareRequests.created_at,
    })
    .from(schema.spareRequests)
    .innerJoin(schema.members, eq(schema.spareRequests.requester_id, schema.members.id))
    .leftJoin(schema.leagues, eq(schema.spareRequests.league_id, schema.leagues.id))
    .where(
      and(
        eq(schema.spareRequests.filled_by_member_id, memberId),
        eq(schema.spareRequests.status, 'filled'),
        gte(schema.spareRequests.game_date, today),
      ),
    )
    .orderBy(asc(schema.spareRequests.game_date), asc(schema.spareRequests.game_time));

  return requests.map((row) => ({
    id: row.id,
    requesterName: row.requester_name,
    requesterEmail: row.requester_email,
    requesterPhone: row.requester_phone,
    requestedForName: row.requested_for_name,
    gameDate: row.game_date,
    gameTime: row.game_time,
    leagueName: row.league_name || null,
    position: row.position,
    message: row.message,
    requestType: row.request_type,
    createdAt: row.created_at,
  }));
}

export async function listFilledUpcomingSpareRequests(memberId: number) {
  const { db, schema } = getDrizzleDb();
  const today = await getCurrentDateStringAsync();

  const rowsRaw = await db
    .select({
      id: schema.spareRequests.id,
      league_name: schema.leagues.name,
      requester_name: schema.members.name,
      filled_by_member_id: schema.spareRequests.filled_by_member_id,
      requested_for_name: schema.spareRequests.requested_for_name,
      game_date: schema.spareRequests.game_date,
      game_time: schema.spareRequests.game_time,
      position: schema.spareRequests.position,
      message: schema.spareRequests.message,
      request_type: schema.spareRequests.request_type,
      filled_at: schema.spareRequests.filled_at,
      created_at: schema.spareRequests.created_at,
    })
    .from(schema.spareRequests)
    .innerJoin(schema.members, eq(schema.spareRequests.requester_id, schema.members.id))
    .leftJoin(schema.leagues, eq(schema.spareRequests.league_id, schema.leagues.id))
    .where(
      and(
        eq(schema.spareRequests.status, 'filled'),
        eq(schema.spareRequests.request_type, 'public'),
        gte(schema.spareRequests.game_date, today),
        ne(schema.spareRequests.requester_id, memberId),
        ne(schema.spareRequests.filled_by_member_id, memberId),
        or(
          isNull(schema.spareRequests.requested_for_member_id),
          ne(schema.spareRequests.requested_for_member_id, memberId),
        )!,
        sql`NOT EXISTS (
          SELECT 1
          FROM ${schema.spareRequestInvitations}
          WHERE ${schema.spareRequestInvitations.spare_request_id} = ${schema.spareRequests.id}
            AND ${schema.spareRequestInvitations.member_id} = ${memberId}
        )`,
      ),
    )
    .orderBy(asc(schema.spareRequests.game_date), asc(schema.spareRequests.game_time));

  const filledByIds = rowsRaw.map((row) => row.filled_by_member_id).filter((id): id is number => id !== null);
  const filledByNameMap = await loadMemberNameMap([...new Set(filledByIds)]);

  return rowsRaw.map((row) => ({
    id: row.id,
    requesterName: row.requester_name,
    requestedForName: row.requested_for_name,
    gameDate: row.game_date,
    gameTime: row.game_time,
    leagueName: row.league_name || null,
    position: row.position,
    message: row.message,
    requestType: row.request_type,
    filledByName: row.filled_by_member_id ? filledByNameMap.get(row.filled_by_member_id) || null : null,
    filledAt: row.filled_at,
    createdAt: row.created_at,
  }));
}

export async function listInvitationsForRequester(requestId: number, requesterId: number) {
  const { db, schema } = getDrizzleDb();
  const spareRequest = await loadSpareRequestForRequester(requestId, requesterId);
  if (spareRequest.request_type !== 'private') {
    throw new SpareQueryError(400, 'Not a private request');
  }

  const rows = await db
    .select({
      member_id: schema.members.id,
      name: schema.members.name,
      email: schema.members.email,
      declined_at: schema.spareRequestInvitations.declined_at,
      decline_comment: schema.spareRequestInvitations.decline_comment,
      created_at: schema.spareRequestInvitations.created_at,
    })
    .from(schema.spareRequestInvitations)
    .innerJoin(schema.members, eq(schema.spareRequestInvitations.member_id, schema.members.id))
    .where(eq(schema.spareRequestInvitations.spare_request_id, requestId))
    .orderBy(asc(schema.members.name));

  return rows.map((row) => ({
    memberId: row.member_id,
    name: row.name,
    email: row.email,
    status: row.declined_at ? 'declined' : 'pending',
    declinedAt: row.declined_at || null,
    declineComment: row.decline_comment || null,
    invitedAt: row.created_at,
  }));
}

export async function getSpareStatusForViewer(requestId: number, memberId: number) {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.spareRequests.id,
      requester_id: schema.spareRequests.requester_id,
      request_type: schema.spareRequests.request_type,
      status: schema.spareRequests.status,
    })
    .from(schema.spareRequests)
    .where(eq(schema.spareRequests.id, requestId))
    .limit(1);

  const spareRequest = rows[0];
  if (!spareRequest) {
    throw new SpareQueryError(404, 'Spare request not found');
  }
  if (spareRequest.request_type === 'public' || spareRequest.requester_id === memberId) {
    return { id: spareRequest.id, status: spareRequest.status };
  }

  const [invite, cc] = await Promise.all([
    db
      .select({ id: schema.spareRequestInvitations.id })
      .from(schema.spareRequestInvitations)
      .where(
        and(eq(schema.spareRequestInvitations.spare_request_id, requestId), eq(schema.spareRequestInvitations.member_id, memberId)),
      )
      .limit(1),
    db
      .select({ id: schema.spareRequestCcs.id })
      .from(schema.spareRequestCcs)
      .where(and(eq(schema.spareRequestCcs.spare_request_id, requestId), eq(schema.spareRequestCcs.member_id, memberId)))
      .limit(1),
  ]);

  if (invite.length > 0 || cc.length > 0) {
    return { id: spareRequest.id, status: spareRequest.status };
  }

  throw new SpareQueryError(403, 'Forbidden');
}

export async function getNotificationStatusForRequester(requestId: number, requesterId: number) {
  const { db, schema } = getDrizzleDb();
  const spareRequest = await loadSpareRequestForRequester(requestId, requesterId);

  const [queueCountRows, notifiedCountRows] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.spareRequestNotificationQueue)
      .where(eq(schema.spareRequestNotificationQueue.spare_request_id, requestId)),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.spareRequestNotificationQueue)
      .where(
        and(
          eq(schema.spareRequestNotificationQueue.spare_request_id, requestId),
          isNotNull(schema.spareRequestNotificationQueue.notified_at),
        ),
      ),
  ]);

  let totalMembers = Number(queueCountRows[0]?.count || 0);
  let notifiedMembers = Number(notifiedCountRows[0]?.count || 0);

  if (spareRequest.notification_status === 'completed' && totalMembers === 0) {
    if (spareRequest.request_type === 'private') {
      const invitationRows = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(schema.spareRequestInvitations)
        .where(eq(schema.spareRequestInvitations.spare_request_id, requestId));
      const invitationCount = Number(invitationRows[0]?.count || 0);
      if (invitationCount > 0) {
        totalMembers = invitationCount;
        notifiedMembers = invitationCount;
      }
    } else if (spareRequest.request_type === 'public') {
      const [year, month, day] = normalizeDateString(spareRequest.game_date).split('-').map(Number);
      const gameDateObj = new Date(year, month - 1, day);
      const dayOfWeek = gameDateObj.getDay();

      const matchingLeagues = await db
        .select()
        .from(schema.leagues)
        .where(
          and(
            eq(schema.leagues.day_of_week, dayOfWeek),
            sql`date(${schema.leagues.start_date}) <= date(${normalizeDateString(spareRequest.game_date)})`,
            sql`date(${schema.leagues.end_date}) >= date(${normalizeDateString(spareRequest.game_date)})`,
          ),
        );

      if (matchingLeagues.length > 0) {
        const leagueIds = matchingLeagues.map((league) => league.id);
        const conditions = [
          inArray(schema.memberAvailability.league_id, leagueIds),
          eq(schema.memberAvailability.available, 1),
          eq(schema.members.email_subscribed, 1),
          eq(schema.members.social_member, 0),
          ne(schema.members.id, spareRequest.requester_id),
        ];

        if (spareRequest.position === 'skip') {
          conditions.push(eq(schema.memberAvailability.can_skip, 1));
        }

        const matchingCountRows = await db
          .select({ count: sql<number>`COUNT(DISTINCT ${schema.members.id})` })
          .from(schema.members)
          .innerJoin(schema.memberAvailability, eq(schema.members.id, schema.memberAvailability.member_id))
          .where(and(...conditions));

        const matchingCount = Number(matchingCountRows[0]?.count || 0);
        if (matchingCount > 0) {
          totalMembers = matchingCount;
          notifiedMembers = matchingCount;
        }
      }
    }
  }

  return {
    notificationStatus: spareRequest.notification_status || null,
    totalMembers,
    notifiedMembers,
    nextNotificationAt: spareRequest.next_notification_at || null,
    notificationPaused: spareRequest.notification_paused === 1,
  };
}

export { normalizeDateString, normalizeTimeString };
