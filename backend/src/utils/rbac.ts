import { eq, inArray } from 'drizzle-orm';
import { config } from '../config.js';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { AuthzClaims, AuthzRule, Member, ScopeContext, ScopeEffect } from '../types.js';

export const RBAC_ROLE_CODES = {
  anonymous: 'anonymous',
  authenticatedUser: 'authenticated_user',
  activeMember: 'active_member',
  memberWithIcePrivileges: 'member_with_ice_privileges',
  generalAdmin: 'general_admin',
  calendarAdmin: 'calendar_admin',
  contentAdmin: 'content_admin',
  sponsorAdmin: 'sponsor_admin',
  leagueAdmin: 'league_admin',
  leagueManager: 'league_manager',
} as const;

function normalizeScope(scope: string): string {
  return scope.trim().toLowerCase();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeDateString(value: string | Date | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value);
}

function scopeMatches(ruleScope: string, requestedScope: string): boolean {
  const rule = normalizeScope(ruleScope);
  const requested = normalizeScope(requestedScope);

  if (rule === '*') return true;
  if (rule === requested) return true;

  if (rule.endsWith('.*')) {
    const prefix = rule.slice(0, -2);
    return requested === prefix || requested.startsWith(`${prefix}.`);
  }

  // Parent scopes auto-grant children.
  return requested.startsWith(`${rule}.`);
}

function contextMatches(rule: AuthzRule, context?: ScopeContext): boolean {
  // No context requested: only global rules apply.
  if (!context || !context.resourceType) {
    return !rule.resourceType;
  }

  // Global rule applies to all contexts.
  if (!rule.resourceType) return true;
  if (rule.resourceType !== context.resourceType) return false;

  if (rule.resourceId === null || rule.resourceId === undefined) return true;
  return context.resourceId !== null && context.resourceId !== undefined && Number(rule.resourceId) === Number(context.resourceId);
}

export function resolveScopeEffect(
  claims: AuthzClaims | null | undefined,
  requestedScope: string,
  context?: ScopeContext
): ScopeEffect | 'not_set' {
  if (!claims) return 'not_set';
  if (claims.isServerAdmin) return 'allow';

  let hasAllow = false;
  for (const rule of claims.scopeRules ?? []) {
    if (!scopeMatches(rule.scope, requestedScope)) continue;
    if (!contextMatches(rule, context)) continue;
    if (rule.effect === 'deny') return 'deny';
    if (rule.effect === 'allow') hasAllow = true;
  }
  return hasAllow ? 'allow' : 'not_set';
}

export function hasScope(
  claims: AuthzClaims | null | undefined,
  requestedScope: string,
  context?: ScopeContext
): boolean {
  return resolveScopeEffect(claims, requestedScope, context) === 'allow';
}

export function isMemberActive(member: Member): boolean {
  const validThrough = normalizeDateString(member.valid_through);
  if (!validThrough) return true;
  const today = new Date().toISOString().split('T')[0];
  return today <= validThrough;
}

export function hasIcePrivileges(member: Member): boolean {
  return isMemberActive(member) && (member.social_member ?? 0) !== 1;
}

function getComputedRoleCodes(member: Member): string[] {
  const roleCodes: string[] = [RBAC_ROLE_CODES.authenticatedUser];
  if (isMemberActive(member)) roleCodes.push(RBAC_ROLE_CODES.activeMember);
  if (hasIcePrivileges(member)) roleCodes.push(RBAC_ROLE_CODES.memberWithIcePrivileges);
  return roleCodes;
}

export function isInServerAdminListsByEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = normalizeEmail(email);

  if (config.admins.map(normalizeEmail).includes(normalized)) return true;

  const dbConfig = getDatabaseConfig();
  if (!dbConfig?.adminEmails) return false;
  return dbConfig.adminEmails.map(normalizeEmail).includes(normalized);
}

export function getAnonymousAuthzClaims(): AuthzClaims {
  return {
    roleCodes: [RBAC_ROLE_CODES.anonymous],
    roleNames: ['Anonymous user'],
    isServerAdmin: false,
    scopeRules: [
      { scope: 'public.read', effect: 'allow' },
      { scope: 'articles.read', effect: 'allow' },
      { scope: 'calendar.read_public', effect: 'allow' },
      { scope: 'contact.submit', effect: 'allow' },
    ],
  };
}

