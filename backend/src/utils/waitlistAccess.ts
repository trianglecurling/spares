import type { Member } from '../types.js';
import { isAdmin, isServerAdmin } from './auth.js';
import { hasScope } from './rbac.js';

/** Any signed-in member may view waitlist queues. */
export function memberCanViewWaitlists(_member: Member): boolean {
  return true;
}

export function memberCanManageWaitlists(member: Member): boolean {
  if (isServerAdmin(member) || isAdmin(member)) return true;
  return hasScope(member.authz, 'waitlists.manage');
}
