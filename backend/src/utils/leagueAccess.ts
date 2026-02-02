import { and, eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { Member } from '../types.js';
import { isAdmin, isServerAdmin } from './auth.js';

export interface LeagueManagerRoleInfo {
  isGlobal: boolean;
  leagueIds: number[];
}

type LeagueRole = 'league_manager' | 'league_administrator';

const LEAGUE_ADMIN_ROLES: LeagueRole[] = ['league_administrator'];
const LEAGUE_MANAGER_ROLES: LeagueRole[] = ['league_manager'];

async function getLeagueRoleInfo(
  memberId: number,
  roles: LeagueRole[],
  globalRoles: LeagueRole[] = roles
): Promise<LeagueManagerRoleInfo> {
  try {
    const { db, schema } = getDrizzleDb();
    const rows = (await db
      .select({ league_id: schema.leagueMemberRoles.league_id, role: schema.leagueMemberRoles.role })
      .from(schema.leagueMemberRoles)
      .where(
        and(
          eq(schema.leagueMemberRoles.member_id, memberId),
          inArray(schema.leagueMemberRoles.role, roles)
        )
      )) as { league_id: number | null; role: LeagueRole }[];

    const validRows = rows.filter((row): row is { league_id: number | null; role: LeagueRole } => Boolean(row));
    const leagueIds = validRows
      .map((row) => row.league_id)
      .filter((value): value is number => value !== null && value !== undefined);

    const globalRoleSet = new Set(globalRoles);
    const isGlobal = validRows.some(
      (row) => (row.league_id === null || row.league_id === undefined) && globalRoleSet.has(row.role)
    );

    return { isGlobal, leagueIds };
  } catch {
    // If the roles table doesn't exist yet, or any other error occurs, default to no access.
    return { isGlobal: false, leagueIds: [] };
  }
}

export async function getLeagueManagerRoleInfo(memberId: number): Promise<LeagueManagerRoleInfo> {
  return getLeagueRoleInfo(memberId, LEAGUE_MANAGER_ROLES, []);
}

export async function getLeagueAdministratorRoleInfo(memberId: number): Promise<LeagueManagerRoleInfo> {
  return getLeagueRoleInfo(memberId, LEAGUE_ADMIN_ROLES, LEAGUE_ADMIN_ROLES);
}

export async function hasClubLeagueAdministratorAccess(member: Member): Promise<boolean> {
  if (isAdmin(member) || isServerAdmin(member)) return true;
  const roleInfo = await getLeagueAdministratorRoleInfo(member.id);
  return roleInfo.isGlobal;
}

export async function hasLeagueAdministratorAccess(member: Member, leagueId: number): Promise<boolean> {
  if (isAdmin(member) || isServerAdmin(member)) return true;
  const roleInfo = await getLeagueAdministratorRoleInfo(member.id);
  return roleInfo.isGlobal;
}

export async function hasLeagueSetupAccess(member: Member, leagueId: number): Promise<boolean> {
  if (await hasLeagueAdministratorAccess(member, leagueId)) return true;
  return hasLeagueManagerAccess(member, leagueId);
}

export async function hasLeagueManagerAccess(member: Member, leagueId: number): Promise<boolean> {
  if (await hasLeagueAdministratorAccess(member, leagueId)) return true;
  const roleInfo = await getLeagueManagerRoleInfo(member.id);
  return roleInfo.leagueIds.includes(leagueId);
}
