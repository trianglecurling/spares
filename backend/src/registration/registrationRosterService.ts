import { and, eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { RegistrationSelectionInput } from './registrationContext.js';

type DbExecutor = Pick<
  ReturnType<typeof getDrizzleDb>['db'],
  'select' | 'insert' | 'update' | 'delete'
>;

export const GUARANTEED_RETURN_ROSTER_SELECTION_TYPE = 'guaranteed_return' as const;

export const ROSTER_COMMIT_REGISTRATION_STATUSES = new Set([
  'confirmed',
  'paid',
  'awaiting_placement',
  'awaiting_staff_review',
  'submitted',
]);

export function registrationStatusCommitsRoster(status: string): boolean {
  return ROSTER_COMMIT_REGISTRATION_STATUSES.has(status);
}

function selectedGuaranteedReturnLeagueIds(selections: RegistrationSelectionInput[]): Set<number> {
  return new Set(
    selections
      .filter(
        (selection) =>
          selection.selectionType === GUARANTEED_RETURN_ROSTER_SELECTION_TYPE && selection.leagueId != null,
      )
      .map((selection) => selection.leagueId as number),
  );
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
  selections: RegistrationSelectionInput[];
  tx?: DbExecutor;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const keepLeagueIds = selectedGuaranteedReturnLeagueIds(input.selections);

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
  selections: RegistrationSelectionInput[];
  tx?: DbExecutor;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const leagueIds = [...selectedGuaranteedReturnLeagueIds(input.selections)];
  if (leagueIds.length === 0) return;

  for (const leagueId of leagueIds) {
    const [existing] = await executor
      .select()
      .from(schema.leagueRoster)
      .where(
        and(eq(schema.leagueRoster.league_id, leagueId), eq(schema.leagueRoster.member_id, input.curlerMemberId)),
      )
      .limit(1);

    const rosterValues = {
      source_registration_id: input.registrationId,
      status: 'active' as const,
      placement_type: GUARANTEED_RETURN_ROSTER_SELECTION_TYPE,
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
      league_id: leagueId,
      member_id: input.curlerMemberId,
      ...rosterValues,
    });
  }
}

export async function syncRegistrationRosterPlacements(input: {
  registrationId: number;
  curlerMemberId: number;
  selections: RegistrationSelectionInput[];
  registrationStatus: string;
  tx?: DbExecutor;
}): Promise<void> {
  await removeOrphanedRegistrationRosterPlacements(input);
  if (registrationStatusCommitsRoster(input.registrationStatus)) {
    await persistRegistrationRosterPlacements(input);
  }
}
