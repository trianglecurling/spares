import { asc, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { MAX_DESIRED_LEAGUE_COUNT } from '../db/drizzle-schema.js';
import { normalizeDrawTimeString } from '../utils/leagueSchedule.js';
import type { Member } from '../types.js';
import { evaluateRegistrationDraft } from './evaluateRegistrationDraft.js';
import {
  clampPriorityOrder,
  evaluateLeaguePriorities,
  hasReturnRight,
  shouldCollectBasicIceFallback,
  validateLeaguePriorities,
} from './leaguePriorityEvaluation.js';
import { buildGuestRegistrationContext, buildRegistrationContextForDraft } from './registrationMembershipPaymentService.js';
import {
  assertRegistrationEditableForLeagueOrMembership,
  isPriorityEditableRegistrationStatus,
  RegistrationPriorityEditValidationError,
} from './registrationPriorityEdit.js';
import { getRegistrationById } from './registrationShellService.js';
import { rosterPlacementsForRegistration, removeOrphanedRegistrationRosterPlacements } from './registrationRosterService.js';
import {
  applyRegistrationWaitlistOfferPreferences,
  removeOrphanedRegistrationWaitlistEntries,
} from './registrationWaitlistCleanup.js';
import type {
  LeagueConfig,
  LeaguePriorityInput,
  RegistrationContext,
  RegistrationSelectionInput,
} from './registrationContext.js';
import { isPriorityKeepOrLeaveLeague, listContinuingSabbaticalSummaries } from './registrationSabbaticalContinuity.js';
import { omitLeaveBehindSelectionsForListedLeagues } from './leaguePriorityRules.js';
import { evaluateRegistrantPlayInEntry, type RegistrantPlayInEntrySummary } from './leagueEntryService.js';

export class RegistrationLeagueSelectionValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('Registration league selection validation failed');
  }
}

/** What to do with a league the registrant played last session but left off their list. */
export type PriorLeagueDecisionInput = {
  leagueId: number;
  decision: 'sabbatical' | 'drop';
  isTemporarySabbaticalFill?: boolean;
};

export type LeaguePrioritySaveInput = {
  desiredLeagueCount: number | null;
  priorities: LeaguePriorityInput[];
  priorLeagueDecisions?: PriorLeagueDecisionInput[];
  basicIceFallbackInterest?: boolean | null;
};

function basicIceFallbackInterestFromRow(value: number | null | undefined): boolean | null {
  if (value === 0) return false;
  if (value === 1) return true;
  return null;
}

function normalizeDesiredLeagueCount(value: number | null | undefined): number | null {
  if (value == null) return null;
  const count = Math.trunc(Number(value));
  if (!Number.isFinite(count)) return null;
  if (count < 1 || count > MAX_DESIRED_LEAGUE_COUNT) {
    throw new RegistrationLeagueSelectionValidationError({
      desiredLeagueCount: `Choose between 1 and ${MAX_DESIRED_LEAGUE_COUNT} leagues.`,
    });
  }
  return count;
}

/**
 * Renumbers ranks contiguously from 1 and re-applies the bring-your-own-team
 * clamp, so a client that reordered optimistically cannot persist an order the
 * evaluation engine would reject.
 */
function normalizePriorities(
  priorities: LeaguePriorityInput[],
  leagues: Record<number, LeagueConfig>,
): LeaguePriorityInput[] {
  const seen = new Set<number>();
  const deduped: LeaguePriorityInput[] = [];
  for (const priority of [...priorities].sort((a, b) => a.priorityRank - b.priorityRank)) {
    const leagueId = Number(priority.leagueId);
    if (!Number.isFinite(leagueId) || seen.has(leagueId)) continue;
    seen.add(leagueId);
    const memberIds = new Set<number>();
    for (const placement of priority.teamRosterPlacements ?? []) {
      const memberId = Number(placement.memberId);
      if (Number.isFinite(memberId)) memberIds.add(memberId);
    }
    deduped.push({
      leagueId,
      priorityRank: deduped.length + 1,
      byotTeammateText: priority.byotTeammateText?.trim() || null,
      teamRosterPlacements: memberIds.size > 0 ? [...memberIds].map((memberId) => ({ memberId })) : null,
    });
  }
  return clampPriorityOrder(deduped, leagues);
}

