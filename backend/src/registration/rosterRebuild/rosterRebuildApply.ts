import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDatabaseConfig } from '../../db/config.js';
import { getDrizzleDb } from '../../db/drizzle-db.js';
import { insertWaitlistAuditEvent } from '../waitlistAudit.js';
import type { RosterRebuildPlacement, RosterRebuildSabbaticalMutation, WaitlistMutation } from './rosterRebuildTypes.js';

type ApplyExecutor = Pick<ReturnType<typeof getDrizzleDb>['db'], 'select' | 'insert' | 'update' | 'delete'>;

function remapSabbaticalId(value: number | null, idMap: Map<number, number>): number | null {
  if (value == null) return null;
  return idMap.get(value) ?? value;
}

function sabbaticalDateValue(value: string | Date | null | undefined): Date | string {
  const raw =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : typeof value === 'string' && value.trim()
        ? value.trim().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
  if (getDatabaseConfig()?.type === 'postgres') return new Date(`${raw}T00:00:00`);
  return raw;
}

export async function applySabbaticalMutations(
  mutations: RosterRebuildSabbaticalMutation[],
  tx?: ApplyExecutor,
): Promise<{ inserted: number; idMap: Map<number, number> }> {
  const { db, schema } = getDrizzleDb();
  const executor = tx ?? db;
  const idMap = new Map<number, number>();
  if (mutations.length === 0) return { inserted: 0, idMap };

  const leagueIds = [...new Set(mutations.map((row) => row.leagueId))];
  const leagues =
    leagueIds.length === 0
      ? []
      : await executor
          .select({
            id: schema.leagues.id,
            firstDayOfPlay: schema.leagues.first_day_of_play,
            lastDayOfPlay: schema.leagues.last_day_of_play,
          })
          .from(schema.leagues)
          .where(inArray(schema.leagues.id, leagueIds));
  const leagueById = new Map(leagues.map((row) => [row.id, row]));

  let inserted = 0;
  for (const mutation of mutations) {
    const league = leagueById.get(mutation.leagueId);
    const startDate = sabbaticalDateValue(league?.firstDayOfPlay);
    const endDate = sabbaticalDateValue(league?.lastDayOfPlay ?? league?.firstDayOfPlay);
    const [row] = await executor
      .insert(schema.curlingLeagueSabbaticals)
      .values({
        member_id: mutation.memberId,
        lineage_key: `${mutation.memberId}:${mutation.leagueId}`,
        original_league_id: mutation.leagueId,
        current_league_id: mutation.leagueId,
        source_registration_id: mutation.sourceRegistrationId,
        first_sabbatical_league_id: mutation.leagueId,
        first_sabbatical_start_date: startDate as never,
        status: 'active',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .returning({ id: schema.curlingLeagueSabbaticals.id });
    const sabbaticalId = row?.id;
    if (sabbaticalId == null) continue;
    idMap.set(mutation.syntheticId, sabbaticalId);
    await executor.insert(schema.curlingSabbaticalSessions).values({
      sabbatical_id: sabbaticalId,
      league_id: mutation.leagueId,
      registration_id: mutation.sourceRegistrationId,
      fee_amount_minor: 0,
      payment_status: 'unpaid',
      starts_at: startDate as never,
      ends_at: endDate as never,
      updated_at: sql`CURRENT_TIMESTAMP`,
    });
    if (mutation.sourceRegistrationId != null) {
      const [existingSelection] = await executor
        .select({ id: schema.registrationSelections.id })
        .from(schema.registrationSelections)
        .where(
          and(
            eq(schema.registrationSelections.registration_id, mutation.sourceRegistrationId),
            eq(schema.registrationSelections.league_id, mutation.leagueId),
            eq(schema.registrationSelections.selection_type, 'sabbatical'),
          ),
        )
        .limit(1);
      if (existingSelection) {
        await executor
          .update(schema.registrationSelections)
          .set({
            related_sabbatical_id: sabbaticalId,
            status: 'confirmed',
            is_temporary_sabbatical_fill: 0,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(schema.registrationSelections.id, existingSelection.id));
      } else {
        await executor.insert(schema.registrationSelections).values({
          registration_id: mutation.sourceRegistrationId,
          league_id: mutation.leagueId,
          selection_type: 'sabbatical',
          status: 'confirmed',
          related_sabbatical_id: sabbaticalId,
          is_temporary_sabbatical_fill: 0,
          updated_at: sql`CURRENT_TIMESTAMP`,
        });
      }
    }
    inserted += 1;
  }
  return { inserted, idMap };
}

export async function applyRosterRebuildPlacements(
  placements: RosterRebuildPlacement[],
  tx?: ApplyExecutor,
  sabbaticalIdMap: Map<number, number> = new Map(),
): Promise<{ inserted: number; skipped: number }> {
  const { db, schema } = getDrizzleDb();
  const executor = tx ?? db;
  let inserted = 0;
  let skipped = 0;
  for (const placement of placements) {
    const [existing] = await executor
      .select({ id: schema.leagueRoster.id })
      .from(schema.leagueRoster)
      .where(
        and(eq(schema.leagueRoster.league_id, placement.leagueId), eq(schema.leagueRoster.member_id, placement.memberId)),
      )
      .limit(1);
    if (existing) {
      skipped += 1;
      continue;
    }
    await executor.insert(schema.leagueRoster).values({
      league_id: placement.leagueId,
      member_id: placement.memberId,
      source_registration_id: placement.sourceRegistrationId,
      status: 'active',
      placement_type: placement.placementType,
      is_temporary_sabbatical_fill: placement.isTemporarySabbaticalFill ? 1 : 0,
      related_sabbatical_id: remapSabbaticalId(placement.relatedSabbaticalId, sabbaticalIdMap),
      updated_at: sql`CURRENT_TIMESTAMP`,
    });
    inserted += 1;
  }
  return { inserted, skipped };
}

export async function applyWaitlistMutations(
  mutations: WaitlistMutation[],
  tx?: ApplyExecutor,
): Promise<{ placed: number; declined: number; temporaryFills: number }> {
  const { db, schema } = getDrizzleDb();
  const executor = tx ?? db;
  let placed = 0;
  let declined = 0;
  let temporaryFills = 0;
  for (const mutation of mutations) {
    const [entry] = await executor
      .select()
      .from(schema.waitlistEntries)
      .where(eq(schema.waitlistEntries.id, mutation.entryId))
      .limit(1);
    if (!entry) continue;

    if (mutation.kind === 'temporary_fill') {
      await insertWaitlistAuditEvent(executor, {
        waitlistEntryId: mutation.entryId,
        leagueId: mutation.leagueId,
        memberId: mutation.memberId,
        source: 'placement_process',
        action: 'entry_placed',
        reason: 'Roster rebuild filled a temporary sabbatical vacancy; waitlist entry stays active for a permanent seat.',
        before: { status: entry.status, decline_count: entry.decline_count },
        after: { status: entry.status, decline_count: entry.decline_count },
        metadata: { temporarySabbaticalFill: true, waitlistStatusUnchanged: true },
      });
      temporaryFills += 1;
      continue;
    }

    if (mutation.kind === 'placed') {
      await executor
        .update(schema.waitlistEntries)
        .set({ status: 'placed', updated_at: sql`CURRENT_TIMESTAMP` })
        .where(eq(schema.waitlistEntries.id, mutation.entryId));
      await insertWaitlistAuditEvent(executor, {
        waitlistEntryId: mutation.entryId,
        leagueId: mutation.leagueId,
        memberId: mutation.memberId,
        source: 'placement_process',
        action: 'entry_placed',
        reason: 'Roster rebuild waitlist stage placed this entry.',
        before: { status: entry.status, decline_count: entry.decline_count },
        after: { status: 'placed', decline_count: entry.decline_count },
      });
      placed += 1;
      continue;
    }

    if (mutation.immune || mutation.declineCountAfter === mutation.declineCountBefore) {
      await insertWaitlistAuditEvent(executor, {
        waitlistEntryId: mutation.entryId,
        leagueId: mutation.leagueId,
        memberId: mutation.memberId,
        source: 'placement_process',
        action: 'entry_preference_skipped',
        reason: 'Roster rebuild declined this entry with decline immunity (count unchanged).',
        before: { decline_count: entry.decline_count },
        after: { decline_count: entry.decline_count },
        metadata: { immune: true },
      });
      declined += 1;
      continue;
    }

    await executor
      .update(schema.waitlistEntries)
      .set({ decline_count: mutation.declineCountAfter, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.waitlistEntries.id, mutation.entryId));
    await insertWaitlistAuditEvent(executor, {
      waitlistEntryId: mutation.entryId,
      leagueId: mutation.leagueId,
      memberId: mutation.memberId,
      source: 'placement_process',
      action: 'decline_count_changed',
      reason: 'Roster rebuild waitlist stage declined this entry.',
      before: { decline_count: entry.decline_count },
      after: { decline_count: mutation.declineCountAfter },
    });
    declined += 1;
  }
  return { placed, declined, temporaryFills };
}

export async function clearSessionRosters(input: {
  leagueIds: number[];
  tx?: ApplyExecutor;
}): Promise<{ deleted: number }> {
  if (input.leagueIds.length === 0) return { deleted: 0 };
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const existing = await executor
    .select({ id: schema.leagueRoster.id })
    .from(schema.leagueRoster)
    .where(inArray(schema.leagueRoster.league_id, input.leagueIds));
  if (existing.length === 0) return { deleted: 0 };
  await executor.delete(schema.leagueRoster).where(inArray(schema.leagueRoster.league_id, input.leagueIds));
  return { deleted: existing.length };
}
