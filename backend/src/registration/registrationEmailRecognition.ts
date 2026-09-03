import { and, eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { ACCOUNT_KIND_PERSON } from '../utils/accountKind.js';
import { normalizeEmail } from '../utils/auth.js';

export const REGISTRATION_EMAIL_REQUIRES_LOGIN =
  'An account already exists for this email address. Log in to continue registration.';

export const REGISTRATION_EMAIL_IN_USE_BY_OTHER =
  'This email is already associated with a club account. That person should log in to register, or add you as a delegated user.';

export class RegistrationEmailRecognizedError extends Error {
  constructor(
    message: string,
    public details: { requiresLogin?: boolean; emailInUse?: boolean } = { requiresLogin: true },
  ) {
    super(message);
  }
}

export type NewRegistrationEmailDecision = 'allow' | 'require_login' | 'email_in_use';

export function classifyNewRegistrationEmail(input: {
  recognizedMemberId: number | null;
  actorMemberId?: number | null;
  actorEmail?: string | null;
  candidateEmail: string;
}): NewRegistrationEmailDecision {
  if (input.recognizedMemberId == null) return 'allow';
  if (!input.actorMemberId) return 'require_login';
  const actorEmail = input.actorEmail?.trim() ? normalizeEmail(input.actorEmail) : '';
  if (actorEmail && actorEmail === normalizeEmail(input.candidateEmail)) return 'allow';
  return 'email_in_use';
}

export async function findRecognizedPersonMemberIdByEmail(email: string): Promise<number | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(
      and(
        sql`lower(trim(${schema.members.email})) = ${normalized}`,
        eq(schema.members.account_kind, ACCOUNT_KIND_PERSON),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function registrationEmailIsRecognized(email: string): Promise<boolean> {
  return (await findRecognizedPersonMemberIdByEmail(email)) != null;
}

export async function assertNewRegistrationEmailAvailable(input: {
  candidateEmail: string;
  actorMemberId?: number | null;
  actorEmail?: string | null;
}): Promise<void> {
  const recognizedMemberId = await findRecognizedPersonMemberIdByEmail(input.candidateEmail);
  const decision = classifyNewRegistrationEmail({
    recognizedMemberId,
    actorMemberId: input.actorMemberId,
    actorEmail: input.actorEmail,
    candidateEmail: input.candidateEmail,
  });
  if (decision === 'require_login') {
    throw new RegistrationEmailRecognizedError(REGISTRATION_EMAIL_REQUIRES_LOGIN, { requiresLogin: true });
  }
  if (decision === 'email_in_use') {
    throw new RegistrationEmailRecognizedError(REGISTRATION_EMAIL_IN_USE_BY_OTHER, { emailInUse: true });
  }
}
