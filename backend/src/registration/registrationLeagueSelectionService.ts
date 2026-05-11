import { eq, sql } from 'drizzle-orm';
import type {
  CurlingRegistrationSelectionKindSqlite,
  CurlingRegistrationSelectionStatusSqlite,
} from '../db/drizzle-schema.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { evaluateRegistrationDraft } from './evaluateRegistrationDraft.js';
import { evaluateWaitlistCleanup, validateRegistrationSelections } from './registrationLeagueSelections.js';
import { buildRegistrationContextForDraft } from './registrationMembershipPaymentService.js';
import { canViewOrEditRegistration, getRegistrationById } from './registrationShellService.js';
import type { RegistrationContext, RegistrationSelectionInput } from './registrationContext.js';

export class RegistrationLeagueSelectionValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Registration league selection validation failed');
  }
}

export type LeagueSelectionSaveInput = {
  selections: RegistrationSelectionInput[];
};

function assertSelectionType(value: string): asserts value is CurlingRegistrationSelectionKindSqlite {
  const allowed = new Set<CurlingRegistrationSelectionKindSqlite>([
    'guaranteed_return',
    'sabbatical',
    'drop',
    'return_subject_to_availability',
    'waitlist_add',
    'waitlist_replace',
    'third_league_interest',
    'byot_request',
    'junior_recreational',
    'spare_only',
  ]);
  if (!allowed.has(value as CurlingRegistrationSelectionKindSqlite)) {
    throw new RegistrationLeagueSelectionValidationError({ selectionType: 'Unsupported registration selection type.' });
  }
}

function normalizeSelections(input: RegistrationSelectionInput[]): RegistrationSelectionInput[] {
  return input.map((selection, index) => {
    assertSelectionType(selection.selectionType);
    return {
      selectionType: selection.selectionType,
      leagueId: selection.leagueId ?? null,
      rank: selection.rank ?? index + 1,
      replacesLeagueId: selection.replacesLeagueId ?? null,
      byotTeammateText: selection.byotTeammateText?.trim() || null,
      isTemporarySabbaticalFill: selection.isTemporarySabbaticalFill === true,
    };
  });
}

async function requireEditableRegistration(registrationId: number, actor: Member) {
  const registration = await getRegistrationById(registrationId);
  if (!registration) {
    throw new RegistrationLeagueSelectionValidationError({ registration: 'Registration draft not found.' });
  }
  if (!(await canViewOrEditRegistration(actor, registration))) {
    throw new RegistrationLeagueSelectionValidationError({ registration: 'You do not have access to this registration.' });
  }
  if (registration.status !== 'shell_complete') {
    throw new RegistrationLeagueSelectionValidationError({ registration: 'Complete the registration shell before selecting leagues.' });
  }
  return registration;
}

function statusForSelection(selectionType: CurlingRegistrationSelectionKindSqlite): CurlingRegistrationSelectionStatusSqlite {
  if (selectionType === 'guaranteed_return') return 'confirmed';
  if (selectionType === 'drop') return 'dropped';
  if (selectionType === 'waitlist_add' || selectionType === 'waitlist_replace') return 'waitlisted';
  return 'pending';
}

function validationDetails(context: RegistrationContext): Record<string, string> {
  const validation = validateRegistrationSelections(context);
  const cleanup = evaluateWaitlistCleanup(context);
  const details: Record<string, string> = {};
  for (const [index, error] of validation.blockingErrors.entries()) {
    details[`selection.${index}.${error.code}`] = error.message;
  }
  for (const [index, error] of cleanup.blockingErrors.entries()) {
    details[`waitlistCleanup.${index}.${error.code}`] = error.message;
  }
  return details;
}

export async function getRegistrationLeagueSelectionPayload(registrationId: number, actor: Member) {
  await requireEditableRegistration(registrationId, actor);
  const context = await buildRegistrationContextForDraft(registrationId);
  return {
    leagues: Object.values(context.leagues).sort((a, b) => a.name.localeCompare(b.name)),
    selections: context.selections,
    activeLeagueIds: context.activeLeagueIds,
    participatedLeagueIds: context.participatedLeagueIds,
    existingWaitlistEntries: context.existingWaitlistEntries,
    evaluation: evaluateRegistrationDraft(context),
  };
}

export async function putRegistrationLeagueSelections(registrationId: number, actor: Member, input: LeagueSelectionSaveInput) {
  await requireEditableRegistration(registrationId, actor);
  const selections = normalizeSelections(input.selections);
  const currentContext = await buildRegistrationContextForDraft(registrationId);
  const context: RegistrationContext = { ...currentContext, selections };
  const details = validationDetails(context);
  if (Object.keys(details).length > 0) {
    throw new RegistrationLeagueSelectionValidationError(details);
  }

  const { db, schema } = getDrizzleDb();
  await db.transaction(async (tx) => {
    await tx.delete(schema.registrationSelections).where(eq(schema.registrationSelections.registration_id, registrationId));
    if (selections.length > 0) {
      await tx.insert(schema.registrationSelections).values(
        selections.map((selection) => {
          const league = selection.leagueId ? context.leagues[selection.leagueId] : undefined;
          return {
            registration_id: registrationId,
            league_id: selection.leagueId ?? null,
            selection_type: selection.selectionType,
            rank: selection.rank ?? null,
            replaces_league_id: selection.replacesLeagueId ?? null,
            is_temporary_sabbatical_fill: selection.isTemporarySabbaticalFill ? 1 : 0,
            byot_teammate_text: selection.byotTeammateText ?? null,
            status: statusForSelection(selection.selectionType),
            fee_amount_minor_snapshot: league?.registrationFeeMinor ?? 0,
            discount_amount_minor_snapshot: 0,
            updated_at: sql`CURRENT_TIMESTAMP`,
          };
        })
      );
    }
  });

  const savedContext = await buildRegistrationContextForDraft(registrationId);
  return {
    leagues: Object.values(savedContext.leagues).sort((a, b) => a.name.localeCompare(b.name)),
    selections: savedContext.selections,
    activeLeagueIds: savedContext.activeLeagueIds,
    participatedLeagueIds: savedContext.participatedLeagueIds,
    existingWaitlistEntries: savedContext.existingWaitlistEntries,
    evaluation: evaluateRegistrationDraft(savedContext),
  };
}

export async function getRegistrationLeagueSelectionEvaluation(registrationId: number, actor: Member) {
  await requireEditableRegistration(registrationId, actor);
  const context = await buildRegistrationContextForDraft(registrationId);
  return evaluateRegistrationDraft(context);
}
