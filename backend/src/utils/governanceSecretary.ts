import { and, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { isAdmin, isServerAdmin } from './auth.js';
import { hasScope } from './rbac.js';

/** True when the member is the currently assigned club secretary. */
export async function isCurrentClubSecretary(memberId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ memberId: schema.governanceBoardMembers.member_id })
    .from(schema.governanceOfficers)
    .innerJoin(
      schema.governanceBoardMembers,
      eq(schema.governanceBoardMembers.id, schema.governanceOfficers.board_member_id),
    )
    .where(
      and(
        eq(schema.governanceOfficers.position, 'secretary'),
        eq(schema.governanceBoardMembers.member_id, memberId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Secretary, governance managers, or general/server admins may manage board minutes. */
export async function canManageBoardMeetingMinutes(member: Member): Promise<boolean> {
  if (isServerAdmin(member) || isAdmin(member)) return true;
  if (hasScope(member.authz, 'governance.manage')) return true;
  return isCurrentClubSecretary(member.id);
}
