import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { LeagueRosterPlacementTypeSqlite } from '../db/drizzle-schema.js';

type DbExecutor = Pick<
  ReturnType<typeof getDrizzleDb>['db'],
  'select' | 'insert' | 'update' | 'delete'
>;

/**
 * A league spot committed at submit because the registrant's priority list
 * guaranteed it. Carries the label so staff can tell a first-choice return from
 * a fallback the registrant would happily trade up from.
 */
export type GuaranteedPlacement = {
  leagueId: number;
  placementType: Extract<LeagueRosterPlacementTypeSqlite, 'guaranteed_return' | 'guaranteed_fallback'>;
};

export const ROSTER_COMMIT_REGISTRATION_STATUSES = new Set([
  'confirmed',
  'paid',
  'awaiting_placement',
  'awaiting_staff_review',
  'submitted',
  // Assume unpaid registrants will pay; staff handles the rare non-payers later.
  'awaiting_payment',
  'payment_started',
]);

export function registrationStatusCommitsRoster(status: string): boolean {
  return ROSTER_COMMIT_REGISTRATION_STATUSES.has(status);
}

const UNPAID_ROSTER_REGISTRATION_STATUSES = ['awaiting_payment', 'payment_started'] as const;

/**
 * Idempotent repair: re-place guaranteed leagues for unpaid registrations that
 * predate roster-on-awaiting-payment.
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
      placements: guaranteedPlacementsFromEvaluation(evaluateLeaguePriorities(context)),
      registrationStatus: registration.status,
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
      is_temporary_sabbatical_fill: 0,
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
