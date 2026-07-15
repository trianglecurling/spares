import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../utils/auth.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { Member } from '../types.js';
import { eq } from 'drizzle-orm';
import { isAdmin, isServerAdmin } from '../utils/auth.js';
import { recordDailyActivity } from '../services/observability.js';
import { buildAuthzClaimsForMember, buildAuthzClaimsForImpersonatedMember } from '../utils/rbac.js';
import { getMemberMembershipStatus } from '../services/memberMembershipStatusService.js';

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const tokenFromQuery = (() => {
    if (request.query && typeof request.query === 'object' && 'token' in request.query) {
      return (request.query as { token?: string }).token;
    }
    return undefined;
  })();

  const token = authHeader?.replace('Bearer ', '') || tokenFromQuery;

  if (!token) {
    return reply.code(401).send({ error: 'No token provided' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return reply.code(401).send({ error: 'Invalid token' });
  }

  const { db, schema } = getDrizzleDb();
  const members = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.id, payload.memberId))
    .limit(1);
  
  const member = members[0] as Member | undefined;

  if (!member) {
    return reply.code(401).send({ error: 'Member not found' });
  }

  const actorMemberId = payload.actorMemberId ?? payload.memberId;
  const isImpersonating = actorMemberId !== payload.memberId;

  member.impersonationSession = isImpersonating;
  member.membershipStatus = await getMemberMembershipStatus(member.id, {
    isLifetimeMember: (member.lifetime_member ?? 0) === 1,
  });
  // Always rebuild from DB so role/scope changes take effect without waiting for token refresh.
  member.authz = isImpersonating
    ? await buildAuthzClaimsForImpersonatedMember(member)
    : await buildAuthzClaimsForMember(member);
  request.authz = member.authz;
  request.actorMemberId = actorMemberId;
  request.isImpersonating = isImpersonating;

  request.member = member;

  // Best-effort DAU tracking (do not block request)
  recordDailyActivity(member.id).catch(() => {});
}

/**
 * When a Bearer token is present and valid, sets `request.member` (and authz) like {@link authMiddleware}.
 * Missing or invalid auth leaves the request unauthenticated without an error response.
 */
export async function optionalAuthMiddleware(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const tokenFromQuery = (() => {
    if (request.query && typeof request.query === 'object' && 'token' in request.query) {
      return (request.query as { token?: string }).token;
    }
    return undefined;
  })();

  const token = authHeader?.replace('Bearer ', '') || tokenFromQuery;
  if (!token) return;

  const payload = verifyToken(token);
  if (!payload) return;

  const { db, schema } = getDrizzleDb();
  const members = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.id, payload.memberId))
    .limit(1);

  const member = members[0] as Member | undefined;
  if (!member) return;

  const actorMemberId = payload.actorMemberId ?? payload.memberId;
  const isImpersonating = actorMemberId !== payload.memberId;

  member.impersonationSession = isImpersonating;
  member.membershipStatus = await getMemberMembershipStatus(member.id, {
    isLifetimeMember: (member.lifetime_member ?? 0) === 1,
  });
  // Always rebuild from DB so role/scope changes take effect without waiting for token refresh.
  member.authz = isImpersonating
    ? await buildAuthzClaimsForImpersonatedMember(member)
    : await buildAuthzClaimsForMember(member);
  request.authz = member.authz;
  request.actorMemberId = actorMemberId;
  request.isImpersonating = isImpersonating;

  request.member = member;
  recordDailyActivity(member.id).catch(() => {});
}

