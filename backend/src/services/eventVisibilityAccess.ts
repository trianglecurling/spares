import type { EventVisibility } from '../db/drizzle-schema.js';
import type { Member } from '../types.js';
import { isMemberActiveForRbac } from './memberMembershipStatusService.js';
import { resolveMemberMembershipStatus } from '../utils/memberMembershipHelpers.js';

/**
 * Current club membership: lifetime, or a non-expired active/pending season membership.
 * Social and spare-only memberships count.
 */
export function memberHasActiveClubMembership(member: Member): boolean {
  return isMemberActiveForRbac(member, resolveMemberMembershipStatus(member));
}

/**
 * Ice-member events are for current members who are not social.
 * Spare-only members have ice privileges and are included.
 */
export function memberHasIceMemberEventAccess(member: Member): boolean {
  const status = resolveMemberMembershipStatus(member);
  return memberHasActiveClubMembership(member) && !status.isSocialMember;
}

/** Public events are open. Member events require the matching membership. */
export function memberCanRegisterForEventVisibility(
  member: Member | null | undefined,
  visibility: EventVisibility,
): boolean {
  if (visibility === 'public') return true;
  if (!member) return false;
  if (visibility === 'active_members') return memberHasActiveClubMembership(member);
  return memberHasIceMemberEventAccess(member);
}

/** Published events a viewer may see on the events list. */
export function eventVisibilityFilterForMember(member?: Member | null): EventVisibility[] {
  const visibilityFilter: EventVisibility[] = ['public'];
  if (!member) return visibilityFilter;
  if (memberHasActiveClubMembership(member)) {
    visibilityFilter.push('active_members');
  }
  if (memberHasIceMemberEventAccess(member)) {
    visibilityFilter.push('ice_members');
  }
  return visibilityFilter;
}

/**
 * Calendar feeds show public and member-only events to every viewer.
 * Ice-member events stay limited to current non-social members, including spare-only.
 */
export function eventVisibilityFilterForCalendar(member?: Member | null): EventVisibility[] {
  const visibilityFilter: EventVisibility[] = ['public', 'active_members'];
  if (member && memberHasIceMemberEventAccess(member)) {
    visibilityFilter.push('ice_members');
  }
  return visibilityFilter;
}

/** User-facing denial when registration is closed to this viewer. Keep in sync with the event page blurb. */
export function memberEventRegistrationDeniedMessage(visibility: EventVisibility): string | null {
  if (visibility === 'active_members') {
    return 'This event is available to Triangle Curling members only.';
  }
  if (visibility === 'ice_members') {
    return 'This event is available to Triangle Curling ice members only.';
  }
  return null;
}
