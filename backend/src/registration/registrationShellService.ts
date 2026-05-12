import { and, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { MEMBER_PROFILE_EMAIL_UNAVAILABLE } from '../api/errors.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { CurlingRegistrationStatusSqlite, PolicyAcceptanceKindSqlite } from '../db/drizzle-schema.js';
import {
  canActorImpersonateTarget,
  fetchMemberEmailRow,
  findMemberIdWithConflictingNormalizedEmail,
  listAccountSwitchOptions,
} from '../services/accountAccess.js';
import type { Member } from '../types.js';
import { isAdmin, isServerAdmin, normalizeEmail } from '../utils/auth.js';
import { isEmailChangeToReservedServerAdminAddress } from '../utils/rbac.js';

export const REQUIRED_REGISTRATION_POLICIES: Array<{
  type: PolicyAcceptanceKindSqlite;
  url: string;
  version: string;
}> = [
  { type: 'code_of_conduct', url: '/go/conduct', version: 'v1' },
  { type: 'maapp', url: '/go/maapp', version: 'v1' },
  { type: 'privacy', url: '/go/privacy', version: 'v1' },
];

export type RegistrationShellStatus = CurlingRegistrationStatusSqlite;

export type RegistrationShellRow = {
  id: number;
  season_id: number;
  session_id: number;
  submitted_by_member_id: number | null;
  curler_member_id: number | null;
  returning_member_answer: number | null;
  registering_for_self: number | null;
  demographics_current_confirmed: number;
  guardian_first_name: string | null;
  guardian_last_name: string | null;
  guardian_email: string | null;
  guardian_phone: string | null;
  status: RegistrationShellStatus;
  shell_completed_at: string | Date | null;
  cancelled_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

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

export type GuardianInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

type MemberSummary = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  mailingAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value);
  return raw.includes('T') ? raw.slice(0, 10) : raw;
}

function normalizeDateTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function memberName(input: Pick<MemberDemographicsInput, 'firstName' | 'lastName'>): string {
  return `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new RegistrationShellValidationError({ [field]: 'This field is required.' });
  }
}

function assertValidEmail(value: string, field = 'email'): void {
  assertNonEmpty(value, field);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new RegistrationShellValidationError({ [field]: 'Enter a valid email address.' });
  }
}

function assertValidDateOfBirth(value: string): void {
  assertNonEmpty(value, 'dateOfBirth');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RegistrationShellValidationError({ dateOfBirth: 'Enter a valid date of birth.' });
  }
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (parsed.getTime() > todayUtc) {
    throw new RegistrationShellValidationError({ dateOfBirth: 'Date of birth cannot be in the future.' });
  }
}

export class RegistrationShellValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Registration shell validation failed');
  }
}

/** Thrown when a signed-in member already has a registration that is not finished or cancelled. */
export class RegistrationInProgressError extends Error {
  constructor() {
    super('Registration already in progress');
  }
}

const IN_PROGRESS_REGISTRATION_STATUSES = [
  'identity_incomplete',
  'policies_incomplete',
  'demographics_incomplete',
  'shell_complete',
  'submitted',
  'awaiting_staff_review',
  'awaiting_placement',
  'awaiting_payment',
  'payment_started',
  'paid',
] as const satisfies readonly CurlingRegistrationStatusSqlite[];

export function validateDemographics(input: MemberDemographicsInput): void {
  assertNonEmpty(input.firstName, 'firstName');
  assertNonEmpty(input.lastName, 'lastName');
  assertValidDateOfBirth(input.dateOfBirth);
  assertValidEmail(input.email);
  assertNonEmpty(input.phone, 'phone');
  assertNonEmpty(input.mailingAddress, 'mailingAddress');
  assertNonEmpty(input.emergencyContactName, 'emergencyContactName');
  assertNonEmpty(input.emergencyContactPhone, 'emergencyContactPhone');
}

export function validateGuardian(input: GuardianInput): void {
  assertNonEmpty(input.firstName, 'firstName');
  assertNonEmpty(input.lastName, 'lastName');
  assertValidEmail(input.email);
  assertNonEmpty(input.phone, 'phone');
}

export function isMinorOnRegistrationDate(dateOfBirth: string | null): boolean {
  if (!dateOfBirth) return false;
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return false;
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age < 18;
}

export function mapRegistration(row: any): RegistrationShellRow {
  return {
    id: row.id,
    season_id: row.season_id,
    session_id: row.session_id,
    submitted_by_member_id: row.submitted_by_member_id ?? null,
    curler_member_id: row.curler_member_id ?? null,
    returning_member_answer: row.returning_member_answer ?? null,
    registering_for_self: row.registering_for_self ?? null,
    demographics_current_confirmed: row.demographics_current_confirmed ?? 0,
    guardian_first_name: row.guardian_first_name ?? null,
    guardian_last_name: row.guardian_last_name ?? null,
    guardian_email: row.guardian_email ?? null,
    guardian_phone: row.guardian_phone ?? null,
    status: row.status,
    shell_completed_at: normalizeDateTime(row.shell_completed_at),
    cancelled_at: normalizeDateTime(row.cancelled_at),
    created_at: normalizeDateTime(row.created_at) ?? '',
    updated_at: normalizeDateTime(row.updated_at) ?? '',
  };
}

export function mapMemberSummary(row: any): MemberSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? null,
    phone: row.phone ?? null,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    dateOfBirth: normalizeDate(row.date_of_birth),
    mailingAddress: row.mailing_address ?? null,
    emergencyContactName: row.emergency_contact_name ?? null,
    emergencyContactPhone: row.emergency_contact_phone ?? null,
  };
}

export async function getEffectiveRegistrationWindow(seasonId: number, sessionId: number) {
  const { db, schema } = getDrizzleDb();
  const [season] = await db.select().from(schema.curlingSeasons).where(eq(schema.curlingSeasons.id, seasonId)).limit(1);
  const [session] = await db.select().from(schema.curlingSessions).where(eq(schema.curlingSessions.id, sessionId)).limit(1);
  if (!season || !session) return null;

  const [transition] = await db
    .select()
    .from(schema.registrationStateTransitions)
    .where(
      and(
        eq(schema.registrationStateTransitions.season_id, seasonId),
        eq(schema.registrationStateTransitions.session_id, sessionId),
        lte(schema.registrationStateTransitions.effective_at, new Date() as any)
      )
    )
    .orderBy(desc(schema.registrationStateTransitions.effective_at))
    .limit(1);

  return {
    state: (transition?.state ?? 'closed') as 'closed' | 'priority' | 'open',
    season: {
      id: season.id,
      name: season.name,
      startDate: normalizeDate(season.start_date),
      endDate: normalizeDate(season.end_date),
    },
    session: {
      id: session.id,
      seasonId: session.season_id,
      name: session.name,
      startDate: normalizeDate(session.start_date),
      endDate: normalizeDate(session.end_date),
    },
  };
}

export async function getDefaultRegistrationWindow() {
  const { db, schema } = getDrizzleDb();
  const [transition] = await db
    .select()
    .from(schema.registrationStateTransitions)
    .orderBy(desc(schema.registrationStateTransitions.effective_at))
    .limit(1);
  if (transition) {
    return getEffectiveRegistrationWindow(transition.season_id, transition.session_id);
  }
  const [session] = await db.select().from(schema.curlingSessions).orderBy(desc(schema.curlingSessions.start_date)).limit(1);
  if (!session) return null;
  return getEffectiveRegistrationWindow(session.season_id, session.id);
}

export async function assertRegistrationOpen(seasonId: number, sessionId: number): Promise<void> {
  const window = await getEffectiveRegistrationWindow(seasonId, sessionId);
  if (!window) throw new RegistrationShellValidationError({ sessionId: 'Registration session was not found.' });
  if (window.state !== 'priority' && window.state !== 'open') {
    throw new RegistrationShellValidationError({ registration: 'Registration is not open.' });
  }
}

export async function findActiveRegistrationForSubmitter(submittedByMemberId: number): Promise<RegistrationShellRow | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.submitted_by_member_id, submittedByMemberId),
        inArray(schema.curlingRegistrations.status, [...IN_PROGRESS_REGISTRATION_STATUSES]),
      ),
    )
    .orderBy(desc(schema.curlingRegistrations.updated_at))
    .limit(1);
  return rows[0] ? mapRegistration(rows[0]) : null;
}

export async function abandonRegistrationDraft(registrationId: number, actor: Member): Promise<void> {
  const registration = await getRegistrationById(registrationId);
  if (!registration) {
    throw new RegistrationShellValidationError({ registration: 'Registration was not found.' });
  }
  if (!(await canViewOrEditRegistration(actor, registration))) {
    throw new RegistrationShellValidationError({ registration: 'You do not have access to this registration.' });
  }
  if (registration.status === 'confirmed' || registration.status === 'cancelled') {
    throw new RegistrationShellValidationError({ registration: 'This registration cannot be restarted.' });
  }
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.curlingRegistrations)
    .set({
      status: 'cancelled',
      cancelled_at: new Date() as any,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.curlingRegistrations.id, registrationId));
}

export async function insertEmptyGuestRegistrationDraft(input: {
  seasonId: number;
  sessionId: number;
}): Promise<RegistrationShellRow> {
  await assertRegistrationOpen(input.seasonId, input.sessionId);
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .insert(schema.curlingRegistrations)
    .values({
      season_id: input.seasonId,
      session_id: input.sessionId,
      returning_member_answer: 0,
      status: 'identity_incomplete',
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .returning();
  return mapRegistration(row);
}

export async function createDraft(input: {
  seasonId: number;
  sessionId: number;
  returningMember: boolean;
  submittedByMemberId: number;
}): Promise<RegistrationShellRow> {
  await assertRegistrationOpen(input.seasonId, input.sessionId);
  const existing = await findActiveRegistrationForSubmitter(input.submittedByMemberId);
  if (existing) {
    throw new RegistrationInProgressError();
  }
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .insert(schema.curlingRegistrations)
    .values({
      season_id: input.seasonId,
      session_id: input.sessionId,
      submitted_by_member_id: input.submittedByMemberId,
      returning_member_answer: input.returningMember ? 1 : 0,
      status: 'identity_incomplete',
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .returning();
  return mapRegistration(row);
}

export async function getRegistrationById(id: number): Promise<RegistrationShellRow | null> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db.select().from(schema.curlingRegistrations).where(eq(schema.curlingRegistrations.id, id)).limit(1);
  return row ? mapRegistration(row) : null;
}

export async function getRegistrationShellPayload(id: number) {
  const registration = await getRegistrationById(id);
  if (!registration) return null;
  const { db, schema } = getDrizzleDb();
  const [submitter] = registration.submitted_by_member_id
    ? await db.select().from(schema.members).where(eq(schema.members.id, registration.submitted_by_member_id)).limit(1)
    : [];
  const [curler] = registration.curler_member_id
    ? await db.select().from(schema.members).where(eq(schema.members.id, registration.curler_member_id)).limit(1)
    : [];
  const policies = await db
    .select()
    .from(schema.registrationPolicyAcceptances)
    .where(eq(schema.registrationPolicyAcceptances.registration_id, id));

  const curlerSummary = curler ? mapMemberSummary(curler) : null;
  const policyTypes = new Set(policies.map((p) => p.policy_type));
  const policiesComplete = REQUIRED_REGISTRATION_POLICIES.every((policy) => policyTypes.has(policy.type));
  const isMinor = isMinorOnRegistrationDate(curlerSummary?.dateOfBirth ?? null);

  return {
    registration,
    submitter: submitter ? mapMemberSummary(submitter) : null,
    curler: curlerSummary,
    policies: REQUIRED_REGISTRATION_POLICIES.map((policy) => ({
      ...policy,
      accepted: policyTypes.has(policy.type),
    })),
    policiesComplete,
    isMinor,
  };
}

export async function canViewOrEditRegistration(actor: Member | undefined, registration: RegistrationShellRow): Promise<boolean> {
  if (!actor) return false;
  if (isAdmin(actor) || isServerAdmin(actor)) return true;
  if (registration.submitted_by_member_id === actor.id || registration.curler_member_id === actor.id) return true;
  if (registration.curler_member_id) {
    return canActorImpersonateTarget(actor.id, registration.curler_member_id);
  }
  return false;
}

export async function listEligibleReturningProfiles(actorMemberId: number) {
  const options = await listAccountSwitchOptions(actorMemberId);
  const ids = options.map((option) => option.id);
  if (ids.length === 0) return [];
  const { db, schema } = getDrizzleDb();
  const rows = await db.select().from(schema.members).where(inArray(schema.members.id, ids));
  return rows.map(mapMemberSummary);
}

export async function attachReturningCurler(input: {
  registrationId: number;
  actorMemberId: number;
  curlerMemberId: number;
}): Promise<RegistrationShellRow> {
  if (!(await canActorImpersonateTarget(input.actorMemberId, input.curlerMemberId))) {
    throw new RegistrationShellValidationError({ curlerMemberId: 'You do not have access to register this curler.' });
  }
  const { db, schema } = getDrizzleDb();
  const existing = await findReusableDraft(input.registrationId, input.curlerMemberId);
  const targetId = existing?.id ?? input.registrationId;
  const [row] = await db
    .update(schema.curlingRegistrations)
    .set({
      submitted_by_member_id: input.actorMemberId,
      curler_member_id: input.curlerMemberId,
      returning_member_answer: 1,
      registering_for_self: input.actorMemberId === input.curlerMemberId ? 1 : 0,
      status: 'policies_incomplete',
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.curlingRegistrations.id, targetId))
    .returning();
  return mapRegistration(row);
}

async function findReusableDraft(registrationId: number, curlerMemberId: number): Promise<RegistrationShellRow | null> {
  const current = await getRegistrationById(registrationId);
  if (!current) return null;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.season_id, current.season_id),
        eq(schema.curlingRegistrations.session_id, current.session_id),
        eq(schema.curlingRegistrations.curler_member_id, curlerMemberId),
        or(
          eq(schema.curlingRegistrations.status, 'identity_incomplete'),
          eq(schema.curlingRegistrations.status, 'policies_incomplete'),
          eq(schema.curlingRegistrations.status, 'demographics_incomplete'),
          eq(schema.curlingRegistrations.status, 'shell_complete')
        )
      )
    )
    .orderBy(desc(schema.curlingRegistrations.updated_at))
    .limit(1);
  return rows[0] && rows[0].id !== registrationId ? mapRegistration(rows[0]) : null;
}

export async function createMemberForRegistration(input: Partial<MemberDemographicsInput> & { email: string }): Promise<MemberSummary> {
  assertValidEmail(input.email);
  const normalizedEmail = normalizeEmail(input.email);
  const firstName = input.firstName?.trim() || 'New';
  const lastName = input.lastName?.trim() || 'Curler';
  if (input.dateOfBirth) assertValidDateOfBirth(input.dateOfBirth);

  const { db, schema } = getDrizzleDb();
  const values = {
    name: memberName({ firstName, lastName }),
    email: normalizedEmail,
    phone: input.phone?.trim() || null,
    first_name: firstName,
    last_name: lastName,
    date_of_birth: input.dateOfBirth || null,
    mailing_address: input.mailingAddress?.trim() || null,
    emergency_contact_name: input.emergencyContactName?.trim() || null,
    emergency_contact_phone: input.emergencyContactPhone?.trim() || null,
    opted_in_sms: 0,
    email_subscribed: 1,
    first_login_completed: 0,
    email_visible: 0,
    phone_visible: 0,
    updated_at: sql`CURRENT_TIMESTAMP`,
  };
  const [row] = await db.insert(schema.members).values(values as any).returning();
  return mapMemberSummary(row);
}

export async function attachNewCurler(input: {
  registrationId: number;
  actorMemberId?: number;
  registeringForSelf: boolean;
  submitter?: Partial<MemberDemographicsInput> & { email: string };
  curler: Partial<MemberDemographicsInput> & { email: string };
  useSubmitterEmailForCurler?: boolean;
}): Promise<{ registration: RegistrationShellRow; submitter: MemberSummary; curler: MemberSummary }> {
  const { db, schema } = getDrizzleDb();
  const submitter = input.actorMemberId
    ? mapMemberSummary((await db.select().from(schema.members).where(eq(schema.members.id, input.actorMemberId)).limit(1))[0])
    : await createMemberForRegistration(input.submitter ?? input.curler);

  const curler = input.registeringForSelf
    ? submitter
    : await createMemberForRegistration({
        ...input.curler,
        email: input.useSubmitterEmailForCurler ? submitter.email ?? input.curler.email : input.curler.email,
      });

  if (!input.registeringForSelf && submitter.id !== curler.id && normalizeEmail(submitter.email ?? '') !== normalizeEmail(curler.email ?? '')) {
    await db
      .insert(schema.memberAccountAccessDelegations)
      .values({ grantor_member_id: curler.id, grantee_member_id: submitter.id })
      .onConflictDoNothing();
  }

  const [row] = await db
    .update(schema.curlingRegistrations)
    .set({
      submitted_by_member_id: submitter.id,
      curler_member_id: curler.id,
      returning_member_answer: 0,
      registering_for_self: input.registeringForSelf ? 1 : 0,
      status: 'policies_incomplete',
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.curlingRegistrations.id, input.registrationId))
    .returning();

  return { registration: mapRegistration(row), submitter, curler };
}

export async function acceptPolicies(registrationId: number, actorMemberId: number): Promise<void> {
  const registration = await getRegistrationById(registrationId);
  if (!registration?.curler_member_id) {
    throw new RegistrationShellValidationError({ registration: 'A curler must be selected before accepting policies.' });
  }
  const { db, schema } = getDrizzleDb();
  for (const policy of REQUIRED_REGISTRATION_POLICIES) {
    const acceptedAt = new Date();
    await db
      .insert(schema.registrationPolicyAcceptances)
      .values({
        registration_id: registrationId,
        policy_type: policy.type,
        policy_url: policy.url,
        policy_version: policy.version,
        accepted_by_member_id: actorMemberId,
        accepted_for_member_id: registration.curler_member_id,
        accepted_at: acceptedAt,
      } as any)
      .onConflictDoUpdate({
        target: [schema.registrationPolicyAcceptances.registration_id, schema.registrationPolicyAcceptances.policy_type],
        set: {
          accepted_by_member_id: actorMemberId,
          accepted_for_member_id: registration.curler_member_id,
          accepted_at: acceptedAt as any,
          policy_url: policy.url,
          policy_version: policy.version,
        },
      });
  }
  await db
    .update(schema.curlingRegistrations)
    .set({ status: 'demographics_incomplete', updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(schema.curlingRegistrations.id, registrationId));
}

export async function updateCurlerDemographics(registrationId: number, input: MemberDemographicsInput, confirmedCurrent = false): Promise<void> {
  validateDemographics(input);
  const registration = await getRegistrationById(registrationId);
  if (!registration?.curler_member_id) {
    throw new RegistrationShellValidationError({ curler: 'A curler must be selected before demographics can be updated.' });
  }
  const curlerRow = await fetchMemberEmailRow(registration.curler_member_id);
  const { db, schema } = getDrizzleDb();
  const normalizedEmail = normalizeEmail(input.email);
  if (isEmailChangeToReservedServerAdminAddress(curlerRow?.email ?? null, normalizedEmail)) {
    throw new RegistrationShellValidationError({
      email: MEMBER_PROFILE_EMAIL_UNAVAILABLE,
    });
  }
  const conflictId = await findMemberIdWithConflictingNormalizedEmail(
    normalizedEmail,
    registration.curler_member_id
  );
  if (conflictId != null) {
    throw new RegistrationShellValidationError({
      email: MEMBER_PROFILE_EMAIL_UNAVAILABLE,
    });
  }
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
    .where(eq(schema.members.id, registration.curler_member_id));
  await db
    .update(schema.curlingRegistrations)
    .set({
      demographics_current_confirmed: confirmedCurrent ? 1 : 0,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.curlingRegistrations.id, registrationId));
}

export async function updateGuardian(registrationId: number, input: GuardianInput): Promise<void> {
  validateGuardian(input);
  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.curlingRegistrations)
    .set({
      guardian_first_name: input.firstName.trim(),
      guardian_last_name: input.lastName.trim(),
      guardian_email: normalizeEmail(input.email),
      guardian_phone: input.phone.trim(),
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.curlingRegistrations.id, registrationId));
}

export async function completeShell(registrationId: number): Promise<RegistrationShellRow> {
  const payload = await getRegistrationShellPayload(registrationId);
  if (!payload) throw new RegistrationShellValidationError({ registration: 'Registration was not found.' });
  const { registration, curler, policiesComplete, isMinor } = payload;
  const details: Record<string, string> = {};
  if (!registration.submitted_by_member_id) details.submitter = 'The submitting user is required.';
  if (!registration.curler_member_id) details.curler = 'The curler is required.';
  if (!policiesComplete) details.policies = 'All required policies must be accepted.';
  if (!curler?.firstName || !curler.lastName || !curler.dateOfBirth || !curler.email || !curler.phone || !curler.mailingAddress || !curler.emergencyContactName || !curler.emergencyContactPhone) {
    details.demographics = 'Required curler demographic information is incomplete.';
  }
  if (isMinor && (!registration.guardian_first_name || !registration.guardian_last_name || !registration.guardian_email || !registration.guardian_phone)) {
    details.guardian = 'Parent/guardian information is required for minors.';
  }
  if (Object.keys(details).length > 0) throw new RegistrationShellValidationError(details);

  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .update(schema.curlingRegistrations)
    .set({
      status: 'shell_complete',
      shell_completed_at: new Date() as any,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.curlingRegistrations.id, registrationId))
    .returning();
  return mapRegistration(row);
}

export type GuestRegistrationSubmitInput = {
  seasonId: number;
  sessionId: number;
  registeringForSelf: boolean;
  useSubmitterEmailForCurler?: boolean;
  submitter?: Partial<MemberDemographicsInput> & { email: string };
  curler: MemberDemographicsInput;
  guardian?: GuardianInput;
  membershipChoice: 'regular' | 'social';
  basicIcePrivileges: boolean;
  studentDiscountClaimed: boolean;
  studentInstitution: string | null;
  reciprocalDiscountClaimed: boolean;
  reciprocalClubName: string | null;
  experienceType: 'none_or_minimal' | 'specified_years' | 'known_existing';
  experienceSelfReportedYears: number | null;
};

export async function submitGuestRegistration(input: GuestRegistrationSubmitInput) {
  await assertRegistrationOpen(input.seasonId, input.sessionId);
  validateDemographics(input.curler);
  const minor = isMinorOnRegistrationDate(input.curler.dateOfBirth);
  if (minor) {
    if (!input.guardian) {
      throw new RegistrationShellValidationError({ guardian: 'Parent/guardian information is required for minors.' });
    }
    validateGuardian(input.guardian);
  }
  if (!input.registeringForSelf) {
    const s = input.submitter ?? input.curler;
    assertValidEmail(s.email || '', 'submitterEmail');
  }

  const draft = await insertEmptyGuestRegistrationDraft({ seasonId: input.seasonId, sessionId: input.sessionId });
  const { submitter } = await attachNewCurler({
    registrationId: draft.id,
    registeringForSelf: input.registeringForSelf,
    submitter: input.registeringForSelf ? undefined : input.submitter ?? input.curler,
    curler: input.curler,
    useSubmitterEmailForCurler: input.useSubmitterEmailForCurler,
  });
  await acceptPolicies(draft.id, submitter.id);
  await updateCurlerDemographics(draft.id, input.curler, false);
  if (minor && input.guardian) {
    await updateGuardian(draft.id, input.guardian);
  }
  await completeShell(draft.id);

  const { db, schema } = getDrizzleDb();
  const [actorRow] = await db.select().from(schema.members).where(eq(schema.members.id, submitter.id)).limit(1);
  if (!actorRow) {
    throw new RegistrationShellValidationError({ registration: 'Could not load submitting member profile.' });
  }
  const actor = actorRow as Member;

  const membershipPayment = await import('./registrationMembershipPaymentService.js');
  if (input.membershipChoice === 'social') {
    await membershipPayment.updateMembership(draft.id, actor, { membershipOption: 'social', basicIcePrivileges: false });
  } else {
    const resolvedExperienceType =
      input.experienceType === 'known_existing' ? 'none_or_minimal' : input.experienceType;
    await membershipPayment.updateMembership(draft.id, actor, { membershipOption: 'regular', basicIcePrivileges: false });
    await membershipPayment.updateDiscounts(draft.id, actor, {
      studentDiscountClaimed: input.studentDiscountClaimed,
      studentInstitution: input.studentInstitution,
      reciprocalDiscountClaimed: input.reciprocalDiscountClaimed,
      reciprocalClubName: input.reciprocalClubName,
    });
    if (resolvedExperienceType === 'specified_years') {
      const years = input.experienceSelfReportedYears;
      if (years === null || years === undefined) {
        throw new RegistrationShellValidationError({
          experienceSelfReportedYears: 'Years of experience is required.',
        });
      }
      await membershipPayment.updateExperience(draft.id, actor, {
        experienceType: 'specified_years',
        experienceSelfReportedYears: years,
      });
    } else {
      await membershipPayment.updateExperience(draft.id, actor, {
        experienceType: 'none_or_minimal',
        experienceSelfReportedYears: null,
      });
    }
    await membershipPayment.updateMembership(draft.id, actor, { membershipOption: 'regular', basicIcePrivileges: input.basicIcePrivileges });
  }

  return membershipPayment.submitRegistrationMembershipPayment({ registrationId: draft.id, actor });
}
