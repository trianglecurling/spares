import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { ACCOUNT_KIND_SERVICE, isServiceAccount } from '../utils/accountKind.js';

export const PERSONAL_ACCESS_TOKEN_PREFIX = 'tbs_pat_';

export type PersonalAccessTokenSummary = {
  id: number;
  name: string;
  tokenPrefix: string;
  createdAt: string | Date;
  lastUsedAt: string | Date | null;
  expiresAt: string | Date | null;
  revokedAt: string | Date | null;
};

function hashPersonalAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newPersonalAccessTokenPlaintext(): string {
  return `${PERSONAL_ACCESS_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

function tokenPrefixFromPlaintext(token: string): string {
  return token.slice(0, PERSONAL_ACCESS_TOKEN_PREFIX.length + 8);
}

function parseDbDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

function isExpired(expiresAt: Date | string | number | null | undefined): boolean {
  const parsed = parseDbDate(expiresAt);
  return parsed != null && parsed.getTime() <= Date.now();
}

export function looksLikePersonalAccessToken(token: string): boolean {
  return token.startsWith(PERSONAL_ACCESS_TOKEN_PREFIX);
}

export async function findMemberByPersonalAccessToken(token: string): Promise<Member | null> {
  if (!looksLikePersonalAccessToken(token)) return null;
  const tokenHash = hashPersonalAccessToken(token);
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({
      token: schema.personalAccessTokens,
      member: schema.members,
    })
    .from(schema.personalAccessTokens)
    .innerJoin(schema.members, eq(schema.personalAccessTokens.member_id, schema.members.id))
    .where(
      and(
        eq(schema.personalAccessTokens.token_hash, tokenHash),
        isNull(schema.personalAccessTokens.revoked_at)
      )
    )
    .limit(1);

  if (!row) return null;
  if (isExpired(row.token.expires_at)) return null;
  if (!isServiceAccount(row.member)) return null;

  const member = row.member as Member;
  db.update(schema.personalAccessTokens)
    .set({ last_used_at: new Date() })
    .where(eq(schema.personalAccessTokens.id, row.token.id))
    .catch(() => {});

  return member;
}

export async function listPersonalAccessTokens(memberId: number): Promise<PersonalAccessTokenSummary[]> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.personalAccessTokens)
    .where(eq(schema.personalAccessTokens.member_id, memberId))
    .orderBy(sql`${schema.personalAccessTokens.created_at} desc`);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }));
}

export async function mintPersonalAccessToken(input: {
  memberId: number;
  name: string;
  createdByMemberId: number;
  expiresAt?: Date | null;
}): Promise<{ token: string; summary: PersonalAccessTokenSummary }> {
  const plaintext = newPersonalAccessTokenPlaintext();
  const tokenHash = hashPersonalAccessToken(plaintext);
  const tokenPrefix = tokenPrefixFromPlaintext(plaintext);
  const name = input.name.trim();
  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .insert(schema.personalAccessTokens)
    .values({
      member_id: input.memberId,
      name,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      created_by_member_id: input.createdByMemberId,
      expires_at: input.expiresAt ?? null,
    })
    .returning();

  if (!row) {
    throw new Error('Failed to create personal access token');
  }

  return {
    token: plaintext,
    summary: {
      id: row.id,
      name: row.name,
      tokenPrefix: row.token_prefix,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    },
  };
}

export async function revokePersonalAccessToken(tokenId: number, memberId: number): Promise<boolean> {
  const { db, schema } = getDrizzleDb();
  const [existing] = await db
    .select({ id: schema.personalAccessTokens.id, revoked_at: schema.personalAccessTokens.revoked_at })
    .from(schema.personalAccessTokens)
    .where(
      and(eq(schema.personalAccessTokens.id, tokenId), eq(schema.personalAccessTokens.member_id, memberId))
    )
    .limit(1);
  if (!existing) return false;
  if (existing.revoked_at) return true;

  await db
    .update(schema.personalAccessTokens)
    .set({ revoked_at: new Date() })
    .where(eq(schema.personalAccessTokens.id, tokenId));
  return true;
}

export function serviceAccountEmail(name: string, uniqueSuffix: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'bot';
  return `bot+${slug}-${uniqueSuffix}@service.invalid`;
}

export { ACCOUNT_KIND_SERVICE, hashPersonalAccessToken, tokenPrefixFromPlaintext };
