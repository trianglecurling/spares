import { eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';

export const LAST_SERVER_ADMIN_ERROR =
  'Cannot remove or delete the last server admin. At least one server admin is required.';

export function countServerAdminsFromRows(members: Array<{ is_server_admin?: number | null }>): number {
  return members.filter((member) => (member.is_server_admin ?? 0) === 1).length;
}

export function isLastServerAdminRow(
  member: { id: number; is_server_admin?: number | null },
  serverAdminCount: number
): boolean {
  return (member.is_server_admin ?? 0) === 1 && serverAdminCount === 1;
}

export async function countServerAdminsInDb(): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.members)
    .where(eq(schema.members.is_server_admin, 1));
  return Number(result[0]?.count || 0);
}

export async function isLastServerAdminInDb(memberId: number): Promise<boolean> {
  const count = await countServerAdminsInDb();
  if (count !== 1) return false;

  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.is_server_admin, 1))
    .limit(1);

  return rows[0]?.id === memberId;
}
