import { desc, eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import {
  booleanFromSqliteFlag,
  sqliteFlagFromBoolean,
} from './parentAssociationMemberships.js';

export async function saveMemberParentAssociationOptIns(
  memberId: number,
  input: {
    usaCurlingMembershipOptIn?: boolean;
    uswcaMembershipOptIn?: boolean;
    usaCurlingMembershipNumber?: string | null;
    syncLatestRegistration?: boolean;
  },
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const updateData: {
    usa_curling_membership_opt_in?: number | null;
    uswca_membership_opt_in?: number | null;
    usa_curling_membership_number?: string | null;
    updated_at: ReturnType<typeof sql>;
  } = {
    updated_at: sql`CURRENT_TIMESTAMP`,
  };

  if (input.usaCurlingMembershipOptIn !== undefined) {
    updateData.usa_curling_membership_opt_in = sqliteFlagFromBoolean(input.usaCurlingMembershipOptIn);
  }
  if (input.uswcaMembershipOptIn !== undefined) {
    updateData.uswca_membership_opt_in = sqliteFlagFromBoolean(input.uswcaMembershipOptIn);
  }
  if (input.usaCurlingMembershipNumber !== undefined) {
    const trimmed = input.usaCurlingMembershipNumber?.trim() || '';
    updateData.usa_curling_membership_number = trimmed || null;
  }

  await db.update(schema.members).set(updateData).where(eq(schema.members.id, memberId));

  if (
    input.syncLatestRegistration !== false &&
    (input.usaCurlingMembershipOptIn !== undefined || input.uswcaMembershipOptIn !== undefined)
  ) {
    const [latest] = await db
      .select({
        id: schema.curlingRegistrations.id,
        usa_curling_membership_opt_in: schema.curlingRegistrations.usa_curling_membership_opt_in,
        uswca_membership_opt_in: schema.curlingRegistrations.uswca_membership_opt_in,
      })
      .from(schema.curlingRegistrations)
      .where(eq(schema.curlingRegistrations.curler_member_id, memberId))
      .orderBy(desc(schema.curlingRegistrations.updated_at), desc(schema.curlingRegistrations.id))
      .limit(1);
    if (!latest) return;

    await db
      .update(schema.curlingRegistrations)
      .set({
        usa_curling_membership_opt_in:
          input.usaCurlingMembershipOptIn !== undefined
            ? sqliteFlagFromBoolean(input.usaCurlingMembershipOptIn)
            : latest.usa_curling_membership_opt_in,
        uswca_membership_opt_in:
          input.uswcaMembershipOptIn !== undefined
            ? sqliteFlagFromBoolean(input.uswcaMembershipOptIn)
            : latest.uswca_membership_opt_in,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.curlingRegistrations.id, latest.id));
  }
}

export async function loadMemberParentAssociationOptIns(memberId: number): Promise<{
  usaCurlingMembershipOptIn: boolean | null;
  uswcaMembershipOptIn: boolean | null;
  preferredPronouns: string | null;
}> {
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({
      usa_curling_membership_opt_in: schema.members.usa_curling_membership_opt_in,
      uswca_membership_opt_in: schema.members.uswca_membership_opt_in,
      preferred_pronouns: schema.members.preferred_pronouns,
    })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  return {
    usaCurlingMembershipOptIn: booleanFromSqliteFlag(row?.usa_curling_membership_opt_in),
    uswcaMembershipOptIn: booleanFromSqliteFlag(row?.uswca_membership_opt_in),
    preferredPronouns: row?.preferred_pronouns ?? null,
  };
}
