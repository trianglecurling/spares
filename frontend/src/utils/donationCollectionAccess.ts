import type { AuthenticatedMember } from '../../../backend/src/types.ts';
import { memberHasScope } from './permissions';

export function memberHasDonationsManageScope(
  member: AuthenticatedMember | null | undefined
): boolean {
  return memberHasScope(member, 'donations.manage');
}

export function memberManagedDonationCollectionIds(
  member: AuthenticatedMember | null | undefined
): number[] {
  return member?.managedDonationCollectionIds ?? [];
}

export function memberCanAccessDonationCollectionsAdmin(
  member: AuthenticatedMember | null | undefined
): boolean {
  return (
    memberHasDonationsManageScope(member) || memberManagedDonationCollectionIds(member).length > 0
  );
}

export function memberCanManageDonationCollectionFromClaims(
  member: AuthenticatedMember | null | undefined,
  collectionId: number
): boolean {
  if (memberHasDonationsManageScope(member)) return true;
  return memberManagedDonationCollectionIds(member).includes(collectionId);
}
