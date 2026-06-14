import type { Member, MemberMembershipStatus } from '../types.js';

export function resolveMemberMembershipStatus(member: Member): MemberMembershipStatus {
  return (
    member.membershipStatus ?? {
      validThrough: null,
      isSocialMember: false,
      isSpareOnly: false,
      isActive: (member.lifetime_member ?? 0) === 1,
    }
  );
}

export function memberIsSpareOnly(member: Member): boolean {
  return resolveMemberMembershipStatus(member).isSpareOnly;
}

export function memberIsSocialMember(member: Member): boolean {
  return resolveMemberMembershipStatus(member).isSocialMember;
}