function selectionsFromPriorLeagueDecisions(decisions: PriorLeagueDecisionInput[]): RegistrationSelectionInput[] {
  const seen = new Set<number>();
  const selections: RegistrationSelectionInput[] = [];
  for (const decision of decisions) {
    const leagueId = Number(decision.leagueId);
    if (!Number.isFinite(leagueId) || seen.has(leagueId)) continue;
    if (decision.decision !== 'sabbatical' && decision.decision !== 'drop') {
      throw new RegistrationLeagueSelectionValidationError({
        priorLeagueDecisions: 'Each prior league must be marked as sabbatical or drop.',
      });
    }
    seen.add(leagueId);
    selections.push({
      selectionType: decision.decision,
      leagueId,
      isTemporarySabbaticalFill: decision.isTemporarySabbaticalFill === true,
    });
  }
  return selections;
}

function normalizeDrawTimeForSort(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const hours = String(value.getUTCHours()).padStart(2, '0');
    const minutes = String(value.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  if (typeof value === 'string') return normalizeDrawTimeString(value);
  return normalizeDrawTimeString(String(value));
}

async function loadDrawTimesByLeagueId(leagueIds: number[]): Promise<Map<number, string[]>> {
  const byLeagueId = new Map<number, string[]>();
  if (leagueIds.length === 0) return byLeagueId;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      leagueId: schema.leagueDrawTimes.league_id,
      drawTime: schema.leagueDrawTimes.draw_time,
    })
    .from(schema.leagueDrawTimes)
    .where(inArray(schema.leagueDrawTimes.league_id, leagueIds))
    .orderBy(asc(schema.leagueDrawTimes.league_id), asc(schema.leagueDrawTimes.draw_time));
  for (const row of rows) {
    const time = normalizeDrawTimeForSort(row.drawTime);
    if (!time) continue;
    const list = byLeagueId.get(row.leagueId) ?? [];
    list.push(time);
    byLeagueId.set(row.leagueId, list);
  }
  return byLeagueId;
}

