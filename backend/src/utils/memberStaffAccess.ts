import type { Member } from '../types.js';
import { isAdmin, isServerAdmin } from './auth.js';
import { hasScope } from './rbac.js';
import { memberCanManageRegistrations } from './registrationStaffAccess.js';

export function memberCanManageMembers(member: Member): boolean {
  if (isServerAdmin(member) || isAdmin(member)) return true;
  return hasScope(member.authz, 'members.manage');
}

/** Membership managers and registration staff can see how a roster seat was filled. */
export function memberCanViewRosterPlacement(member: Member): boolean {
  return memberCanManageMembers(member) || memberCanManageRegistrations(member);
}
