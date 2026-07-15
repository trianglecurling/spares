import type { AuthenticatedMember } from '../../../backend/src/types.ts';
import { memberHasScope } from './permissions';

export function memberHasEventsManageScope(member: AuthenticatedMember | null | undefined): boolean {
  return memberHasScope(member, 'events.manage');
}

export function memberOwnedEventIds(member: AuthenticatedMember | null | undefined): number[] {
  return member?.ownedEventIds ?? [];
}

export function memberOwnsAnyEvent(member: AuthenticatedMember | null | undefined): boolean {
  return memberOwnedEventIds(member).length > 0;
}

/** Global events admin or owns at least one event (list / nav entry). */
export function memberCanAccessEventsAdmin(member: AuthenticatedMember | null | undefined): boolean {
  return memberHasEventsManageScope(member) || memberOwnsAnyEvent(member);
}

/** Can open /admin/events/:eventId for this event id from session claims. */
export function memberCanManageEventFromClaims(
  member: AuthenticatedMember | null | undefined,
  eventId: number,
): boolean {
  if (memberHasEventsManageScope(member)) return true;
  return memberOwnedEventIds(member).includes(eventId);
}