/** Match /leagues ordering: day of week, then earliest draw time, then name. */
async function sortLeaguesByDayThenFirstDraw(leagues: LeagueConfig[]): Promise<LeagueConfig[]> {
  if (leagues.length === 0) return leagues;

  const drawTimesByLeagueId = await loadDrawTimesByLeagueId(leagues.map((league) => league.id));
  const withTimes = leagues.map((league) => ({
    ...league,
    drawTimes: drawTimesByLeagueId.get(league.id) ?? [],
  }));

  return [...withTimes].sort((a, b) => {
    const dowDiff = (a.dayOfWeek ?? Number.MAX_SAFE_INTEGER) - (b.dayOfWeek ?? Number.MAX_SAFE_INTEGER);
    if (dowDiff !== 0) return dowDiff;

    const ta = a.drawTimes?.[0] ?? '';
    const tb = b.drawTimes?.[0] ?? '';
    const hasA = ta !== '';
    const hasB = tb !== '';
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

function validationDetails(context: RegistrationContext): Record<string, string> {
  const validation = validateLeaguePriorities(context);
  const details: Record<string, string> = {};
  for (const [index, error] of validation.blockingErrors.entries()) {
    details[`priority.${index}.${error.code}`] = error.message;
  }
  return details;
}

async function leaguesWithActiveWaitlistEntryCounts(
  leagues: LeagueConfig[],
  options?: { excludeRegistrationId?: number | null },
): Promise<LeagueConfig[]> {
  const { attachLiveLeagueAvailability } = await import('./leagueAvailability.js');
  return attachLiveLeagueAvailability(leagues, options);
}

/**
 * Live play-in entry summaries for every play-in based league in the catalog:
 * whether the registrant is already on a declared entry team and the guarantee
 * evaluation for their declared/drafted roster.
 */
async function buildPlayInEntrySummaries(context: RegistrationContext): Promise<Record<number, RegistrantPlayInEntrySummary>> {
  const summaries: Record<number, RegistrantPlayInEntrySummary> = {};
  const playInLeagues = Object.values(context.leagues).filter((league) => league.isPlayInBased);
  for (const league of playInLeagues) {
    const priority = context.priorities.find((item) => item.leagueId === league.id);
    try {
      summaries[league.id] = await evaluateRegistrantPlayInEntry({
        leagueId: league.id,
        memberId: context.registrant.memberId ?? null,
        teamRosterPlacements: priority?.teamRosterPlacements ?? null,
        pendingTeammateText: priority?.byotTeammateText ?? null,
      });
    } catch {
      // A league that can't be evaluated simply omits its summary; the
      // priority page falls back to treating it as not guaranteed.
    }
  }
  return summaries;
}

/**
 * Leagues the registrant played last session that need a keep-or-leave answer,
 * with the prior league id so the client can seed the list.
 */
function priorSeasonLeagueIds(context: RegistrationContext): number[] {
  return Object.values(context.leagues)
    .filter((league) => isPriorityKeepOrLeaveLeague(league, context.participatedLeagueIds))
    .map((league) => league.id);
}

function standardReturnRightLeagueIds(context: RegistrationContext): number[] {
  return Object.values(context.leagues)
    .filter((league) => !league.isPlayInBased)
    .filter((league) => hasReturnRight(context, { leagueId: league.id, priorityRank: 1 }))
    .map((league) => league.id);
}

async function catalogPayloadFromContext(
  context: RegistrationContext,
  extras: {
    desiredLeagueCount: number | null;
    basicIceFallbackInterest: boolean | null;
    registrationId?: number | null;
  },
) {
  const leagues = await leaguesWithActiveWaitlistEntryCounts(
    await sortLeaguesByDayThenFirstDraw(Object.values(context.leagues)),
    { excludeRegistrationId: extras.registrationId },
  );
  const { buildByotDeclaredTeamSummaries } = await import('./byotDeclaredTeamService.js');
  return {
    leagues,
    registrationState: context.registrationState,
    priorities: context.priorities,
    desiredLeagueCount: extras.desiredLeagueCount,
    maxDesiredLeagueCount: MAX_DESIRED_LEAGUE_COUNT,
    priorSeasonLeagueIds: priorSeasonLeagueIds(context),
    priorLeagueDecisions: omitLeaveBehindSelectionsForListedLeagues(context.selections, context.priorities)
      .filter((selection) => selection.selectionType === 'sabbatical' || selection.selectionType === 'drop')
      .map((selection) => ({
        leagueId: selection.leagueId ?? null,
        decision: selection.selectionType,
        isTemporarySabbaticalFill: selection.isTemporarySabbaticalFill === true,
      })),
    activeLeagueIds: context.activeLeagueIds,
    participatedLeagueIds: context.participatedLeagueIds,
    // Standard leagues the registrant may claim a guaranteed return in. Play-in
    // leagues are excluded because their return right depends on the declared
    // roster, which the page re-checks live through the play-in preview.
    returnRightLeagueIds: standardReturnRightLeagueIds(context),
    // Members who hold a return right for each BYOT league. The page uses this
    // to decide live whether a declared team earns a guaranteed return.
    returnEligibleMemberIdsByLeagueId: context.returnEligibleMemberIdsByLeagueId ?? {},
    continuingSabbaticals: listContinuingSabbaticalSummaries(context),
    sabbaticalFeeMinor: context.priceConfig.sabbaticalFeeMinor,
    existingWaitlistEntries: context.existingWaitlistEntries,
    basicIceFallbackInterest: extras.basicIceFallbackInterest,
    collectBasicIceFallback: shouldCollectBasicIceFallback(context),
    playInEntry: await buildPlayInEntrySummaries(context),
    byotEntry: await buildByotDeclaredTeamSummaries({
      memberId: context.registrant.memberId ?? null,
      registrationId: extras.registrationId ?? null,
      leagues: context.leagues,
    }),
    evaluation: evaluateRegistrationDraft(context),
  };
}

async function buildLeagueCatalogPayload(registrationId: number) {
  const { db, schema } = getDrizzleDb();
  const [registration] = await db
    .select({
      basic_ice_fallback_interest: schema.curlingRegistrations.basic_ice_fallback_interest,
      desired_league_count: schema.curlingRegistrations.desired_league_count,
    })
    .from(schema.curlingRegistrations)
    .where(eq(schema.curlingRegistrations.id, registrationId))
    .limit(1);
  const context = await buildRegistrationContextForDraft(registrationId);
  return catalogPayloadFromContext(context, {
    desiredLeagueCount: registration?.desired_league_count ?? null,
    basicIceFallbackInterest: basicIceFallbackInterestFromRow(registration?.basic_ice_fallback_interest),
    registrationId,
  });
}

export async function getRegistrationLeagueCatalog(registrationId: number, actor: Member) {
  await requireEditableRegistration(registrationId, actor);
  return buildLeagueCatalogPayload(registrationId);
}

export async function getGuestLeagueCatalog(
  input: Parameters<typeof buildGuestRegistrationContext>[0] & {
    desiredLeagueCount?: number | null;
    priorities?: LeaguePriorityInput[];
  },
) {
  const base = await buildGuestRegistrationContext(input, { includeSessionLeagues: true });
  const skipLeaguePlay =
    input.membershipChoice === 'social' || input.membershipChoice === 'junior_recreational';
  const desiredLeagueCount = skipLeaguePlay ? null : input.desiredLeagueCount ?? null;
  const context: RegistrationContext = {
    ...base,
    desiredLeagueCount,
    priorities: skipLeaguePlay ? [] : input.priorities ?? [],
  };
  return catalogPayloadFromContext(context, {
    desiredLeagueCount,
    basicIceFallbackInterest: null,
  });
}

export async function putRegistrationLeaguePriorities(
  registrationId: number,
  actor: Member,
  input: LeaguePrioritySaveInput,
) {
  const registration = await requireEditableRegistration(registrationId, actor);
  const currentContext = await buildRegistrationContextForDraft(registrationId);

  const desiredLeagueCount = normalizeDesiredLeagueCount(input.desiredLeagueCount);
  const { applyExistingByotTeamRosterIfEmpty, buildByotDeclaredTeamSummaries } = await import(
    './byotDeclaredTeamService.js'
  );
  const byotSummaries = await buildByotDeclaredTeamSummaries({
    memberId: currentContext.registrant.memberId ?? null,
    registrationId,
    leagues: currentContext.leagues,
  });
  const priorities = applyExistingByotTeamRosterIfEmpty(
    normalizePriorities(input.priorities ?? [], currentContext.leagues),
    byotSummaries,
    currentContext.registrant.memberId ?? null,
  );
  const programSelections = currentContext.selections.filter(
    (selection) => selection.selectionType === 'junior_recreational' || selection.selectionType === 'spare_only',
  );
  const selections = omitLeaveBehindSelectionsForListedLeagues(
    [...programSelections, ...selectionsFromPriorLeagueDecisions(input.priorLeagueDecisions ?? [])],
    priorities,
  );

  const context: RegistrationContext = {
    ...currentContext,
    desiredLeagueCount,
    priorities,
    selections,
  };

  if (registration.ice_privileges_choice === 'basic_ice') {
    const hasPaidLeague = priorities.some(
      (priority) => (context.leagues[priority.leagueId]?.registrationFeeMinor ?? 0) > 0,
    );
    if (hasPaidLeague) {
      throw new RegistrationLeagueSelectionValidationError({
        icePrivileges: 'Basic ice privileges only include daytime leagues. Choose league play to register for other leagues.',
      });
    }
  }

  const details = validationDetails(context);
  if (Object.keys(details).length > 0) {
    throw new RegistrationLeagueSelectionValidationError(details);
  }

  const evaluation = evaluateLeaguePriorities(context);
  const collectBasicIceFallback = shouldCollectBasicIceFallback(context);
  const basicIceFallbackInterest = !collectBasicIceFallback
    ? null
    : input.basicIceFallbackInterest == null
      ? registration.basic_ice_fallback_interest
      : input.basicIceFallbackInterest
        ? 1
        : 0;

  const { db, schema } = getDrizzleDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.curlingRegistrations)
      .set({
        desired_league_count: desiredLeagueCount,
        basic_ice_fallback_interest: basicIceFallbackInterest,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, registrationId));

    await tx
      .delete(schema.registrationLeaguePriorities)
      .where(eq(schema.registrationLeaguePriorities.registration_id, registrationId));
    if (priorities.length > 0) {
      await tx.insert(schema.registrationLeaguePriorities).values(
        priorities.map((priority) => ({
          registration_id: registrationId,
          league_id: priority.leagueId,
          priority_rank: priority.priorityRank,
          byot_teammate_text: priority.byotTeammateText ?? null,
          team_roster_placements:
            priority.teamRosterPlacements && priority.teamRosterPlacements.length > 0
              ? JSON.stringify(priority.teamRosterPlacements.map((placement) => ({ memberId: placement.memberId })))
              : null,
          fee_amount_minor_snapshot: context.leagues[priority.leagueId]?.registrationFeeMinor ?? 0,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })),
      );
    }

    await tx.delete(schema.registrationSelections).where(eq(schema.registrationSelections.registration_id, registrationId));
    if (selections.length > 0) {
      await tx.insert(schema.registrationSelections).values(
        selections.map((selection) => ({
          registration_id: registrationId,
          league_id: selection.leagueId ?? null,
          selection_type: selection.selectionType,
          is_temporary_sabbatical_fill: selection.isTemporarySabbaticalFill ? 1 : 0,
          status: selection.selectionType === 'drop' ? ('dropped' as const) : ('pending' as const),
          fee_amount_minor_snapshot:
            selection.selectionType === 'sabbatical' ? context.priceConfig.sabbaticalFeeMinor : 0,
          discount_amount_minor_snapshot: 0,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })),
      );
    }
  });

  if (registration.curler_member_id && isPriorityEditableRegistrationStatus(registration.status)) {
    const waitlistedLeagueIds = evaluation.entries
      .filter((entry) => entry.label === 'waitlisted')
      .map((entry) => entry.leagueId);
    await applyRegistrationWaitlistOfferPreferences({
      curlerMemberId: registration.curler_member_id,
      actorMemberId: actor.id,
      sessionId: registration.session_id,
      priorityLeagueIds: priorities.map((priority) => priority.leagueId),
    });
    await removeOrphanedRegistrationWaitlistEntries({
      registrationId,
      curlerMemberId: registration.curler_member_id,
      actorMemberId: actor.id,
      waitlistedLeagueIds,
      priorityLeagueIds: priorities.map((priority) => priority.leagueId),
    });
    await removeOrphanedRegistrationRosterPlacements({
      registrationId,
      curlerMemberId: registration.curler_member_id,
      placements: rosterPlacementsForRegistration(currentContext, evaluation),
    });
  }

  return buildLeagueCatalogPayload(registrationId);
}

export async function getRegistrationLeagueSelectionEvaluation(registrationId: number, actor: Member) {
  await requireEditableRegistration(registrationId, actor);
  const context = await buildRegistrationContextForDraft(registrationId);
  return evaluateRegistrationDraft(context);
}
