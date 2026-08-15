import { resolvePreferredPronounsForSave } from './preferredPronouns.js';

export function membershipAppliesParentAssociations(
  choice: 'regular' | 'social' | 'junior_recreational' | 'none' | 'regular_spare_only' | null | undefined,
): boolean {
  return (
    choice === 'regular' ||
    choice === 'social' ||
    choice === 'regular_spare_only' ||
    choice === 'junior_recreational'
  );
}

export function defaultUsaCurlingMembershipOptIn(): boolean {
  return true;
}

export function defaultUswcaMembershipOptIn(preferredPronouns: string | null | undefined): boolean {
  return resolvePreferredPronounsForSave(preferredPronouns) === 'She/Her';
}

export function sqliteFlagFromBoolean(value: boolean | null | undefined): number | null {
  if (value === true) return 1;
  if (value === false) return 0;
  return null;
}

export function booleanFromSqliteFlag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return null;
}
