import { and, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { RegistrationSelectionInput } from './registrationContext.js';
import { recordAndDeleteWaitlistEntry } from './waitlistAudit.js';

type WaitlistCleanupExecutor = Pick<
  ReturnType<typeof getDrizzleDb>['db'],
  'select' | 'delete' | 'insert'
>;

function selectedWaitlistLeagueIds(selections: RegistrationSelectionInput[]): Set<number> {
  return new Set(
    selections
      .filter(
        (selection) =>
          selection.selectionType === 'waitlist_add' ||
          selection.selectionType === 'waitlist_replace' ||
          selection.selectionType === 'waitlist_add_auto_decline' ||
          selection.selectionType === 'waitlist_replace_auto_decline' ||
          selection.selectionType === 'waitlist_keep_auto_accept' ||
          selection.selectionType === 'waitlist_keep_auto_decline',
      )
      .map((selection) => selection.leagueId)
      .filter((leagueId): leagueId is number => leagueId != null)
  );
}

export async function removeExistingWaitlistsMarkedForRemoval(input: {
  curlerMemberId: number;
  actorMemberId: number;
  selections: RegistrationSelectionInput[];
  tx?: WaitlistCleanupExecutor;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const removeLeagueIds = new Set(
    input.selections
      .filter((selection) => selection.selectionType === 'waitlist_remove' && selection.leagueId != null)
      .map((selection) => selection.leagueId as number),
  );
  if (removeLeagueIds.size === 0) return;

  const entries = await executor
    .select()
    .from(schema.waitlistEntries)
    .where(and(eq(schema.waitlistEntries.member_id, input.curlerMemberId), eq(schema.waitlistEntries.status, 'active')));

  for (const entry of entries) {
    const [league] = await executor
      .select({ id: schema.leagues.id })
      .from(schema.leagues)
      .where(eq(schema.leagues.waitlist_id, entry.waitlist_id))
      .limit(1);
    if (!league || !removeLeagueIds.has(league.id)) continue;

    await recordAndDeleteWaitlistEntry(executor, {
      entry,
      leagueId: league.id,
      actorMemberId: input.actorMemberId,
      source: 'registration_submission',
      reason: 'WAITLIST_REMOVED_FROM_REGISTRATION',
      metadata: { reason: 'REGISTRATION_WAITLIST_REMOVE' },
    });
  }
}

export async function removeOrphanedRegistrationWaitlistEntries(input: {
  registrationId: number;
  curlerMemberId: number;
  actorMemberId: number;
  selections: RegistrationSelectionInput[];
  tx?: WaitlistCleanupExecutor;
}): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const executor = input.tx ?? db;
  const keepLeagueIds = selectedWaitlistLeagueIds(input.selections);

  const entries = await executor
    .select()
    .from(schema.waitlistEntries)
    .where(
      and(
        eq(schema.waitlistEntries.member_id, input.curlerMemberId),
        eq(schema.waitlistEntries.source_registration_id, input.registrationId),
        eq(schema.waitlistEntries.status, 'active')
      )
    );

  for (const entry of entries) {
    const [league] = await executor
      .select({ id: schema.leagues.id, name: schema.leagues.name })
      .from(schema.leagues)
      .where(eq(schema.leagues.waitlist_id, entry.waitlist_id))
      .limit(1);
    if (!league || keepLeagueIds.has(league.id)) continue;

    await recordAndDeleteWaitlistEntry(executor, {
      entry,
      leagueId: league.id,
      actorMemberId: input.actorMemberId,
      source: 'registration_submission',
      reason: 'WAITLIST_REMOVED_FROM_REGISTRATION_EDIT',
      metadata: { sourceRegistrationId: input.registrationId, reason: 'REGISTRATION_EDIT' },
    });
  }
}
