import type { Member } from '../types.js';
import { isAdmin, isServerAdmin } from './auth.js';
import { hasScope } from './rbac.js';

export function memberCanManageRegistrations(member: Member): boolean {
  if (isServerAdmin(member) || isAdmin(member)) return true;
  return hasScope(member.authz, 'registrations.manage');
}
