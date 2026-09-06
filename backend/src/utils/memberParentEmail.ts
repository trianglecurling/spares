import { isMemberMinor } from './memberAge.js';

const EMAIL_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Skip values that would break mailto/BCC lists. */
export function isValidCopyEmailAddress(email: string): boolean {
  return EMAIL_ADDRESS_RE.test(email);
}

export function normalizeEmailKey(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? '';
}

export function emailsMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftKey = normalizeEmailKey(left);
  const rightKey = normalizeEmailKey(right);
  return Boolean(leftKey) && leftKey === rightKey;
}

function dateOfBirthString(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw) return null;
  return raw.includes('T') ? raw.slice(0, 10) : raw.slice(0, 10);
}

/**
 * Guardian/parent email when it is present and different from the member email.
 * Used so shared parent inboxes are not duplicated.
 */
export function distinctGuardianEmail(
  memberEmail: string | null | undefined,
  guardianEmail: string | null | undefined,
): string | null {
  const parent = guardianEmail?.trim() || '';
  if (!parent || !isValidCopyEmailAddress(parent)) return null;
  if (emailsMatch(memberEmail, parent)) return null;
  return parent;
}

/**
 * Extra parent/guardian address to include when contacting a minor.
 * Null when the member is not a minor, the guardian email is missing, or it matches the member email.
 */
export function parentEmailForMinor(input: {
  email?: string | null;
  guardianEmail?: string | null;
  dateOfBirth?: unknown;
  isMinor?: boolean;
}): string | null {
  const minor =
    input.isMinor ?? isMemberMinor(dateOfBirthString(input.dateOfBirth));
  if (!minor) return null;
  return distinctGuardianEmail(input.email, input.guardianEmail);
}

/** `{email, parentEmail}` for API payloads that already expose a member email. */
export function memberContactEmails(row: {
  email?: string | null;
  guardian_email?: string | null;
  guardianEmail?: string | null;
  date_of_birth?: unknown;
  dateOfBirth?: unknown;
}): { email: string | null; parentEmail: string | null } {
  const email = row.email?.trim() || null;
  if (!email) {
    return { email: null, parentEmail: null };
  }
  return {
    email,
    parentEmail: parentEmailForMinor({
      email,
      guardianEmail: row.guardian_email ?? row.guardianEmail,
      dateOfBirth: row.date_of_birth ?? row.dateOfBirth,
    }),
  };
}

export function formatEmailWithParent(
  email: string | null | undefined,
  parentEmail: string | null | undefined,
): string {
  const trimmed = email?.trim() ?? '';
  if (!trimmed) return '';
  const parent = distinctGuardianEmail(trimmed, parentEmail);
  if (!parent) return trimmed;
  return `${trimmed} (parent: ${parent})`;
}

export function mailtoHrefForMemberEmail(
  email: string | null | undefined,
  parentEmail: string | null | undefined,
): string | null {
  const trimmed = email?.trim() ?? '';
  if (!trimmed || !isValidCopyEmailAddress(trimmed)) return null;
  const parent = distinctGuardianEmail(trimmed, parentEmail);
  if (!parent) return `mailto:${trimmed}`;
  return `mailto:${trimmed}?cc=${encodeURIComponent(parent)}`;
}

export type NamedCopyEmailRecipient = {
  name?: string | null;
  email?: string | null;
  parentEmail?: string | null;
};

function appendNamedCopyEmail(
  entries: string[],
  seenEmails: Set<string>,
  name: string,
  emailRaw: string | null | undefined,
): void {
  const email = emailRaw?.trim() ?? '';
  if (!email || !isValidCopyEmailAddress(email)) return;
  const emailKey = email.toLowerCase();
  if (seenEmails.has(emailKey)) return;
  seenEmails.add(emailKey);
  const displayName = name.trim() || email;
  entries.push(`"${displayName}" <${email}>`);
}

/** Unique `"Name" <email>` entries, adding a distinct parent address when present. */
export function namedCopyEmailEntries(recipients: NamedCopyEmailRecipient[]): string[] {
  const entries: string[] = [];
  const seenEmails = new Set<string>();
  for (const recipient of recipients) {
    const email = recipient.email?.trim() ?? '';
    const displayName = recipient.name?.trim() || email;
    appendNamedCopyEmail(entries, seenEmails, displayName, email);
    const parent = distinctGuardianEmail(email, recipient.parentEmail);
    if (parent) {
      appendNamedCopyEmail(entries, seenEmails, `${displayName} (parent)`, parent);
    }
  }
  return entries;
}

export function parentEmailLookupFromMembers(
  members: Array<{ email?: string | null; parentEmail?: string | null }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const member of members) {
    const key = normalizeEmailKey(member.email);
    const parent = distinctGuardianEmail(member.email, member.parentEmail);
    if (!key || !parent) continue;
    map.set(key, parent);
  }
  return map;
}
