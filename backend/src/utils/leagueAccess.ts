import { Member } from '../types.js';
import { isAdmin, isServerAdmin } from './auth.js';
import { hasScope } from './rbac.js';

export interface LeagueManagerRoleInfo {
  isGlobal: boolean;
  leagueIds: number[];
}

function getLeagueRoleInfoFromClaims(member: Member): LeagueManagerRoleInfo {
  const claims = member.authz;
  if (!claims) return { isGlobal: false, leagueIds: [] };

  const leagueIds = new Set<number>();
  for (const rule of claims.scopeRules ?? []) {
    if (rule.effect !== 'allow') continue;
    if (rule.scope !== 'leagues.manage' && rule.scope !== 'leagues.*' && rule.scope !== '*') continue;
    if (rule.resourceType !== 'league') continue;
    if (rule.resourceId === null || rule.resourceId === undefined) continue;
    leagueIds.add(Number(rule.resourceId));
  }

  return {
    isGlobal: hasScope(claims, 'leagues.manage'),
    leagueIds: Array.from(leagueIds),
  };
}

export async function getLeagueManagerRoleInfo(_memberId: number): Promise<LeagueManagerRoleInfo> {
  // Kept for backwards compatibility with existing call sites.
  return { isGlobal: false, leagueIds: [] };
}

export async function getLeagueAdministratorRoleInfo(_memberId: number): Promise<LeagueManagerRoleInfo> {
  // Kept for backwards compatibility with existing call sites.
  return { isGlobal: false, leagueIds: [] };
}

export async function hasClubLeagueAdministratorAccess(member: Member): Promise<boolean> {
  if (isAdmin(member) || isServerAdmin(member)) return true;
  const roleInfo = getLeagueRoleInfoFromClaims(member);
  return roleInfo.isGlobal;
}

export async function hasLeagueAdministratorAccess(member: Member, leagueId: number): Promise<boolean> {
  if (isAdmin(member) || isServerAdmin(member)) return true;
  const roleInfo = getLeagueRoleInfoFromClaims(member);
  return roleInfo.isGlobal || roleInfo.leagueIds.includes(leagueId);
}

export async function hasLeagueSetupAccess(member: Member, leagueId: number): Promise<boolean> {
  if (await hasLeagueAdministratorAccess(member, leagueId)) return true;
  return hasLeagueManagerAccess(member, leagueId);
}

export async function hasLeagueManagerAccess(member: Member, leagueId: number): Promise<boolean> {
  if (await hasLeagueAdministratorAccess(member, leagueId)) return true;
  const roleInfo = getLeagueRoleInfoFromClaims(member);
  return roleInfo.leagueIds.includes(leagueId);
}
