import { and, eq, isNull } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { hasScope, RBAC_ROLE_CODES } from './rbac.js';
import type { Member } from '../types.js';
import { isServerAdmin } from './auth.js';

export async function loadGeneralAdminMemberIds(): Promise<Set<number>> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ memberId: schema.memberRoleAssignments.member_id })
    .from(schema.memberRoleAssignments)
    .innerJoin(schema.roles, eq(schema.memberRoleAssignments.role_id, schema.roles.id))
    .where(
      and(
        eq(schema.roles.code, RBAC_ROLE_CODES.generalAdmin),
        isNull(schema.memberRoleAssignments.resource_type),
        isNull(schema.memberRoleAssignments.resource_id),
      ),
    );
  return new Set(rows.map((row) => row.memberId));
}

export function memberHasAdminAccess(
  member: Member,
  options?: { generalAdminMemberIds?: Set<number> },
): boolean {
  if (isServerAdmin(member)) return true;
  if (member.authz) return hasScope(member.authz, 'admin.manage');
  if (options?.generalAdminMemberIds?.has(member.id)) return true;
  return false;
}

export async function setGeneralAdminRole(memberId: number, enabled: boolean): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const [role] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.code, RBAC_ROLE_CODES.generalAdmin))
    .limit(1);
  if (!role) return;

  if (enabled) {
    await db
      .insert(schema.memberRoleAssignments)
      .values({
        member_id: memberId,
        role_id: role.id,
        resource_type: null,
        resource_id: null,
      })
      .onConflictDoNothing();
    return;
  }

  await db
    .delete(schema.memberRoleAssignments)
    .where(
      and(
        eq(schema.memberRoleAssignments.member_id, memberId),
        eq(schema.memberRoleAssignments.role_id, role.id),
        isNull(schema.memberRoleAssignments.resource_type),
        isNull(schema.memberRoleAssignments.resource_id),
      ),
    );
}
