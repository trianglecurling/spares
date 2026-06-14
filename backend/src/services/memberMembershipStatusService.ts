import { and, asc, desc, eq, gt, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';

type DrizzleSchema = ReturnType<typeof getDrizzleDb>['schema'];
import type { SeasonMembershipStatusSqlite } from '../db/drizzle-schema.js';
import { isAdmin, isServerAdmin } from '../utils/auth.js';
import { getCurrentDateStringAsync } from '../utils/time.js';
import type { Member, MemberMembershipStatus } from '../types.js';

const ACTIVE_MEMBERSHIP_STATUSES: SeasonMembershipStatusSqlite[] = ['pending', 'active'];

function normalizeDateString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.split('T')[0];
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
}

function dateColumnBindValue(dateString: string): Date | string {
  if (getDatabaseConfig()?.type === 'postgres') {
    return new Date(`${dateString}T00:00:00`);
  }
  return dateString;
}

function isExpiredDate(validThrough: string | null, today: string): boolean {
  if (!validThrough) return true;
  return today > validThrough;
}

function deriveMembershipStatus(input: {
  today: string;
  isLifetimeMember: boolean;
  latestMembership: {
    membershipType: 'regular' | 'social' | 'junior_recreational';
    status: SeasonMembershipStatusSqlite;
    endsAt: string;
  } | null;
  hasSpareOnlyIcePrivilege: boolean;
  onSessionRoster: boolean;
}): MemberMembershipStatus {
  if (input.isLifetimeMember) {
    return {
      validThrough: null,
      isSocialMember: false,
      isSpareOnly: false,
      isActive: true,
    };
  }

  if (!input.latestMembership) {
    return {
      validThrough: null,
      isSocialMember: false,
      isSpareOnly: false,
      isActive: false,
    };
  }

  const validThrough = normalizeDateString(input.latestMembership.endsAt);
  const statusIsActive = ACTIVE_MEMBERSHIP_STATUSES.includes(input.latestMembership.status);
  const isActive = statusIsActive && validThrough !== null && !isExpiredDate(validThrough, input.today);
  const isSocialMember =
    isActive && input.latestMembership.membershipType === 'social';
  const isSpareOnly =
    isActive &&
    !isSocialMember &&
    input.hasSpareOnlyIcePrivilege &&
    !input.onSessionRoster;

  return {
    validThrough: isActive ? validThrough : validThrough,
    isSocialMember,
    isSpareOnly,
    isActive,
  };
}

async function loadLatestActiveSeasonMembership(memberId: number, today: string) {
  const { db, schema } = getDrizzleDb();
  const todayValue = dateColumnBindValue(today);
  const rows = await db
    .select({
      membershipType: schema.seasonMemberships.membership_type,
      status: schema.seasonMemberships.status,
      endsAt: schema.seasonMemberships.ends_at,
    })
    .from(schema.seasonMemberships)
    .where(
      and(
        eq(schema.seasonMemberships.member_id, memberId),
        inArray(schema.seasonMemberships.status, ACTIVE_MEMBERSHIP_STATUSES),
        gte(schema.seasonMemberships.ends_at, todayValue as never),
      ),
    )
    .orderBy(desc(schema.seasonMemberships.ends_at))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const endsAt = normalizeDateString(row.endsAt);
  if (!endsAt) return null;
  return {
    membershipType: row.membershipType,
    status: row.status,
    endsAt,
  };
}

async function resolveCurrentSessionId(today: string): Promise<number | null> {
  const { db, schema } = getDrizzleDb();
  const todayValue = dateColumnBindValue(today);

  const [currentSession] = await db
    .select({ id: schema.curlingSessions.id })
    .from(schema.curlingSessions)
    .where(
      and(
        lte(schema.curlingSessions.start_date, todayValue as never),
        gte(schema.curlingSessions.end_date, todayValue as never),
      ),
    )
    .orderBy(desc(schema.curlingSessions.start_date))
    .limit(1);

  if (currentSession) return currentSession.id;

  const [upcomingSession] = await db
    .select({ id: schema.curlingSessions.id })
    .from(schema.curlingSessions)
    .where(gt(schema.curlingSessions.start_date, todayValue as never))
    .orderBy(asc(schema.curlingSessions.start_date))
    .limit(1);

  return upcomingSession?.id ?? null;
}

