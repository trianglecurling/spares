import { eq, sql } from 'drizzle-orm';
import type {
  CurlingRegistrationSelectionKindSqlite,
  CurlingRegistrationSelectionStatusSqlite,
} from '../db/drizzle-schema.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { evaluateRegistrationDraft } from './evaluateRegistrationDraft.js';
import { evaluateExistingWaitlistPreferences, evaluateWaitlistCleanup, registrationTouchesWaitlistChoices, validateRegistrationSelections } from './registrationLeagueSelections.js';
import { buildRegistrationContextForDraft } from './registrationMembershipPaymentService.js';
import {
  assertRegistrationEditableForLeagueOrMembership,
  isPriorityEditableRegistrationStatus,
  RegistrationPriorityEditValidationError,
} from './registrationPriorityEdit.js';
import { getRegistrationById } from './registrationShellService.js';
import { removeOrphanedRegistrationRosterPlacements } from './registrationRosterService.js';
import { removeExistingWaitlistsMarkedForRemoval, removeOrphanedRegistrationWaitlistEntries } from './registrationWaitlistCleanup.js';
import type { LeagueConfig, RegistrationContext, RegistrationSelectionInput } from './registrationContext.js';
import { applyAddWaitlistPriorityRanks, requiresWaitlistFulfillmentPreferences } from './waitlistFulfillment.js';
import { listContinuingSabbaticalSummaries } from './registrationSabbaticalContinuity.js';
import { loadActiveWaitlistEntryCountsByLeagueId } from './waitlistEntityService.js';

export class RegistrationLeagueSelectionValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Registration league selection validation failed');
  }
}

export type LeagueSelectionSaveInput = {
  selections: RegistrationSelectionInput[];
  desiredAddWaitlistLeagueCount?: number | null;
  addWaitlistPriority?: number[];
};

export type BasicIceFallbackSaveInput = {
  interested: boolean;
};

function hasGuaranteedReturnSelections(selections: RegistrationSelectionInput[]): boolean {
  return selections.some((selection) => selection.selectionType === 'guaranteed_return');
}

function basicIceFallbackInterestFromRow(value: number | null | undefined): boolean | null {
  if (value === 0) return false;
  if (value === 1) return true;
  return null;
}

function canCollectBasicIceFallback(input: {
  icePrivilegesChoice: string | null | undefined;
  membershipOption: string | null | undefined;
  selections: RegistrationSelectionInput[];
}): boolean {
  if (input.icePrivilegesChoice === 'basic_ice') return false;
  if (input.membershipOption === 'junior_recreational') return false;
  return !hasGuaranteedReturnSelections(input.selections);
}

function assertSelectionType(value: string): asserts value is CurlingRegistrationSelectionKindSqlite {
  const allowed = new Set<CurlingRegistrationSelectionKindSqlite>([
    'guaranteed_return',
    'sabbatical',
    'drop',
    'return_subject_to_availability',
    'waitlist_add',
    'waitlist_replace',
    'waitlist_add_auto_decline',
    'waitlist_replace_auto_decline',
    'waitlist_keep_auto_accept',
    'waitlist_keep_auto_decline',
    'waitlist_remove',
    'third_league_interest',
    'byot_request',
    'play_in_request',
    'instructional_join',
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
      teamRosterText: selection.teamRosterText?.trim() || null,
      teamRosterPlacements: selection.teamRosterPlacements?.map((placement) => ({
        memberId: placement.memberId,
        entryType: placement.entryType,
        replacesLeagueId: placement.entryType === 'replace' ? placement.replacesLeagueId ?? null : null,
      })),
      isTemporarySabbaticalFill: selection.isTemporarySabbaticalFill === true,
    };
  });
}

function normalizeDrawTimeForSort(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(11, 19);
  if (typeof value === 'string') return value;
  return String(value);
}

