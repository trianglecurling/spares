import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { CurlingRegistrationStatusSqlite, LeagueRosterPlacementTypeSqlite } from '../db/drizzle-schema.js';
import { immediateChargeEntries, type PriorityLabelResult } from './leaguePriorityRules.js';
import type { LeagueConfig, RegistrationContext } from './registrationContext.js';

type DbExecutor = Pick<
  ReturnType<typeof getDrizzleDb>['db'],
  'select' | 'insert' | 'update' | 'delete'
>;

/**
 * A league spot committed at submit. Guaranteed returns/fallbacks and
 * available or temporary-fill entries come from the priority list. Junior
 * Recreational uses `new_placement` because that program never goes through
 * the priority list.
 */
export type GuaranteedPlacement = {
  leagueId: number;
  placementType: Extract<
    LeagueRosterPlacementTypeSqlite,
    'guaranteed_return' | 'guaranteed_fallback' | 'new_placement' | 'temporary_sabbatical_fill'
  >;
};

export const ROSTER_COMMIT_REGISTRATION_STATUS_LIST = [
  'confirmed',
  'paid',
  'awaiting_placement',
  'awaiting_staff_review',
  'submitted',
  // Assume unpaid registrants will pay; staff handles the rare non-payers later.
  'awaiting_payment',
  'payment_started',
] as const satisfies readonly CurlingRegistrationStatusSqlite[];

export const ROSTER_COMMIT_REGISTRATION_STATUSES = new Set<string>(ROSTER_COMMIT_REGISTRATION_STATUS_LIST);

export function registrationStatusCommitsRoster(status: string): boolean {
  return ROSTER_COMMIT_REGISTRATION_STATUSES.has(status);
}

const UNPAID_ROSTER_REGISTRATION_STATUSES = ['awaiting_payment', 'payment_started'] as const;

/**
 * Idempotent repair: re-place guaranteed leagues for unpaid registrations that
 * predate roster-on-awaiting-payment, and place Junior Recreational registrants
 * who paid but were never added to that program's roster.
 */
export async function ensureRosterPlacementsForUnpaidRegistrations(memberId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const { buildRegistrationContextForDraft } = await import('./registrationMembershipPaymentService.js');
  const { evaluateLeaguePriorities } = await import('./leaguePriorityEvaluation.js');

  const unpaid = await db
    .select({
      id: schema.curlingRegistrations.id,
      status: schema.curlingRegistrations.status,
    })
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.curler_member_id, memberId),
        inArray(schema.curlingRegistrations.status, [...UNPAID_ROSTER_REGISTRATION_STATUSES]),
      ),
    );

  for (const registration of unpaid) {
    const context = await buildRegistrationContextForDraft(registration.id);
    await syncRegistrationRosterPlacements({
      registrationId: registration.id,
      curlerMemberId: memberId,
      placements: rosterPlacementsForRegistration(context, evaluateLeaguePriorities(context)),
      registrationStatus: registration.status,
    });
  }

  await ensureJuniorRecreationalRosterForMember(memberId);
}

/**
 * Places paid/submitted Junior Recreational registrants onto the session league
 * that staff use as that program's roster.
 */
export async function ensureJuniorRecreationalRosterForMember(memberId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const { buildRegistrationContextForDraft } = await import('./registrationMembershipPaymentService.js');

  const registrations = await db
    .select({
      id: schema.curlingRegistrations.id,
      status: schema.curlingRegistrations.status,
    })
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.curler_member_id, memberId),
        eq(schema.curlingRegistrations.membership_option, 'junior_recreational'),
        inArray(schema.curlingRegistrations.status, [...ROSTER_COMMIT_REGISTRATION_STATUS_LIST]),
      ),
    );

  for (const registration of registrations) {
    const context = await buildRegistrationContextForDraft(registration.id);
    await persistRegistrationRosterPlacements({
      registrationId: registration.id,
      curlerMemberId: memberId,
      placements: juniorRecreationalPlacements(context),
    });
  }
}

/**
 * Places available and temporary-fill registrants onto this league when they
 * were charged at submit but never rostered. Waitlisted, play-in-miss, and
 * subject-to-availability entries are left off until staff place them.
 *
 * Do not call this from league roster GET handlers. It rebuilds a full
 * registration context (including play-in packing) for every unrostered
 * registrant who listed the league, which made league pages take many seconds.
 */
