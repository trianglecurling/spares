import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { CurlingLeagueSabbaticalStatusSqlite } from '../db/drizzle-schema.js';

export class SabbaticalStaffValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Sabbatical staff operation failed');
  }
}

const ACTIVE_SABBATICAL_STATUSES: CurlingLeagueSabbaticalStatusSqlite[] = [
  'active',
  'returning',
  'staff_overridden',
];

const SIMULTANEOUS_SABBATICAL_LIMIT = 2;

function normalizeDateString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.split('T')[0];
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
}

function requireReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? '';
  if (!trimmed) {
    throw new SabbaticalStaffValidationError({ reason: 'A reason is required.' });
  }
  return trimmed;
}

async function loadLeague(leagueId: number) {
  const { db, schema } = getDrizzleDb();
  const [league] = await db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);
  if (!league) {
    throw new SabbaticalStaffValidationError({ league: 'League not found.' });
  }
  return league;
}

export async function listLeagueSabbaticals(leagueId: number) {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.curlingLeagueSabbaticals.id,
      memberId: schema.curlingLeagueSabbaticals.member_id,
      name: schema.members.name,
      email: schema.members.email,
      status: schema.curlingLeagueSabbaticals.status,
      firstSabbaticalStartDate: schema.curlingLeagueSabbaticals.first_sabbatical_start_date,
      staffOverride: schema.curlingLeagueSabbaticals.staff_override,
      staffOverrideReason: schema.curlingLeagueSabbaticals.staff_override_reason,
      sourceRegistrationId: schema.curlingLeagueSabbaticals.source_registration_id,
      createdAt: schema.curlingLeagueSabbaticals.created_at,
    })
    .from(schema.curlingLeagueSabbaticals)
    .innerJoin(schema.members, eq(schema.curlingLeagueSabbaticals.member_id, schema.members.id))
    .where(
      and(
        eq(schema.curlingLeagueSabbaticals.current_league_id, leagueId),
        inArray(schema.curlingLeagueSabbaticals.status, ACTIVE_SABBATICAL_STATUSES)
      )
    )
    .orderBy(asc(schema.members.name));

  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    name: row.name,
    email: row.email,
    status: row.status,
    firstSabbaticalStartDate: normalizeDateString(row.firstSabbaticalStartDate),
    staffOverride: Boolean(row.staffOverride),
    staffOverrideReason: row.staffOverrideReason,
    sourceRegistrationId: row.sourceRegistrationId,
    createdAt: row.createdAt ? normalizeDateString(row.createdAt) : null,
  }));
}

