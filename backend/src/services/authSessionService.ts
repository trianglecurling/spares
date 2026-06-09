import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { buildJwtPayloadForMember, generateAccessToken, isAdmin, isServerAdmin } from '../utils/auth.js';
import { buildAuthzClaimsForMember, buildAuthzClaimsForImpersonatedMember } from '../utils/rbac.js';
import { canActorImpersonateTarget } from './accountAccess.js';

const DEFAULT_SESSION_TOKEN_TTL_MINUTES = 30;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 60;
const SESSION_TOKEN_TTL_MINUTES_MIN = 5;
const SESSION_TOKEN_TTL_MINUTES_MAX = 1440;
const REFRESH_TOKEN_TTL_DAYS_MIN = 1;
const REFRESH_TOKEN_TTL_DAYS_MAX = 365;
const CACHE_TTL_MS = 60_000;

type AuthTokenTtls = {
  sessionTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
};

type AuthSessionTokens = {
  accessToken: string;
  refreshToken: string;
};

let ttlCache: { value: AuthTokenTtls; expiresAtMs: number } | null = null;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function parseDbDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeDateString(value: string | Date | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value);
}

function isMemberExpired(member: Member): boolean {
  if (isAdmin(member) || isServerAdmin(member)) return false;
  const validThrough = normalizeDateString(member.valid_through);
  if (!validThrough) return false;
  const today = new Date().toISOString().split('T')[0];
  return today > validThrough;
}

export function invalidateAuthTokenTtlCache(): void {
  ttlCache = null;
}

export async function getAuthTokenTtls(): Promise<AuthTokenTtls> {
  const now = Date.now();
  if (ttlCache && ttlCache.expiresAtMs > now) {
    return ttlCache.value;
  }

  const { db, schema } = getDrizzleDb();
  const [row] = await db
    .select({
      sessionTokenTtlMinutes: schema.serverConfig.session_token_ttl_minutes,
      refreshTokenTtlDays: schema.serverConfig.refresh_token_ttl_days,
    })
    .from(schema.serverConfig)
    .where(eq(schema.serverConfig.id, 1))
    .limit(1);

  const value = {
    sessionTokenTtlMinutes: clampInt(
      row?.sessionTokenTtlMinutes,
      DEFAULT_SESSION_TOKEN_TTL_MINUTES,
      SESSION_TOKEN_TTL_MINUTES_MIN,
      SESSION_TOKEN_TTL_MINUTES_MAX
    ),
    refreshTokenTtlDays: clampInt(
      row?.refreshTokenTtlDays,
      DEFAULT_REFRESH_TOKEN_TTL_DAYS,
      REFRESH_TOKEN_TTL_DAYS_MIN,
      REFRESH_TOKEN_TTL_DAYS_MAX
    ),
  };

  ttlCache = { value, expiresAtMs: now + CACHE_TTL_MS };
  return value;
}

export async function issueAuthSession(member: Member, options?: { actorMemberId?: number }): Promise<AuthSessionTokens> {
  const ttls = await getAuthTokenTtls();
  const actorMemberId = options?.actorMemberId ?? member.id;
  const payload = await buildJwtPayloadForMember(member, { actorMemberId });
  const accessToken = generateAccessToken(payload, ttls.sessionTokenTtlMinutes);
  const refreshToken = newRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + ttls.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  const { db, schema } = getDrizzleDb();
  await db.insert(schema.authTokens).values({
    member_id: member.id,
    actor_member_id: actorMemberId,
    token: refreshTokenHash,
    expires_at: expiresAt,
  });

  return { accessToken, refreshToken };
}

export async function refreshAuthSession(refreshToken: string): Promise<AuthSessionTokens | null> {
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const { db, schema } = getDrizzleDb();
  const [session] = await db
    .select()
    .from(schema.authTokens)
    .where(eq(schema.authTokens.token, refreshTokenHash))
    .limit(1);

  if (!session) return null;

  const expiresAt = parseDbDate(session.expires_at);
  if (expiresAt.getTime() <= Date.now()) {
    await revokeRefreshToken(refreshToken);
    return null;
  }

  const [rawMember] = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.id, session.member_id))
    .limit(1);

  const member = rawMember as Member | undefined;
  if (!member || isMemberExpired(member)) {
    await revokeRefreshToken(refreshToken);
    return null;
  }

  const actorMemberId = session.actor_member_id ?? member.id;
  if (actorMemberId !== member.id && !(await canActorImpersonateTarget(actorMemberId, member.id))) {
    await revokeRefreshToken(refreshToken);
    return null;
  }

  member.impersonationSession = actorMemberId !== member.id;
  member.authz = member.impersonationSession
    ? await buildAuthzClaimsForImpersonatedMember(member)
    : await buildAuthzClaimsForMember(member);

  await db.delete(schema.authTokens).where(eq(schema.authTokens.id, session.id));
  return issueAuthSession(member, { actorMemberId });
}

export async function revokeRefreshToken(refreshToken: string | null | undefined): Promise<void> {
  if (!refreshToken) return;
  const { db, schema } = getDrizzleDb();
  await db.delete(schema.authTokens).where(eq(schema.authTokens.token, hashRefreshToken(refreshToken)));
}

export async function revokeMemberRefreshSessions(memberId: number, actorMemberId?: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db
    .delete(schema.authTokens)
    .where(
      actorMemberId === undefined
        ? eq(schema.authTokens.member_id, memberId)
        : and(eq(schema.authTokens.member_id, memberId), eq(schema.authTokens.actor_member_id, actorMemberId))
    );
}
