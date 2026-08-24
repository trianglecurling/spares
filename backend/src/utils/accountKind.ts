export const ACCOUNT_KIND_PERSON = 'person';
export const ACCOUNT_KIND_SERVICE = 'service';

export type AccountKind = typeof ACCOUNT_KIND_PERSON | typeof ACCOUNT_KIND_SERVICE;

export function isServiceAccount(member: { account_kind?: string | null }): boolean {
  return (member.account_kind ?? ACCOUNT_KIND_PERSON) === ACCOUNT_KIND_SERVICE;
}

export function isPersonAccount(member: { account_kind?: string | null }): boolean {
  return !isServiceAccount(member);
}

export function personAccountsOnly<T extends { account_kind?: string | null }>(members: T[]): T[] {
  return members.filter(isPersonAccount);
}