/** Match /leagues ordering: day of week, then earliest draw time, then name. */
async function sortLeaguesByDayThenFirstDraw(leagues: LeagueConfig[]): Promise<LeagueConfig[]> {
  if (leagues.length === 0) return leagues;

  const { db, schema } = getDrizzleDb();
  const minDrawRows = await db
    .select({
      league_id: schema.leagueDrawTimes.league_id,
      first_draw: sql<string>`min(${schema.leagueDrawTimes.draw_time})`,
    })
    .from(schema.leagueDrawTimes)
    .groupBy(schema.leagueDrawTimes.league_id);

  const firstDrawByLeagueId = new Map<number, string>();
  for (const row of minDrawRows) {
    firstDrawByLeagueId.set(row.league_id, normalizeDrawTimeForSort(row.first_draw));
  }

  return [...leagues].sort((a, b) => {
    const dowDiff = (a.dayOfWeek ?? Number.MAX_SAFE_INTEGER) - (b.dayOfWeek ?? Number.MAX_SAFE_INTEGER);
    if (dowDiff !== 0) return dowDiff;

    const ta = firstDrawByLeagueId.get(a.id);
    const tb = firstDrawByLeagueId.get(b.id);
    const hasA = ta !== undefined && ta !== '';
    const hasB = tb !== undefined && tb !== '';
    if (hasA && hasB && ta !== tb) {
      return ta.localeCompare(tb);
    }
    if (hasA !== hasB) {
      return hasA ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

async function requireEditableRegistration(registrationId: number, actor: Member) {
  const registration = await getRegistrationById(registrationId);
  if (!registration) {
    throw new RegistrationLeagueSelectionValidationError({ registration: 'Registration draft not found.' });
  }
  try {
    await assertRegistrationEditableForLeagueOrMembership(actor, registration);
  } catch (error) {
    if (error instanceof RegistrationPriorityEditValidationError) {
      throw new RegistrationLeagueSelectionValidationError(error.details);
    }
    throw error;
  }
  return registration;
}

function statusForSelection(selectionType: CurlingRegistrationSelectionKindSqlite): CurlingRegistrationSelectionStatusSqlite {
  if (selectionType === 'guaranteed_return') return 'confirmed';
  if (selectionType === 'drop') return 'dropped';
  if (selectionType === 'waitlist_remove') return 'cancelled';
  if (
    selectionType === 'waitlist_add' ||
    selectionType === 'waitlist_replace' ||
    selectionType === 'waitlist_add_auto_decline' ||
    selectionType === 'waitlist_replace_auto_decline' ||
    selectionType === 'waitlist_keep_auto_accept' ||
    selectionType === 'waitlist_keep_auto_decline'
  ) {
    return 'waitlisted';
  }
  return 'pending';
}

function validationDetails(
  context: RegistrationContext,
  selections: RegistrationSelectionInput[],
  desiredAddWaitlistLeagueCount?: number | null,
): Record<string, string> {
  const validation = validateRegistrationSelections({
    ...context,
    desiredAddWaitlistLeagueCount: desiredAddWaitlistLeagueCount ?? context.desiredAddWaitlistLeagueCount ?? null,
  });
  const cleanup = evaluateWaitlistCleanup(context);
  const existingWaitlistPreferences = registrationTouchesWaitlistChoices(selections)
    ? evaluateExistingWaitlistPreferences(context)
    : { blockingErrors: [] as ReturnType<typeof validateRegistrationSelections>['blockingErrors'] };
  const details: Record<string, string> = {};
  for (const [index, error] of validation.blockingErrors.entries()) {
    details[`selection.${index}.${error.code}`] = error.message;
  }
  for (const [index, error] of cleanup.blockingErrors.entries()) {
    details[`waitlistCleanup.${index}.${error.code}`] = error.message;
  }
  for (const [index, error] of existingWaitlistPreferences.blockingErrors.entries()) {
    details[`existingWaitlist.${index}.${error.code}`] = error.message;
  }
  return details;
}

async function leaguesWithActiveWaitlistEntryCounts(leagues: LeagueConfig[]): Promise<LeagueConfig[]> {
  const counts = await loadActiveWaitlistEntryCountsByLeagueId(leagues.map((league) => league.id));
  return leagues.map((league) => ({
    ...league,
    activeWaitlistEntryCount: league.waitlistId != null ? (counts.get(league.id) ?? 0) : 0,
  }));
}

async function buildRegistrationLeagueSelectionPayload(registrationId: number) {
  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select({ basic_ice_fallback_interest: schema.curlingRegistrations.basic_ice_fallback_interest })
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.id, registrationId))
    .limit(1);
  const context = await buildRegistrationContextForDraft(registrationId);
  const leagues = await leaguesWithActiveWaitlistEntryCounts(
    await sortLeaguesByDayThenFirstDraw(Object.values(context.leagues)),
  );
  return {
    leagues,
    selections: context.selections,
    activeLeagueIds: context.activeLeagueIds,
    participatedLeagueIds: context.participatedLeagueIds,
    continuingSabbaticals: listContinuingSabbaticalSummaries(context),
    existingWaitlistEntries: context.existingWaitlistEntries,
    desiredAddWaitlistLeagueCount: context.desiredAddWaitlistLeagueCount ?? null,
    basicIceFallbackInterest: basicIceFallbackInterestFromRow(registration?.basic_ice_fallback_interest),
    evaluation: evaluateRegistrationDraft(context),
  };
}

export async function getRegistrationLeagueSelectionPayload(registrationId: number, actor: Member) {
  await requireEditableRegistration(registrationId, actor);
  return buildRegistrationLeagueSelectionPayload(registrationId);
}

export async function putRegistrationLeagueSelections(registrationId: number, actor: Member, input: LeagueSelectionSaveInput) {
  const registration = await requireEditableRegistration(registrationId, actor);
  const selections = normalizeSelections(input.selections);
  const currentContext = await buildRegistrationContextForDraft(registrationId);
  const contextForWaitlistFulfillment: RegistrationContext = {
    ...currentContext,
    selections,
  };
  const desiredAddWaitlistLeagueCount = requiresWaitlistFulfillmentPreferences(contextForWaitlistFulfillment)
    ? (input.desiredAddWaitlistLeagueCount ?? null)
    : null;
  const addWaitlistPriority =
    desiredAddWaitlistLeagueCount != null && input.addWaitlistPriority?.length ? input.addWaitlistPriority : [];
  const prioritySelections =
    addWaitlistPriority.length > 0 ? applyAddWaitlistPriorityRanks(selections, addWaitlistPriority) : selections;
  const context: RegistrationContext = {
    ...currentContext,
    selections: prioritySelections,
    desiredAddWaitlistLeagueCount,
  };
  if (registration.ice_privileges_choice === 'basic_ice') {
    const hasPaidLeague = selections.some(
      (selection) => selection.leagueId != null && (context.leagues[selection.leagueId]?.registrationFeeMinor ?? 0) > 0,
    );
    if (hasPaidLeague) {
      throw new RegistrationLeagueSelectionValidationError({
        icePrivileges: 'Basic ice privileges only include daytime leagues. Choose league play to register for other leagues.',
      });
    }
  }
  const details = validationDetails(context, prioritySelections, desiredAddWaitlistLeagueCount);
  if (Object.keys(details).length > 0) {
    throw new RegistrationLeagueSelectionValidationError(details);
  }

  const { db, schema } = getDrizzleDb();
  const clearBasicIceFallbackInterest = hasGuaranteedReturnSelections(prioritySelections);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.curlingRegistrations)
      .set({
        desired_add_waitlist_league_count: desiredAddWaitlistLeagueCount,
        basic_ice_fallback_interest: clearBasicIceFallbackInterest ? null : registration.basic_ice_fallback_interest,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, registrationId));
    await tx.delete(schema.registrationSelections).where(eq(schema.registrationSelections.registration_id, registrationId));
    if (prioritySelections.length > 0) {
      await tx.insert(schema.registrationSelections).values(
        prioritySelections.map((selection) => {
          const league = selection.leagueId ? context.leagues[selection.leagueId] : undefined;
          return {
            registration_id: registrationId,
            league_id: selection.leagueId ?? null,
            selection_type: selection.selectionType,
            rank: selection.rank ?? null,
            replaces_league_id: selection.replacesLeagueId ?? null,
            is_temporary_sabbatical_fill: selection.isTemporarySabbaticalFill ? 1 : 0,
            byot_teammate_text: selection.byotTeammateText ?? null,
            team_roster_placements:
              selection.teamRosterPlacements && selection.teamRosterPlacements.length > 0
                ? JSON.stringify(
                    selection.teamRosterPlacements.map((placement) => ({
                      memberId: placement.memberId,
                      entryType: placement.entryType,
                      replacesLeagueId: placement.replacesLeagueId ?? null,
                    })),
                  )
                : null,
            status: statusForSelection(selection.selectionType),
            fee_amount_minor_snapshot: league?.registrationFeeMinor ?? 0,
            discount_amount_minor_snapshot: 0,
            updated_at: sql`CURRENT_TIMESTAMP`,
          };
        })
      );
    }
  });

  if (registration.curler_member_id && isPriorityEditableRegistrationStatus(registration.status)) {
    await removeExistingWaitlistsMarkedForRemoval({
      curlerMemberId: registration.curler_member_id,
      actorMemberId: actor.id,
      selections: prioritySelections,
    });
    await removeOrphanedRegistrationWaitlistEntries({
      registrationId,
      curlerMemberId: registration.curler_member_id,
      actorMemberId: actor.id,
      selections: prioritySelections,
    });
    await removeOrphanedRegistrationRosterPlacements({
      registrationId,
      curlerMemberId: registration.curler_member_id,
      selections: prioritySelections,
    });
  }

  return buildRegistrationLeagueSelectionPayload(registrationId);
}

export async function updateBasicIceFallbackInterest(
  registrationId: number,
  actor: Member,
  input: BasicIceFallbackSaveInput,
) {
  const registration = await requireEditableRegistration(registrationId, actor);
  const context = await buildRegistrationContextForDraft(registrationId);
  if (!canCollectBasicIceFallback({
    icePrivilegesChoice: registration.ice_privileges_choice,
    membershipOption: registration.membership_option,
    selections: context.selections,
  })) {
    throw new RegistrationLeagueSelectionValidationError({
      basicIceFallback: 'Basic ice fallback only applies when the registrant has no guaranteed return leagues.',
    });
  }

  const { db, schema } = getDrizzleDb();
  await db
    .update(schema.curlingRegistrations)
    .set({
      basic_ice_fallback_interest: input.interested ? 1 : 0,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.curlingRegistrations.id, registrationId));

  return buildRegistrationLeagueSelectionPayload(registrationId);
}

export async function getRegistrationLeagueSelectionEvaluation(registrationId: number, actor: Member) {
  await requireEditableRegistration(registrationId, actor);
  const context = await buildRegistrationContextForDraft(registrationId);
  return evaluateRegistrationDraft(context);
}