export async function buildAuthzClaimsForMember(member: Member): Promise<AuthzClaims> {
  const isServerAdmin = isInServerAdminListsByEmail(member.email) || (member.is_server_admin ?? 0) === 1;

  if (isServerAdmin) {
    return {
      roleCodes: ['server_admin'],
      roleNames: ['Server admin'],
      isServerAdmin: true,
      scopeRules: [{ scope: '*', effect: 'allow' }],
    };
  }

  try {
    const { db, schema } = getDrizzleDb();
    const computedRoleCodes = getComputedRoleCodes(member);

    const allRoles = (await db.select({
      id: schema.roles.id,
      code: schema.roles.code,
      name: schema.roles.name,
    }).from(schema.roles)) as Array<{ id: number; code: string; name: string }>;

    const roleByCode = new Map(allRoles.map((role) => [role.code, role]));
    const roleById = new Map(allRoles.map((role) => [role.id, role]));

    const assignments = (await db
      .select({
        roleId: schema.memberRoleAssignments.role_id,
        resourceType: schema.memberRoleAssignments.resource_type,
        resourceId: schema.memberRoleAssignments.resource_id,
      })
      .from(schema.memberRoleAssignments)
      .where(eq(schema.memberRoleAssignments.member_id, member.id))) as Array<{
      roleId: number;
      resourceType: string | null;
      resourceId: number | null;
    }>;

    const effectiveAssignments: Array<{
      roleId: number;
      resourceType: string | null;
      resourceId: number | null;
    }> = [...assignments];

    for (const roleCode of computedRoleCodes) {
      const role = roleByCode.get(roleCode);
      if (!role) continue;
      effectiveAssignments.push({ roleId: role.id, resourceType: null, resourceId: null });
    }

    // Legacy fallback for users that still rely on old role flags.
    if ((member.is_admin ?? 0) === 1) {
      const role = roleByCode.get(RBAC_ROLE_CODES.generalAdmin);
      if (role) effectiveAssignments.push({ roleId: role.id, resourceType: null, resourceId: null });
    }
    if ((member.is_calendar_admin ?? 0) === 1) {
      const role = roleByCode.get(RBAC_ROLE_CODES.calendarAdmin);
      if (role) effectiveAssignments.push({ roleId: role.id, resourceType: null, resourceId: null });
    }
    if ((member.is_content_admin ?? 0) === 1) {
      const role = roleByCode.get(RBAC_ROLE_CODES.contentAdmin);
      if (role) effectiveAssignments.push({ roleId: role.id, resourceType: null, resourceId: null });
    }
    if ((member.is_sponsor_admin ?? 0) === 1) {
      const role = roleByCode.get(RBAC_ROLE_CODES.sponsorAdmin);
      if (role) effectiveAssignments.push({ roleId: role.id, resourceType: null, resourceId: null });
    }

    const roleIds = Array.from(new Set(effectiveAssignments.map((assignment) => assignment.roleId)));
    const roleRules = roleIds.length === 0
      ? []
      : (await db
          .select({
            roleId: schema.roleScopeRules.role_id,
            scope: schema.roleScopeRules.scope,
            effect: schema.roleScopeRules.effect,
          })
          .from(schema.roleScopeRules)
          .where(inArray(schema.roleScopeRules.role_id, roleIds))) as Array<{
            roleId: number;
            scope: string;
            effect: ScopeEffect;
          }>;

    const roleRulesByRoleId = new Map<number, Array<{ scope: string; effect: ScopeEffect }>>();
    for (const row of roleRules) {
      const existing = roleRulesByRoleId.get(row.roleId) ?? [];
      existing.push({ scope: row.scope, effect: row.effect });
      roleRulesByRoleId.set(row.roleId, existing);
    }

    const scopeRules: AuthzRule[] = [];
    const roleCodes = new Set<string>();
    const roleNames = new Set<string>();

    for (const assignment of effectiveAssignments) {
      const roleMeta = roleById.get(assignment.roleId);
      if (!roleMeta) continue;
      roleCodes.add(roleMeta.code);
      roleNames.add(roleMeta.name);

      for (const rule of roleRulesByRoleId.get(assignment.roleId) ?? []) {
        scopeRules.push({
          scope: rule.scope,
          effect: rule.effect,
          resourceType: assignment.resourceType,
          resourceId: assignment.resourceId,
        });
      }
    }

    // Backward compatibility for old league_member_roles if no migrated assignments are present.
    if (!roleCodes.has(RBAC_ROLE_CODES.leagueManager) && !roleCodes.has(RBAC_ROLE_CODES.leagueAdmin)) {
      const legacyRows = (await db
        .select({
          role: schema.leagueMemberRoles.role,
          leagueId: schema.leagueMemberRoles.league_id,
        })
        .from(schema.leagueMemberRoles)
        .where(eq(schema.leagueMemberRoles.member_id, member.id))) as Array<{
          role: 'league_manager' | 'league_administrator';
          leagueId: number | null;
        }>;

      for (const row of legacyRows) {
        if (row.role === 'league_manager') {
          roleCodes.add(RBAC_ROLE_CODES.leagueManager);
          roleNames.add('League manager');
          scopeRules.push({
            scope: 'leagues.manage',
            effect: 'allow',
            resourceType: 'league',
            resourceId: row.leagueId,
          });
        } else {
          roleCodes.add(RBAC_ROLE_CODES.leagueAdmin);
          roleNames.add('League admin');
          scopeRules.push({
            scope: 'leagues.manage',
            effect: 'allow',
            resourceType: 'league',
            resourceId: row.leagueId,
          });
        }
      }
    }

    return {
      roleCodes: Array.from(roleCodes),
      roleNames: Array.from(roleNames),
      scopeRules,
      isServerAdmin: false,
    };
  } catch {
    return {
      roleCodes: [],
      roleNames: [],
      scopeRules: [],
      isServerAdmin: false,
    };
  }
}

export function mergeAuthzClaims(
  claims: AuthzClaims,
  extraRules: AuthzRule[] = [],
  extraRoleCodes: string[] = [],
  extraRoleNames: string[] = []
): AuthzClaims {
  return {
    roleCodes: Array.from(new Set([...(claims.roleCodes ?? []), ...extraRoleCodes])),
    roleNames: Array.from(new Set([...(claims.roleNames ?? []), ...extraRoleNames])),
    isServerAdmin: claims.isServerAdmin,
    scopeRules: [...(claims.scopeRules ?? []), ...extraRules],
  };
}