export async function ensureImmediateChargeRosterForLeague(leagueId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const { buildRegistrationContextForDraft } = await import('./registrationMembershipPaymentService.js');
  const { evaluateLeaguePriorities } = await import('./leaguePriorityEvaluation.js');
  const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).limit(1);
  if (!league?.session_id) return;

  const alreadyOnRoster = await db
    .select({ memberId: schema.leagueRoster.member_id })
    .from(schema.leagueRoster)
    .where(and(eq(schema.leagueRoster.league_id, leagueId), eq(schema.leagueRoster.status, 'active')));
  const alreadyOnRosterIds = new Set(alreadyOnRoster.map((row) => row.memberId));

  const registrations = await db
    .select({
      id: schema.curlingRegistrations.id,
      curlerMemberId: schema.curlingRegistrations.curler_member_id,
    })
    .from(schema.curlingRegistrations)
    .innerJoin(
      schema.registrationLeaguePriorities,
      eq(schema.registrationLeaguePriorities.registration_id, schema.curlingRegistrations.id),
    )
    .where(
      and(
        eq(schema.curlingRegistrations.session_id, league.session_id),
        eq(schema.registrationLeaguePriorities.league_id, leagueId),
        inArray(schema.curlingRegistrations.status, [...ROSTER_COMMIT_REGISTRATION_STATUS_LIST]),
      ),
    );

  for (const registration of registrations) {
    if (registration.curlerMemberId == null) continue;
    if (alreadyOnRosterIds.has(registration.curlerMemberId)) continue;
    const context = await buildRegistrationContextForDraft(registration.id);
    const placements = rosterPlacementsForRegistration(context, evaluateLeaguePriorities(context)).filter(
      (placement) => placement.leagueId === leagueId,
    );
    if (placements.length === 0) continue;
    await persistRegistrationRosterPlacements({
      registrationId: registration.id,
      curlerMemberId: registration.curlerMemberId,
      placements,
    });
    alreadyOnRosterIds.add(registration.curlerMemberId);
  }
}

export async function ensureLeagueRosterFromRegistrations(leagueId: number): Promise<void> {
  await ensureJuniorRecreationalRosterForLeague(leagueId);
  await ensureImmediateChargeRosterForLeague(leagueId);
}

export async function ensureJuniorRecreationalRosterForLeague(leagueId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).limit(1);
  const isJuniorRecreational = Number(league?.is_junior_recreational) === 1;
  if (!league?.session_id || !isJuniorRecreational) return;

  const registrations = await db
    .select({
      id: schema.curlingRegistrations.id,
      curlerMemberId: schema.curlingRegistrations.curler_member_id,
    })
    .from(schema.curlingRegistrations)
    .where(
      and(
        eq(schema.curlingRegistrations.session_id, league.session_id),
        eq(schema.curlingRegistrations.membership_option, 'junior_recreational'),
        inArray(schema.curlingRegistrations.status, [...ROSTER_COMMIT_REGISTRATION_STATUS_LIST]),
      ),
    );

  for (const registration of registrations) {
    if (registration.curlerMemberId == null) continue;
    await persistRegistrationRosterPlacements({
      registrationId: registration.id,
      curlerMemberId: registration.curlerMemberId,
      placements: [{ leagueId, placementType: 'new_placement' }],
    });
  }
}

export function guaranteedPlacementsFromEvaluation(evaluation: {
  entries: Array<{ leagueId: number; guaranteed: boolean; label: string }>;
}): GuaranteedPlacement[] {
  return evaluation.entries
    .filter((entry) => entry.guaranteed)
    .map((entry) => ({
      leagueId: entry.leagueId,
      placementType: entry.label === 'guaranteed_fallback' ? ('guaranteed_fallback' as const) : ('guaranteed_return' as const),
    }));
}

export function juniorRecreationalLeagueIdFromLeagues(
  leagues: Record<number, Pick<LeagueConfig, 'id' | 'isJuniorRecreational'>>,
): number | null {
  const matches = Object.values(leagues)
    .filter((league) => league.isJuniorRecreational === true)
    .sort((left, right) => left.id - right.id);
  return matches[0]?.id ?? null;
}

export function juniorRecreationalPlacements(
  context: Pick<RegistrationContext, 'membershipOption' | 'leagues'>,
): GuaranteedPlacement[] {
  if (context.membershipOption !== 'junior_recreational') return [];
  const leagueId = juniorRecreationalLeagueIdFromLeagues(context.leagues);
  if (leagueId == null) return [];
  return [{ leagueId, placementType: 'new_placement' }];
}

function availableNowPlacements(
  evaluation: Pick<PriorityLabelResult, 'entries' | 'desiredLeagueCount'>,
): GuaranteedPlacement[] {
  return immediateChargeEntries(evaluation)
    .filter((entry) => !entry.guaranteed)
    .map((entry) => ({
      leagueId: entry.leagueId,
      placementType:
        entry.label === 'temporary_spot_available'
          ? ('temporary_sabbatical_fill' as const)
          : ('new_placement' as const),
    }));
}

