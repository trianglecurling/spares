import { eq, sql } from 'drizzle-orm';
import { MEMBER_PROFILE_EMAIL_UNAVAILABLE } from '../api/errors.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { findMemberIdWithConflictingNormalizedEmailChange } from './accountAccess.js';
import { normalizeEmail } from '../utils/auth.js';
import { isMemberMinor } from '../utils/memberAge.js';
import {
  preferredPronounsValidationMessage,
  resolvePreferredPronounsForSave,
} from '../utils/preferredPronouns.js';
import { resolveUsaCurlingCompetitionGenderForSave } from '../utils/usaCurlingCompetitionGender.js';
import { formatMemberDisplayName, normalizePersonName } from '../utils/memberName.js';
import { queueMemberContactInfoSync } from './mauticMembershipSyncService.js';

export type MemberDemographicsInput = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  mailingAddress: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  preferredPronouns: string;
  usaCurlingCompetitionGender: string;
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
  return formatMemberDisplayName(input.firstName, input.lastName);
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

function assertValidPreferredPronouns(value: string): void {
  const message = preferredPronounsValidationMessage(value);
  if (message) {
    throw new MemberDemographicsValidationError({ preferredPronouns: message });
  }
}

export function validateMemberDemographics(
  input: MemberDemographicsInput,
  options?: { skipEmergencyContactForMinor?: boolean; requireDateOfBirth?: boolean },
): void {
  assertNonEmpty(input.firstName, 'firstName');
  assertNonEmpty(input.lastName, 'lastName');
  if (options?.requireDateOfBirth !== false) {
    assertValidDateOfBirth(input.dateOfBirth);
  } else if (input.dateOfBirth.trim()) {
    assertValidDateOfBirth(input.dateOfBirth);
  }
  assertValidEmail(input.email);
  assertNonEmpty(input.phone, 'phone');
  assertNonEmpty(input.mailingAddress, 'mailingAddress');
  assertValidPreferredPronouns(input.preferredPronouns);
  const minorDateOfBirth = input.dateOfBirth.trim() || null;
  const skipEmergency =
    options?.skipEmergencyContactForMinor === true && isMemberMinor(minorDateOfBirth);
  if (!skipEmergency) {
    assertNonEmpty(input.emergencyContactName, 'emergencyContactName');
    assertNonEmpty(input.emergencyContactPhone, 'emergencyContactPhone');
  }
}

function resolveProfileDateOfBirth(
  existingDateOfBirth: string | null,
  incomingDateOfBirth: string,
): string {
  const incoming = incomingDateOfBirth.trim();
  if (existingDateOfBirth) {
    if (incoming && incoming !== existingDateOfBirth) {
      throw new MemberDemographicsUpdateError('Date of birth cannot be changed once it has been set.', {
        dateOfBirth: 'Date of birth cannot be changed once it has been set.',
      });
    }
    return existingDateOfBirth;
  }
  if (!incoming) {
    throw new MemberDemographicsValidationError({
      dateOfBirth: 'Enter your date of birth before saving.',
    });
  }
  return incoming;
}

/** Persist validated demographic fields on a member row (registration curler or profile self-update). */
export async function applyMemberDemographicsUpdate(
  memberId: number,
  input: MemberDemographicsInput,
  options?: { registrationUpdate?: boolean; resolvedDateOfBirth?: string | null },
): Promise<{ oldEmail: string; newEmail: string; firstName: string; lastName: string }> {
  const { db, schema } = getDrizzleDb();
  const memberRows = await db
    .select({
      date_of_birth: schema.members.date_of_birth,
      email: schema.members.email,
      first_name: schema.members.first_name,
      last_name: schema.members.last_name,
      name: schema.members.name,
    })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  const existing = memberRows[0];
  const existingDateOfBirth = normalizeMemberDateOfBirth(existing?.date_of_birth);
  const resolvedDateOfBirth = options?.registrationUpdate
    ? (existingDateOfBirth ?? (input.dateOfBirth.trim() || null))
    : resolveProfileDateOfBirth(existingDateOfBirth, input.dateOfBirth);
  const effectiveDateOfBirth = options?.resolvedDateOfBirth ?? resolvedDateOfBirth ?? '';
  const demographicsInput: MemberDemographicsInput = {
    ...input,
    dateOfBirth: effectiveDateOfBirth,
  };

  validateMemberDemographics(demographicsInput, {
    skipEmergencyContactForMinor: isMemberMinor(effectiveDateOfBirth || null),
    requireDateOfBirth: options?.registrationUpdate ? false : Boolean(resolvedDateOfBirth),
  });

  const normalizedEmail = normalizeEmail(input.email);
  const oldEmail = normalizeEmail(existing?.email || '');
  const conflictId = await findMemberIdWithConflictingNormalizedEmailChange(
    normalizedEmail,
    existing?.email ?? null,
    memberId
  );
  if (conflictId != null) {
    throw new MemberDemographicsUpdateError(MEMBER_PROFILE_EMAIL_UNAVAILABLE, {
      email: MEMBER_PROFILE_EMAIL_UNAVAILABLE,
    });
  }

  const firstName = normalizePersonName(input.firstName);
  const lastName = normalizePersonName(input.lastName);
  const updateData: Record<string, unknown> = {
    name: memberName({ firstName, lastName }),
    email: normalizedEmail,
    phone: input.phone.trim(),
    first_name: firstName,
    last_name: lastName,
    mailing_address: input.mailingAddress.trim(),
    emergency_contact_name: normalizePersonName(input.emergencyContactName),
    emergency_contact_phone: input.emergencyContactPhone.trim(),
    preferred_pronouns: resolvePreferredPronounsForSave(input.preferredPronouns),
    usa_curling_competition_gender: resolveUsaCurlingCompetitionGenderForSave(input.usaCurlingCompetitionGender),
    updated_at: sql`CURRENT_TIMESTAMP`,
  };
  if (resolvedDateOfBirth) {
    updateData.date_of_birth = resolvedDateOfBirth;
  }

  await db
    .update(schema.members)
    .set(updateData as any)
    .where(eq(schema.members.id, memberId));

  const oldFirst = (existing?.first_name || '').trim();
  const oldLast = (existing?.last_name || '').trim();
  if (oldEmail !== normalizedEmail || oldFirst !== firstName || oldLast !== lastName) {
    queueMemberContactInfoSync(memberId, oldEmail, normalizedEmail, firstName, lastName);
  }

  return { oldEmail, newEmail: normalizedEmail, firstName, lastName };
}

export function normalizeMemberDateOfBirth(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value);
  return raw.includes('T') ? raw.slice(0, 10) : raw;
}
