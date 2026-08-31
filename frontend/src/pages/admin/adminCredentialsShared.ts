import { volunteerCredentialIsValidOn } from '../../utils/volunteering';

export type CredentialGrant = {
  id: number;
  memberId: number;
  memberName: string;
  memberEmail: string | null;
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

const EMAIL_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmailAddress(email: string): boolean {
  return EMAIL_ADDRESS_RE.test(email);
}

export function expiredGrantCount(grants: CredentialGrant[], today: string): number {
  return grants.filter((grant) => !volunteerCredentialIsValidOn(grant.expiresAt, today)).length;
}

export function credentialHolderEmailEntries(grants: CredentialGrant[], today: string): string[] {
  const entries: string[] = [];
  const seenEmails = new Set<string>();
  for (const grant of grants) {
    if (!volunteerCredentialIsValidOn(grant.expiresAt, today)) continue;
    const email = grant.memberEmail?.trim() ?? '';
    if (!email || !isValidEmailAddress(email)) continue;
    const emailKey = email.toLowerCase();
    if (seenEmails.has(emailKey)) continue;
    seenEmails.add(emailKey);
    const displayName = grant.memberName.trim() || email;
    entries.push(`"${displayName}" <${email}>`);
  }
  return entries;
}