export function rosterPlacementsForRegistration(
  context: Pick<RegistrationContext, 'membershipOption' | 'leagues'>,
  evaluation: Pick<PriorityLabelResult, 'entries' | 'desiredLeagueCount'>,
): GuaranteedPlacement[] {
  return [
    ...guaranteedPlacementsFromEvaluation(evaluation),
    ...availableNowPlacements(evaluation),
    ...juniorRecreationalPlacements(context),
  ];
}

async function removeRegistrationRosterRows(
  executor: DbExecutor,
  rows: Array<{ id: number; league_id: number; member_id: number }>,
): Promise<void> {
  const { schema } = getDrizzleDb();
  if (rows.length === 0) return;

  for (const row of rows) {
    const assignments = await executor
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .innerJoin(schema.leagueTeams, eq(schema.teamMembers.team_id, schema.leagueTeams.id))
      .where(and(eq(schema.leagueTeams.league_id, row.league_id), eq(schema.teamMembers.member_id, row.member_id)))
      .limit(1);

    if (assignments.length > 0) {
      await executor
        .update(schema.leagueRoster)
        .set({ status: 'removed', updated_at: sql`CURRENT_TIMESTAMP` })
        .where(eq(schema.leagueRoster.id, row.id));
      continue;
    }

    await executor.delete(schema.leagueRoster).where(eq(schema.leagueRoster.id, row.id));
  }
}

export async function removeOrphanedRegistrationRosterPlacements(input: {
  registrationId: number;
  curlerMemberId: number;
  placements: GuaranteedPlacement[];
  /** League IDs that must not keep an active roster row from this registration. */
  excludeLeagueIds?: Iterable<number>;
  tx?: DbExecutor;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const excluded = new Set(input.excludeLeagueIds ?? []);
  const keepLeagueIds = new Set(
    input.placements.map((placement) => placement.leagueId).filter((leagueId) => !excluded.has(leagueId)),
  );

  const rosterRows = await executor
    .select()
    .from(schema.leagueRoster)
    .where(
      and(
        eq(schema.leagueRoster.member_id, input.curlerMemberId),
        eq(schema.leagueRoster.source_registration_id, input.registrationId),
        eq(schema.leagueRoster.status, 'active'),
      ),
    );

  const rowsToRemove = rosterRows.filter((row: (typeof rosterRows)[number]) => !keepLeagueIds.has(row.league_id));
  await removeRegistrationRosterRows(executor, rowsToRemove);
}

export async function removeAllRegistrationRosterPlacements(input: {
  registrationId: number;
  curlerMemberId: number;
  tx?: DbExecutor;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;

  const rosterRows = await executor
    .select()
    .from(schema.leagueRoster)
    .where(
      and(
        eq(schema.leagueRoster.member_id, input.curlerMemberId),
        eq(schema.leagueRoster.source_registration_id, input.registrationId),
        eq(schema.leagueRoster.status, 'active'),
      ),
    );

  await removeRegistrationRosterRows(executor, rosterRows);
}

export async function persistRegistrationRosterPlacements(input: {
  registrationId: number;
  curlerMemberId: number;
  placements: GuaranteedPlacement[];
  /** League IDs that must not receive a roster placement. */
  excludeLeagueIds?: Iterable<number>;
  tx?: DbExecutor;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const excluded = new Set(input.excludeLeagueIds ?? []);
  const placements = input.placements.filter((placement) => !excluded.has(placement.leagueId));
  if (placements.length === 0) return;

  for (const placement of placements) {
    const [existing] = await executor
      .select()
      .from(schema.leagueRoster)
      .where(
        and(
          eq(schema.leagueRoster.league_id, placement.leagueId),
          eq(schema.leagueRoster.member_id, input.curlerMemberId),
        ),
      )
      .limit(1);

    const rosterValues = {
      source_registration_id: input.registrationId,
      status: 'active' as const,
      placement_type: placement.placementType,
      is_temporary_sabbatical_fill: placement.placementType === 'temporary_sabbatical_fill' ? 1 : 0,
      related_sabbatical_id: null,
      updated_at: sql`CURRENT_TIMESTAMP`,
    };

    if (existing) {
      await executor
        .update(schema.leagueRoster)
        .set(rosterValues)
        .where(eq(schema.leagueRoster.id, existing.id));
      continue;
    }

    await executor.insert(schema.leagueRoster).values({
      league_id: placement.leagueId,
      member_id: input.curlerMemberId,
      ...rosterValues,
    });
  }
}

export async function syncRegistrationRosterPlacements(input: {
  registrationId: number;
  curlerMemberId: number;
  placements: GuaranteedPlacement[];
  registrationStatus: string;
  excludeLeagueIds?: Iterable<number>;
  tx?: DbExecutor;
}): Promise<void> {
  await removeOrphanedRegistrationRosterPlacements(input);
  if (registrationStatusCommitsRoster(input.registrationStatus)) {
    await persistRegistrationRosterPlacements(input);
  }
}
