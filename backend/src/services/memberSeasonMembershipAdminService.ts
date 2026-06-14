import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { SeasonMembershipStatusSqlite, SeasonMembershipTypeSqlite } from '../db/drizzle-schema.js';

export type MemberSeasonMembershipRow = {
  id: number;
  seasonId: number;
  seasonName: string;
  membershipType: SeasonMembershipTypeSqlite;
  status: SeasonMembershipStatusSqlite;
  startsAt: string;
  endsAt: string;
  sourceRegistrationId: number | null;
};

const ACTIVE_MEMBERSHIP_STATUSES: SeasonMembershipStatusSqlite[] = ['pending', 'active'];

function normalizeDateString(value: string | Date | number | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dateColumnBindValue(dateString: string): Date | string {
  if (getDatabaseConfig()?.type === 'postgres') {
    return new Date(`${dateString}T00:00:00`);
  }
  return dateString;
}

export async function listMemberSeasonMemberships(memberId: number): Promise<MemberSeasonMembershipRow[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.seasonMemberships.id,
      seasonId: schema.seasonMemberships.season_id,
      seasonName: schema.curlingSeasons.name,
      membershipType: schema.seasonMemberships.membership_type,
      status: schema.seasonMemberships.status,
      startsAt: schema.seasonMemberships.starts_at,
      endsAt: schema.seasonMemberships.ends_at,
      sourceRegistrationId: schema.seasonMemberships.source_registration_id,
    })
    .from(schema.seasonMemberships)
    .innerJoin(schema.curlingSeasons, eq(schema.curlingSeasons.id, schema.seasonMemberships.season_id))
    .where(eq(schema.seasonMemberships.member_id, memberId))
    .orderBy(desc(schema.seasonMemberships.ends_at), desc(schema.seasonMemberships.id));

  return rows.map((row) => ({
    id: row.id,
    seasonId: row.seasonId,
    seasonName: row.seasonName,
    membershipType: row.membershipType,
    status: row.status,
    startsAt: normalizeDateString(row.startsAt),
    endsAt: normalizeDateString(row.endsAt),
    sourceRegistrationId: row.sourceRegistrationId ?? null,
  }));
}

export class MemberSeasonMembershipConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemberSeasonMembershipConflictError';
  }
}

export class MemberSeasonMembershipNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemberSeasonMembershipNotFoundError';
  }
}

export async function createMemberSeasonMembership(input: {
  memberId: number;
  seasonId: number;
  membershipType: SeasonMembershipTypeSqlite;
}): Promise<MemberSeasonMembershipRow> {
  const { db, schema } = getDrizzleDb();

  const [member] = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.id, input.memberId))
    .limit(1);
  if (!member) {
    throw new MemberSeasonMembershipNotFoundError('Member not found');
  }

  const [season] = await db
    .select({
      id: schema.curlingSeasons.id,
      name: schema.curlingSeasons.name,
      startDate: schema.curlingSeasons.start_date,
      endDate: schema.curlingSeasons.end_date,
    })
    .from(schema.curlingSeasons)
    .where(eq(schema.curlingSeasons.id, input.seasonId))
    .limit(1);
  if (!season) {
    throw new MemberSeasonMembershipNotFoundError('Season not found');
  }

  const [existing] = await db
    .select({ id: schema.seasonMemberships.id })
    .from(schema.seasonMemberships)
    .where(
      and(
        eq(schema.seasonMemberships.member_id, input.memberId),
        eq(schema.seasonMemberships.season_id, input.seasonId),
        inArray(schema.seasonMemberships.status, ACTIVE_MEMBERSHIP_STATUSES)
      )
    )
    .limit(1);
  if (existing) {
    throw new MemberSeasonMembershipConflictError('This member already has an active membership for that season.');
  }

  const startsAt = normalizeDateString(season.startDate);
  const endsAt = normalizeDateString(season.endDate);

  const [inserted] = await db
    .insert(schema.seasonMemberships)
    .values({
      member_id: input.memberId,
      season_id: input.seasonId,
      membership_type: input.membershipType,
      starts_at: dateColumnBindValue(startsAt),
      ends_at: dateColumnBindValue(endsAt),
      status: 'active',
    } as any)
    .returning({ id: schema.seasonMemberships.id });

  return {
    id: inserted.id,
    seasonId: season.id,
    seasonName: season.name,
    membershipType: input.membershipType,
    status: 'active',
    startsAt,
    endsAt,
    sourceRegistrationId: null,
  };
}

/** Keep stored membership date bounds aligned when a season's dates change. */
export async function syncSeasonMembershipDatesForSeason(
  seasonId: number,
  dates: { startDate?: string; endDate?: string },
  db = getDrizzleDb().db,
): Promise<void> {
  if (dates.startDate === undefined && dates.endDate === undefined) {
    return;
  }

  const { schema } = getDrizzleDb();
  const updateData: {
    starts_at?: Date | string;
    ends_at?: Date | string;
    updated_at: ReturnType<typeof sql>;
  } = {
    updated_at: sql`CURRENT_TIMESTAMP`,
  };

  if (dates.startDate !== undefined) {
    updateData.starts_at = dateColumnBindValue(dates.startDate);
  }
  if (dates.endDate !== undefined) {
    updateData.ends_at = dateColumnBindValue(dates.endDate);
  }

  await db
    .update(schema.seasonMemberships)
    .set(updateData as any)
    .where(eq(schema.seasonMemberships.season_id, seasonId));
}

export async function deleteMemberSeasonMembership(input: {
  memberId: number;
  membershipId: number;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();

  const [membership] = await db
    .select({
      id: schema.seasonMemberships.id,
      memberId: schema.seasonMemberships.member_id,
    })
    .from(schema.seasonMemberships)
    .where(eq(schema.seasonMemberships.id, input.membershipId))
    .limit(1);

  if (!membership || membership.memberId !== input.memberId) {
    throw new MemberSeasonMembershipNotFoundError('Membership not found');
  }

  await db.delete(schema.seasonMemberships).where(eq(schema.seasonMemberships.id, input.membershipId));
}
