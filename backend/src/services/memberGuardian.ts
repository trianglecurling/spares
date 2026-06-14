import { eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { normalizeEmail } from '../utils/auth.js';

export type MemberGuardianInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

export class MemberGuardianValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Member guardian validation failed');
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new MemberGuardianValidationError({ [field]: 'This field is required.' });
  }
}

function assertValidEmail(value: string, field = 'email'): void {
  assertNonEmpty(value, field);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new MemberGuardianValidationError({ [field]: 'Enter a valid email address.' });
  }
}

export function validateMemberGuardian(input: MemberGuardianInput): void {
  assertNonEmpty(input.firstName, 'firstName');
  assertNonEmpty(input.lastName, 'lastName');
  assertValidEmail(input.email);
  assertNonEmpty(input.phone, 'phone');
}

export function guardianEmergencyContactName(input: MemberGuardianInput): string {
  return `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
}

/** Persist parent/guardian contact on a member and mirror it to emergency contact fields. */
export async function applyMemberGuardianUpdate(memberId: number, input: MemberGuardianInput): Promise<void> {
  validateMemberGuardian(input);
  const { db, schema } = getDrizzleDb();
  const emergencyName = guardianEmergencyContactName(input);
  await db
    .update(schema.members)
    .set({
      guardian_first_name: input.firstName.trim(),
      guardian_last_name: input.lastName.trim(),
      guardian_email: normalizeEmail(input.email),
      guardian_phone: input.phone.trim(),
      emergency_contact_name: emergencyName,
      emergency_contact_phone: input.phone.trim(),
      updated_at: sql`CURRENT_TIMESTAMP`,
    } as any)
    .where(eq(schema.members.id, memberId));
}

/** Clear stored parent/guardian contact and mirrored emergency contact fields. */
export async function clearMemberGuardian(memberId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.members)
    .set({
      guardian_first_name: null,
      guardian_last_name: null,
      guardian_email: null,
      guardian_phone: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    } as any)
    .where(eq(schema.members.id, memberId));
}
