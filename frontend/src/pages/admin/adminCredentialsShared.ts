import { volunteerCredentialIsValidOn } from '../../utils/volunteering';
import { namedCopyEmailEntries } from '../../utils/memberParentEmail';

export type CredentialGrant = {
  id: number;
  memberId: number;
  memberName: string;
  memberEmail: string | null;
  parentEmail?: string | null;
  grantedAt: string;
  grantedByMemberId: number | null;
  expiresAt: string | null;
};

export type CredentialAdmin = {
  id: number;
  name: string;
  description: string | null;
  pointOfContactEmail: string;
  systemKey: string | null;
  systemGrantRule: string | null;
  archivedAt: string | null;
  managers: Array<{ id: number; name: string; email: string | null }>;
  grants: CredentialGrant[];
};

export function expiredGrantCount(grants: CredentialGrant[], today: string): number {
  return grants.filter((grant) => !volunteerCredentialIsValidOn(grant.expiresAt, today)).length;
}

export function credentialHolderEmailEntries(grants: CredentialGrant[], today: string): string[] {
  return namedCopyEmailEntries(
    grants
      .filter((grant) => volunteerCredentialIsValidOn(grant.expiresAt, today))
      .map((grant) => ({
        name: grant.memberName,
        email: grant.memberEmail,
        parentEmail: grant.parentEmail,
      })),
  );
}