async function memberHasSpareOnlyIcePrivilege(memberId: number, sessionId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ id: schema.curlingIcePrivileges.id })
    .from(schema.curlingIcePrivileges)
    .where(
      and(
        eq(schema.curlingIcePrivileges.member_id, memberId),
        eq(schema.curlingIcePrivileges.session_id, sessionId),
        eq(schema.curlingIcePrivileges.source_type, 'spare_only'),
        eq(schema.curlingIcePrivileges.status, 'active'),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function memberOnSessionRoster(memberId: number, sessionId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({ id: schema.leagueRoster.id })
    .from(schema.leagueRoster)
    .innerJoin(schema.leagues, eq(schema.leagueRoster.league_id, schema.leagues.id))
    .where(
      and(
        eq(schema.leagueRoster.member_id, memberId),
        eq(schema.leagueRoster.status, 'active'),
        eq(schema.leagues.session_id, sessionId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function getMemberMembershipStatus(
  memberId: number,
  options?: { isLifetimeMember?: boolean; today?: string },
): Promise<MemberMembershipStatus> {
  const today = options?.today ?? (await getCurrentDateStringAsync());
  const isLifetimeMember = options?.isLifetimeMember ?? false;

  const [latestMembership, sessionId] = await Promise.all([
    loadLatestActiveSeasonMembership(memberId, today),
    resolveCurrentSessionId(today),
  ]);

  let hasSpareOnlyIcePrivilege = false;
  let onSessionRoster = false;
  if (sessionId) {
    [hasSpareOnlyIcePrivilege, onSessionRoster] = await Promise.all([
      memberHasSpareOnlyIcePrivilege(memberId, sessionId),
      memberOnSessionRoster(memberId, sessionId),
    ]);
  }

  return deriveMembershipStatus({
    today,
    isLifetimeMember,
    latestMembership,
    hasSpareOnlyIcePrivilege,
    onSessionRoster,
  });
}

export async function getMemberMembershipStatusMap(
  memberIds: number[],
  lifetimeMemberById: Map<number, boolean>,
  today?: string,
): Promise<Map<number, MemberMembershipStatus>> {
  const result = new Map<number, MemberMembershipStatus>();
  if (memberIds.length === 0) return result;

  const todayStr = today ?? (await getCurrentDateStringAsync());
  await Promise.all(
    memberIds.map(async (memberId) => {
      const status = await getMemberMembershipStatus(memberId, {
        isLifetimeMember: lifetimeMemberById.get(memberId) ?? false,
        today: todayStr,
      });
      result.set(memberId, status);
    }),
  );
  return result;
}

export function isMemberExpiredForAccess(
  member: Pick<Member, 'lifetime_member' | 'is_server_admin'>,
  status: MemberMembershipStatus,
): boolean {
  if (isAdmin(member as Member) || isServerAdmin(member as Member)) return false;
  if ((member.lifetime_member ?? 0) === 1) return false;
  return !status.isActive;
}

export function isMemberActiveForRbac(
  member: Pick<Member, 'lifetime_member'>,
  status: MemberMembershipStatus,
): boolean {
  if ((member.lifetime_member ?? 0) === 1) return true;
  return status.isActive;
}

export function hasIcePrivilegesForRbac(
  member: Pick<Member, 'lifetime_member'>,
  status: MemberMembershipStatus,
): boolean {
  return isMemberActiveForRbac(member, status) && !status.isSocialMember;
}

/** SQL: member has lifetime status or a non-expired active/pending season membership. */
export function memberHasActiveMembershipCondition(schema: DrizzleSchema, today: string) {
  return or(
    eq(schema.members.lifetime_member, 1),
    sql`EXISTS (
      SELECT 1 FROM season_memberships sm
      WHERE sm.member_id = ${schema.members.id}
        AND sm.status IN ('pending', 'active')
        AND sm.ends_at >= ${today}
    )`,
  );
}

/** SQL: member does not have an active social season membership. */
export function memberIsNotSocialCondition(schema: DrizzleSchema, today: string) {
  return sql`NOT EXISTS (
    SELECT 1 FROM season_memberships sm
    WHERE sm.member_id = ${schema.members.id}
      AND sm.status IN ('pending', 'active')
      AND sm.ends_at >= ${today}
      AND sm.membership_type = 'social'
  )`;
}
