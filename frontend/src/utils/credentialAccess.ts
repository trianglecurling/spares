import type { AuthenticatedMember } from '../../../backend/src/types.ts';
import { memberHasScope } from './permissions';

export function memberHasCredentialsManageScope(member: AuthenticatedMember | null | undefined): boolean {
  return memberHasScope(member, 'credentials.manage');
}

export function memberManagedCredentialIds(member: AuthenticatedMember | null | undefined): number[] {
  return member?.managedCredentialIds ?? [];
}

export function memberManagesAnyCredential(member: AuthenticatedMember | null | undefined): boolean {
  return memberManagedCredentialIds(member).length > 0;
}

export function memberCanManageCredentials(member: AuthenticatedMember | null | undefined): boolean {
  return memberHasCredentialsManageScope(member) || memberManagesAnyCredential(member);
}

export function memberCanManageMembersAdmin(member: AuthenticatedMember | null | undefined): boolean {
  return (
    memberHasScope(member, 'members.manage') ||
    memberHasScope(member, 'admin.manage') ||
    Boolean(member?.isServerAdmin)
  );
}

export function memberCanAccessMembersArea(member: AuthenticatedMember | null | undefined): boolean {
  return memberCanManageMembersAdmin(member) || memberCanManageCredentials(member);
}
