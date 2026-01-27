import { and, eq, isNull, or } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { Member } from '../types.js';
import { isAdmin, isServerAdmin } from './auth.js';

export interface LeagueManagerRoleInfo {
  isGlobal: boolean;
  leagueIds: number[];
}

export async function getLeagueManagerRoleInfo(memberId: number): Promise<LeagueManagerRoleInfo> {
  try {
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select({ league_id: schema.leagueMemberRoles.league_id })
      .from(schema.leagueMemberRoles)
      .where(
        and(
          eq(schema.leagueMemberRoles.member_id, memberId),
          eq(schema.leagueMemberRoles.role, 'league_manager')
        )
      );

    const validRows = rows.filter((row): row is { league_id: number | null } => Boolean(row));
    const leagueIds = validRows
      .map((row) => row.league_id)
      .filter((value): value is number => value !== null && value !== undefined);

    const isGlobal = validRows.some((row) => row.league_id === null || row.league_id === undefined);

    return { isGlobal, leagueIds };
  } catch {
    // If the roles table doesn't exist yet, or any other error occurs, default to no access.
    return { isGlobal: false, leagueIds: [] };
  }
}

export async function hasClubLeagueManagerAccess(member: Member): Promise<boolean> {
  if (isAdmin(member) || isServerAdmin(member)) return true;
  const roleInfo = await getLeagueManagerRoleInfo(member.id);
  return roleInfo.isGlobal;
}

export async function hasLeagueManagerAccess(member: Member, leagueId: number): Promise<boolean> {
  if (isAdmin(member) || isServerAdmin(member)) return true;
  const roleInfo = await getLeagueManagerRoleInfo(member.id);
  if (roleInfo.isGlobal) return true;
  return roleInfo.leagueIds.includes(leagueId);
}

export async function isLeagueManagerForLeagueId(memberId: number, leagueId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.leagueMemberRoles.id })
    .from(schema.leagueMemberRoles)
    .where(
      and(
        eq(schema.leagueMemberRoles.member_id, memberId),
        eq(schema.leagueMemberRoles.role, 'league_manager'),
        or(eq(schema.leagueMemberRoles.league_id, leagueId), isNull(schema.leagueMemberRoles.league_id))
      )
    )
    .limit(1);

  return rows.length > 0;
}
