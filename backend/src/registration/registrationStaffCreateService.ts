import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { memberCanManageRegistrations } from '../utils/registrationStaffAccess.js';
import { nameTagStepIsComplete } from '../utils/nameTag.js';
import {
  acceptPolicies,
  assertRegistrationOpen,
  completeShell,
  createMemberForRegistration,
  curlerDemographicsAreComplete,
  getRegistrationById,
  getRegistrationShellPayload,
  mapMemberSummary,
  mapRegistration,
  RegistrationShellValidationError,
  type RegistrationShellRow,
} from './registrationShellService.js';
import { DRAFT_REGISTRATION_STATUSES, SUBMITTED_CURLER_REGISTRATION_STATUSES } from './registrationDraftProgress.js';
import { RegistrationStaffValidationError } from './registrationStaffService.js';

export type StaffNewCurlerInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
};

export type CreateStaffRegistrationDraftResult = {
  id: number;
  nextStep: string;
  reusedExistingDraft: boolean;
  curler: { id: number; name: string; email: string | null };
};

function assertStaffAccess(actor: Member): void {
  if (!memberCanManageRegistrations(actor)) {
    throw new RegistrationStaffValidationError({ registration: 'You do not have permission to manage registrations.' });
  }
}

async function findSubmittedCurlerRegistration(seasonId: number, sessionId: number, curlerMemberId: number) {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.season_id, seasonId),
        eq(schema.curlingRegistrations.session_id, sessionId),
        eq(schema.curlingRegistrations.curler_member_id, curlerMemberId),
        sql`${schema.curlingRegistrations.submitted_at} IS NOT NULL`,
        inArray(schema.curlingRegistrations.status, [...SUBMITTED_CURLER_REGISTRATION_STATUSES]),
      ),
    )
    .orderBy(desc(schema.curlingRegistrations.updated_at))
    .limit(1);
  return row ? mapRegistration(row) : null;
}

async function findReusableCurlerDraft(seasonId: number, sessionId: number, curlerMemberId: number) {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select()
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.season_id, seasonId),
        eq(schema.curlingRegistrations.session_id, sessionId),
        eq(schema.curlingRegistrations.curler_member_id, curlerMemberId),
        or(
          eq(schema.curlingRegistrations.status, 'identity_incomplete'),
          eq(schema.curlingRegistrations.status, 'policies_incomplete'),
          eq(schema.curlingRegistrations.status, 'demographics_incomplete'),
          eq(schema.curlingRegistrations.status, 'shell_complete'),
        ),
      ),
    )
    .orderBy(desc(schema.curlingRegistrations.updated_at))
    .limit(1);
  return row ? mapRegistration(row) : null;
}

function nextStaffRegistrationStep(payload: NonNullable<Awaited<ReturnType<typeof getRegistrationShellPayload>>>): string {
  const { registration, curler, isMinor } = payload;
  if (!registration.curler_member_id) return 'identity';
  const nameTagComplete = nameTagStepIsComplete({
    isReturningMember: registration.returning_member_answer === 1,
    name: curler?.nameTagName,
    includePronouns: curler?.nameTagIncludePronouns,
    replacementQuantity: registration.name_tag_replacement_quantity,
  });

  switch (registration.status) {
    case 'identity_incomplete':
      return 'identity';
    case 'policies_incomplete':
      return 'policies';
    case 'demographics_incomplete':
      if (!registration.demographics_current_confirmed) return 'demographics';
      if (!nameTagComplete) return 'name-tag';
      if (isMinor && !registration.guardian_email) return 'guardian';
      return 'discounts';
    case 'shell_complete':
      return 'discounts';
    default:
      return 'review';
  }
}

