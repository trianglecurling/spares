import { describe, expect, test } from 'bun:test';
import type { AuthzClaims } from '../types.js';
import { resolveScopeEffect } from './rbac.js';

const baseClaims: AuthzClaims = {
  roleCodes: ['test_role'],
  roleNames: ['Test role'],
  isServerAdmin: false,
  scopeRules: [],
};

describe('resolveScopeEffect', () => {
  test('matches exact and wildcard scopes', () => {
    const claims: AuthzClaims = {
      ...baseClaims,
      scopeRules: [{ scope: 'calendar.*', effect: 'allow' }],
    };

    expect(resolveScopeEffect(claims, 'calendar.manage')).toBe('allow');
    expect(resolveScopeEffect(claims, 'calendar.read')).toBe('allow');
    expect(resolveScopeEffect(claims, 'content.manage')).toBe('not_set');
  });

  test('deny takes precedence over allow', () => {
    const claims: AuthzClaims = {
      ...baseClaims,
      scopeRules: [
        { scope: 'leagues.manage', effect: 'allow' },
        { scope: 'leagues.manage', effect: 'deny' },
      ],
    };

    expect(resolveScopeEffect(claims, 'leagues.manage')).toBe('deny');
  });

  test('applies context-specific allow for matching context', () => {
    const claims: AuthzClaims = {
      ...baseClaims,
      scopeRules: [
        {
          scope: 'leagues.manage',
          effect: 'allow',
          resourceType: 'league',
          resourceId: 42,
        },
      ],
    };

    expect(
      resolveScopeEffect(claims, 'leagues.manage', { resourceType: 'league', resourceId: 42 })
    ).toBe('allow');
    expect(
      resolveScopeEffect(claims, 'leagues.manage', { resourceType: 'league', resourceId: 99 })
    ).toBe('not_set');
    expect(resolveScopeEffect(claims, 'leagues.manage')).toBe('not_set');
  });

  test('server admin claims bypass all checks', () => {
    const claims: AuthzClaims = {
      ...baseClaims,
      isServerAdmin: true,
      scopeRules: [{ scope: 'any.scope', effect: 'deny' }],
    };

    expect(resolveScopeEffect(claims, 'members.manage')).toBe('allow');
  });
});
