import { eq, sql } from 'drizzle-orm';
import { MEMBER_PROFILE_EMAIL_UNAVAILABLE } from '../api/errors.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import {
  fetchMemberEmailRow,
  findMemberIdWithConflictingNormalizedEmailChange,
} from './accountAccess.js';
import { normalizeEmail } from '../utils/auth.js';

export type MemberDemographicsInput = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  mailingAddress: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

export class MemberDemographicsValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Member demographics validation failed');
  }
}

export class MemberDemographicsUpdateError extends Error {
  constructor(
    message: string,
    public details: Record<string, string>,
  ) {
    super(message);
  }
}

function memberName(input: Pick<MemberDemographicsInput, 'firstName' | 'lastName'>): string {
  return `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new MemberDemographicsValidationError({ [field]: 'This field is required.' });
  }
}

function assertValidEmail(value: string, field = 'email'): void {
  assertNonEmpty(value, field);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new MemberDemographicsValidationError({ [field]: 'Enter a valid email address.' });
  }
}

function assertValidDateOfBirth(value: string): void {
  assertNonEmpty(value, 'dateOfBirth');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new MemberDemographicsValidationError({ dateOfBirth: 'Enter a valid date of birth.' });
  }
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (parsed.getTime() > todayUtc) {
    throw new MemberDemographicsValidationError({ dateOfBirth: 'Date of birth cannot be in the future.' });
  }
}

export function validateMemberDemographics(input: MemberDemographicsInput): void {
  assertNonEmpty(input.firstName, 'firstName');
  assertNonEmpty(input.lastName, 'lastName');
  assertValidDateOfBirth(input.dateOfBirth);
  assertValidEmail(input.email);
  assertNonEmpty(input.phone, 'phone');
  assertNonEmpty(input.mailingAddress, 'mailingAddress');
  assertNonEmpty(input.emergencyContactName, 'emergencyContactName');
  assertNonEmpty(input.emergencyContactPhone, 'emergencyContactPhone');
}

/** Persist validated demographic fields on a member row (registration curler or profile self-update). */
export async function applyMemberDemographicsUpdate(
  memberId: number,
  input: MemberDemographicsInput,
): Promise<void> {
  validateMemberDemographics(input);
  const normalizedEmail = normalizeEmail(input.email);
  const curlerRow = await fetchMemberEmailRow(memberId);
  const conflictId = await findMemberIdWithConflictingNormalizedEmailChange(
    normalizedEmail,
    curlerRow?.email ?? null,
    memberId
  );
  if (conflictId != null) {
    throw new MemberDemographicsUpdateError(MEMBER_PROFILE_EMAIL_UNAVAILABLE, {
      email: MEMBER_PROFILE_EMAIL_UNAVAILABLE,
    });
  }
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.members)
    .set({
      name: memberName(input),
      email: normalizedEmail,
      phone: input.phone.trim(),
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      date_of_birth: input.dateOfBirth as any,
      mailing_address: input.mailingAddress.trim(),
      emergency_contact_name: input.emergencyContactName.trim(),
      emergency_contact_phone: input.emergencyContactPhone.trim(),
      updated_at: sql`CURRENT_TIMESTAMP`,
    } as any)
    .where(eq(schema.members.id, memberId));
}

export function normalizeMemberDateOfBirth(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value);
  return raw.includes('T') ? raw.slice(0, 10) : raw;
}
