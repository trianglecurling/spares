import type { AuthenticatedMember, AuthzRule, ScopeContext } from '../../../backend/src/types.ts';

function normalizeScope(scope: string): string {
  return scope.trim().toLowerCase();
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
  return requested.startsWith(`${rule}.`);
}

function contextMatches(rule: AuthzRule, context?: ScopeContext): boolean {
  if (!context || !context.resourceType) {
    return !rule.resourceType;
  }
  if (!rule.resourceType) return true;
  if (rule.resourceType !== context.resourceType) return false;
  if (rule.resourceId === null || rule.resourceId === undefined) return true;
  return context.resourceId !== null && context.resourceId !== undefined && Number(rule.resourceId) === Number(context.resourceId);
}

function legacyFallbackAllows(member: AuthenticatedMember, scope: string): boolean {
  switch (scope) {
    case 'admin.manage':
    case 'members.manage':
    case 'governance.manage':
    case 'feedback.manage':
      return member.isAdmin || member.isServerAdmin;
    case 'calendar.manage':
      return member.isCalendarAdmin || member.isAdmin || member.isServerAdmin;
    case 'content.manage':
    case 'files.manage':
      return member.isContentAdmin || member.isServerAdmin;
    case 'sponsorship.manage':
      return member.isSponsorAdmin || member.isServerAdmin;
    case 'leagues.manage':
      return (
        member.isAdmin ||
        member.isServerAdmin ||
        member.isLeagueAdministratorGlobal ||
        (member.leagueManagerLeagueIds?.length ?? 0) > 0
      );
    default:
      return false;
  }
}

export function resolveScopeEffect(
  member: AuthenticatedMember | null | undefined,
  requestedScope: string,
  context?: ScopeContext
): 'allow' | 'deny' | 'not_set' {
  if (!member) return 'not_set';
  if (member.isServerAdmin) return 'allow';

  const rules = member.scopeRules ?? [];
  if (rules.length === 0) {
    return legacyFallbackAllows(member, requestedScope) ? 'allow' : 'not_set';
  }

  let hasAllow = false;
  for (const rule of rules) {
    if (!scopeMatches(rule.scope, requestedScope)) continue;
    if (!contextMatches(rule, context)) continue;
    if (rule.effect === 'deny') return 'deny';
    if (rule.effect === 'allow') hasAllow = true;
  }
  return hasAllow ? 'allow' : 'not_set';
}

export function memberHasScope(
  member: AuthenticatedMember | null | undefined,
  requestedScope: string,
  context?: ScopeContext
): boolean {
  return resolveScopeEffect(member, requestedScope, context) === 'allow';
}
