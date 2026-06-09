import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { normalizeEmail } from '../utils/auth.js';
import type { JWTPayload } from '../types.js';

export function jwtActorMemberId(payload: JWTPayload): number {
  return payload.actorMemberId ?? payload.memberId;
}

export async function fetchMemberEmailRow(
  memberId: number
): Promise<{ id: number; email: string | null } | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.members.id, email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  return rows[0] ?? null;
}

export async function memberIdsWithSameNormalizedEmailAs(memberId: number): Promise<number[]> {
  const row = await fetchMemberEmailRow(memberId);
  if (!row?.email) return [];
  const norm = normalizeEmail(row.email);
  const { db, schema } = getDrizzleDb();
  const peers = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(sql`lower(trim(${schema.members.email})) = ${norm}`);
  return peers.map((p) => p.id);
}

/** Another member (not `excludeMemberId`) already has this normalized email — blocks account takeover via shared login. */
export async function findMemberIdWithConflictingNormalizedEmail(
  normalizedEmail: string,
  excludeMemberId: number
): Promise<number | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(
      and(
        sql`lower(trim(${schema.members.email})) = ${normalizedEmail}`,
        ne(schema.members.id, excludeMemberId)
      )
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Returns a conflicting member id only when the normalized email is changing to one owned by someone else. */
export async function findMemberIdWithConflictingNormalizedEmailChange(
  normalizedEmail: string,
  currentEmail: string | null | undefined,
  excludeMemberId: number
): Promise<number | null> {
  const currentNormalized = currentEmail ? normalizeEmail(currentEmail) : null;
  if (normalizedEmail === currentNormalized) return null;
  return findMemberIdWithConflictingNormalizedEmail(normalizedEmail, excludeMemberId);
}

export async function canActorImpersonateTarget(
  actorMemberId: number,
  targetMemberId: number
): Promise<boolean> {
  if (actorMemberId === targetMemberId) return true;
  const actor = await fetchMemberEmailRow(actorMemberId);
  const target = await fetchMemberEmailRow(targetMemberId);
  if (!actor || !target) return false;
  if (
    actor.email &&
    target.email &&
    normalizeEmail(actor.email) === normalizeEmail(target.email)
  ) {
    return true;
  }
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.memberAccountAccessDelegations.id })
    .from(schema.memberAccountAccessDelegations)
    .where(
      and(
        eq(schema.memberAccountAccessDelegations.grantor_member_id, targetMemberId),
        eq(schema.memberAccountAccessDelegations.grantee_member_id, actorMemberId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function listAccountSwitchOptions(
  actorMemberId: number
): Promise<Array<{ id: number; name: string }>> {
  const ids = new Set<number>();
  ids.add(actorMemberId);
  for (const id of await memberIdsWithSameNormalizedEmailAs(actorMemberId)) {
    ids.add(id);
  }
  const { db, schema } = getDrizzleDb();
  const delegations = await db
    .select({
      grantorId: schema.memberAccountAccessDelegations.grantor_member_id,
    })
    .from(schema.memberAccountAccessDelegations)
    .where(eq(schema.memberAccountAccessDelegations.grantee_member_id, actorMemberId));
  for (const row of delegations) {
    ids.add(row.grantorId);
  }
  const idList = [...ids];
  if (idList.length === 0) return [];
  return db
    .select({ id: schema.members.id, name: schema.members.name })
    .from(schema.members)
    .where(inArray(schema.members.id, idList))
    .orderBy(asc(schema.members.name));
}

export async function listDelegateGranteesForGrantor(
  grantorMemberId: number
): Promise<number[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.memberAccountAccessDelegations.grantee_member_id })
    .from(schema.memberAccountAccessDelegations)
    .where(eq(schema.memberAccountAccessDelegations.grantor_member_id, grantorMemberId));
  return rows.map((r) => r.id);
}
