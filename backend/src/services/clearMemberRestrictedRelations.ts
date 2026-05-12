import { inArray, or } from 'drizzle-orm';
import type { getDrizzleDb } from '../db/drizzle-db.js';

type Schema = ReturnType<typeof getDrizzleDb>['schema'];

/** Transaction-scoped DB with the operations this helper needs */
type ClearingDb = Pick<ReturnType<typeof getDrizzleDb>['db'], 'delete' | 'update'>;

/**
 * Removes or clears rows that FK to member ids with ON DELETE RESTRICT, so member delete can succeed.
 * Must run inside the same transaction as `DELETE FROM members`.
 */
export async function clearMemberRestrictedRelations(
  tx: ClearingDb,
  schema: Schema,
  memberIds: number[]
): Promise<void> {
  if (memberIds.length === 0) return;

  await tx
    .delete(schema.registrationPolicyAcceptances)
    .where(
      or(
        inArray(schema.registrationPolicyAcceptances.accepted_by_member_id, memberIds),
        inArray(schema.registrationPolicyAcceptances.accepted_for_member_id, memberIds)
      )
    );

  await tx
    .delete(schema.financialAssistanceRequests)
    .where(inArray(schema.financialAssistanceRequests.member_id, memberIds));

  await tx
    .delete(schema.registrationInvoices)
    .where(inArray(schema.registrationInvoices.payer_member_id, memberIds));

  await tx
    .delete(schema.waitlistOffers)
    .where(inArray(schema.waitlistOffers.member_id, memberIds));

  await tx
    .delete(schema.seasonMemberships)
    .where(inArray(schema.seasonMemberships.member_id, memberIds));

  await tx
    .delete(schema.curlingIcePrivileges)
    .where(inArray(schema.curlingIcePrivileges.member_id, memberIds));

  await tx
    .delete(schema.curlingLeagueSabbaticals)
    .where(inArray(schema.curlingLeagueSabbaticals.member_id, memberIds));

  await tx
    .update(schema.curlingRegistrations)
    .set({ submitted_by_member_id: null })
    .where(inArray(schema.curlingRegistrations.submitted_by_member_id, memberIds));

  await tx
    .update(schema.curlingRegistrations)
    .set({ curler_member_id: null })
    .where(inArray(schema.curlingRegistrations.curler_member_id, memberIds));
}