export async function addLeagueSabbatical(input: {
  leagueId: number;
  memberId: number;
  reason: string;
  actorMemberId: number;
}) {
  const reason = requireReason(input.reason);
  const league = await loadLeague(input.leagueId);

  if (league.league_type === 'bring_your_own_team') {
    throw new SabbaticalStaffValidationError({
      league: 'Bring-your-own-team leagues do not use sabbaticals.',
    });
  }
  if (league.allows_sabbatical !== 1) {
    throw new SabbaticalStaffValidationError({ league: 'This league does not allow sabbaticals.' });
  }

  const { db, schema } = getDrizzleDb();

  const [member] = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.id, input.memberId))
    .limit(1);
  if (!member) {
    throw new SabbaticalStaffValidationError({ member: 'Member not found.' });
  }

  const [existingSabbatical] = await db
    .select({ id: schema.curlingLeagueSabbaticals.id })
    .from(schema.curlingLeagueSabbaticals)
    .where(
      and(
        eq(schema.curlingLeagueSabbaticals.member_id, input.memberId),
        eq(schema.curlingLeagueSabbaticals.current_league_id, input.leagueId),
        inArray(schema.curlingLeagueSabbaticals.status, ACTIVE_SABBATICAL_STATUSES)
      )
    )
    .limit(1);
  if (existingSabbatical) {
    throw new SabbaticalStaffValidationError({
      member: 'This member is already on sabbatical for this league.',
    });
  }

  const activeSabbaticals = await db
    .select({ id: schema.curlingLeagueSabbaticals.id })
    .from(schema.curlingLeagueSabbaticals)
    .where(
      and(
        eq(schema.curlingLeagueSabbaticals.member_id, input.memberId),
        inArray(schema.curlingLeagueSabbaticals.status, ACTIVE_SABBATICAL_STATUSES)
      )
    );
  if (activeSabbaticals.length >= SIMULTANEOUS_SABBATICAL_LIMIT) {
    throw new SabbaticalStaffValidationError({
      member: `A member may be on sabbatical for at most ${SIMULTANEOUS_SABBATICAL_LIMIT} leagues at the same time.`,
    });
  }

  const [activeRoster] = await db
    .select({ id: schema.leagueRoster.id })
    .from(schema.leagueRoster)
    .where(
      and(
        eq(schema.leagueRoster.league_id, input.leagueId),
        eq(schema.leagueRoster.member_id, input.memberId),
        eq(schema.leagueRoster.status, 'active')
      )
    )
    .limit(1);
  if (activeRoster) {
    throw new SabbaticalStaffValidationError({
      member: 'This member has an active roster placement in this league.',
    });
  }

  const startDate = normalizeDateString(league.first_day_of_play ?? league.start_date);
  if (!startDate) {
    throw new SabbaticalStaffValidationError({
      league: 'League must have a start date before adding sabbaticals.',
    });
  }

  const [created] = await db
    .insert(schema.curlingLeagueSabbaticals)
    .values({
      member_id: input.memberId,
      lineage_key: `${input.memberId}:${input.leagueId}`,
      original_league_id: input.leagueId,
      current_league_id: input.leagueId,
      source_registration_id: null,
      first_sabbatical_league_id: input.leagueId,
      first_sabbatical_start_date: startDate,
      status: 'active',
      staff_override: 1,
      staff_override_reason: reason,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .returning({
      id: schema.curlingLeagueSabbaticals.id,
      memberId: schema.curlingLeagueSabbaticals.member_id,
    });

  return {
    id: created.id,
    leagueId: input.leagueId,
    memberId: created.memberId,
  };
}

export async function removeLeagueSabbatical(input: {
  leagueId: number;
  memberId: number;
  reason: string;
  actorMemberId: number;
}) {
  const reason = requireReason(input.reason);
  const { db, schema } = getDrizzleDb();

  const [sabbatical] = await db
    .select({
      id: schema.curlingLeagueSabbaticals.id,
      status: schema.curlingLeagueSabbaticals.status,
    })
    .from(schema.curlingLeagueSabbaticals)
    .where(
      and(
        eq(schema.curlingLeagueSabbaticals.member_id, input.memberId),
        eq(schema.curlingLeagueSabbaticals.current_league_id, input.leagueId),
        inArray(schema.curlingLeagueSabbaticals.status, ACTIVE_SABBATICAL_STATUSES)
      )
    )
    .limit(1);

  if (!sabbatical) {
    throw new SabbaticalStaffValidationError({
      member: 'Active sabbatical not found for this member in this league.',
    });
  }

  const [temporaryFill] = await db
    .select({ id: schema.leagueRoster.id })
    .from(schema.leagueRoster)
    .where(
      and(
        eq(schema.leagueRoster.league_id, input.leagueId),
        eq(schema.leagueRoster.related_sabbatical_id, sabbatical.id),
        eq(schema.leagueRoster.is_temporary_sabbatical_fill, 1),
        eq(schema.leagueRoster.status, 'active')
      )
    )
    .limit(1);
  if (temporaryFill) {
    throw new SabbaticalStaffValidationError({
      member: 'Cannot remove sabbatical while an active temporary sabbatical-fill placement exists.',
    });
  }

  await db
    .update(schema.curlingLeagueSabbaticals)
    .set({
      status: 'released',
      released_at: sql`CURRENT_TIMESTAMP`,
      released_reason: reason,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(
        eq(schema.curlingLeagueSabbaticals.id, sabbatical.id),
        ne(schema.curlingLeagueSabbaticals.status, 'released')
      )
    );

  return { success: true };
}