export async function createStaffRegistrationDraft(input: {
  actor: Member;
  sessionId: number;
  acceptPoliciesOnBehalf: boolean;
  curlerMemberId?: number;
  newCurler?: StaffNewCurlerInput;
}): Promise<CreateStaffRegistrationDraftResult> {
  assertStaffAccess(input.actor);
  if (!input.acceptPoliciesOnBehalf) {
    throw new RegistrationStaffValidationError({
      acceptPoliciesOnBehalf: 'Accept the required policies on behalf of this curler to continue.',
    });
  }
  if (!input.curlerMemberId && !input.newCurler) {
    throw new RegistrationStaffValidationError({ curler: 'Select an existing member or enter a new curler.' });
  }
  if (input.curlerMemberId && input.newCurler) {
    throw new RegistrationStaffValidationError({ curler: 'Choose either an existing member or a new curler, not both.' });
  }

  const { db, schema } = getDrizzleDb();
  const [session] = await db
    .select({
      id: schema.curlingSessions.id,
      seasonId: schema.curlingSessions.season_id,
    })
    .from(schema.curlingSessions)
    .where(eq(schema.curlingSessions.id, input.sessionId))
    .limit(1);
  if (!session) {
    throw new RegistrationStaffValidationError({ sessionId: 'Registration session was not found.' });
  }

  try {
    await assertRegistrationOpen(session.seasonId, session.id);
  } catch (error) {
    if (error instanceof RegistrationShellValidationError) {
      throw new RegistrationStaffValidationError(error.details);
    }
    throw error;
  }

  let curlerId: number;
  let returningMember = false;
  if (input.curlerMemberId) {
    const [existing] = await db.select().from(schema.members).where(eq(schema.members.id, input.curlerMemberId)).limit(1);
    if (!existing) {
      throw new RegistrationStaffValidationError({ curlerMemberId: 'That member was not found.' });
    }
    curlerId = existing.id;
    returningMember = true;
  } else {
    try {
      const created = await createMemberForRegistration({
        firstName: input.newCurler!.firstName,
        lastName: input.newCurler!.lastName,
        email: input.newCurler!.email,
        phone: input.newCurler!.phone,
      });
      curlerId = created.id;
    } catch (error) {
      if (error instanceof RegistrationShellValidationError) {
        throw new RegistrationStaffValidationError(error.details);
      }
      throw error;
    }
  }

  const submitted = await findSubmittedCurlerRegistration(session.seasonId, session.id, curlerId);
  if (submitted) {
    throw new RegistrationStaffValidationError({
      curler: 'This curler already has a submitted registration for this session.',
    });
  }

  const reusable = await findReusableCurlerDraft(session.seasonId, session.id, curlerId);
  let registration: RegistrationShellRow;
  let reusedExistingDraft = false;
  if (reusable) {
    registration = reusable;
    reusedExistingDraft = true;
    const [updated] = await db
      .update(schema.curlingRegistrations)
      .set({
        submitted_by_member_id: input.actor.id,
        curler_member_id: curlerId,
        returning_member_answer: returningMember ? 1 : registration.returning_member_answer,
        registering_for_self: 0,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, reusable.id))
      .returning();
    registration = mapRegistration(updated);
  } else {
    const [row] = await db
      .insert(schema.curlingRegistrations)
      .values({
        season_id: session.seasonId,
        session_id: session.id,
        submitted_by_member_id: input.actor.id,
        curler_member_id: curlerId,
        returning_member_answer: returningMember ? 1 : 0,
        registering_for_self: 0,
        status: 'policies_incomplete',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .returning();
    registration = mapRegistration(row);
  }

  const [curlerRow] = await db.select().from(schema.members).where(eq(schema.members.id, curlerId)).limit(1);
  const curler = mapMemberSummary(curlerRow);
  const demographicsComplete = curlerDemographicsAreComplete(
    {
      firstName: curler.firstName ?? '',
      lastName: curler.lastName ?? '',
      email: curler.email ?? '',
      phone: curler.phone ?? '',
      mailingAddress: curler.mailingAddress ?? '',
      emergencyContactName: curler.emergencyContactName ?? '',
      emergencyContactPhone: curler.emergencyContactPhone ?? '',
      preferredPronouns: curler.preferredPronouns ?? '',
      usaCurlingCompetitionGender: curler.usaCurlingCompetitionGender ?? '',
    },
    curler.dateOfBirth,
  );
  if (demographicsComplete) {
    await db
      .update(schema.curlingRegistrations)
      .set({
        demographics_current_confirmed: 1,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, registration.id));
  }

  const current = await getRegistrationById(registration.id);
  if (current && (DRAFT_REGISTRATION_STATUSES as readonly string[]).includes(current.status) && current.status !== 'shell_complete') {
    await acceptPolicies(registration.id, input.actor.id);
  }

  try {
    await completeShell(registration.id);
  } catch {
    // Remaining shell steps (demographics, name tag, guardian) are finished in the wizard.
  }

  const payload = await getRegistrationShellPayload(registration.id);
  if (!payload) {
    throw new RegistrationStaffValidationError({ registration: 'Registration was not found after create.' });
  }

  return {
    id: registration.id,
    nextStep: nextStaffRegistrationStep(payload),
    reusedExistingDraft,
    curler: {
      id: curler.id,
      name: [curler.firstName, curler.lastName].filter(Boolean).join(' ').trim() || curler.name || curler.email || 'Curler',
      email: curler.email,
    },
  };
}
